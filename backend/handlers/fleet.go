package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"mqtt-dashboard/models"
	mqttclient "mqtt-dashboard/mqtt"
)

type FleetHandler struct {
	db       *sql.DB
	registry *mqttclient.BrokerRegistry
}

func NewFleetHandler(db *sql.DB, registry *mqttclient.BrokerRegistry) *FleetHandler {
	return &FleetHandler{
		db:       db,
		registry: registry,
	}
}

var macRegex = regexp.MustCompile(`(?i)(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}`)
var ipRegex = regexp.MustCompile(`\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b`)

type historyRow struct {
	ID        int
	Topic     string
	Payload   string
	Timestamp string
}

// GetDevices scans history messages and applies pluggable discovery adapters to assemble connected devices.
func (h *FleetHandler) GetDevices(w http.ResponseWriter, r *http.Request) {
	brokerID := r.URL.Query().Get("broker_id")
	if brokerID == "" {
		brokerID = h.registry.DefaultBrokerID()
	}
	if brokerID == "" {
		http.Error(w, "broker_id required", http.StatusBadRequest)
		return
	}

	devices := h.discoverFleetDevices(brokerID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(devices)
}

// GetTopology generates a node-edge graph representation of the fleet topology.
func (h *FleetHandler) GetTopology(w http.ResponseWriter, r *http.Request) {
	brokerID := r.URL.Query().Get("broker_id")
	if brokerID == "" {
		brokerID = h.registry.DefaultBrokerID()
	}
	if brokerID == "" {
		http.Error(w, "broker_id required", http.StatusBadRequest)
		return
	}

	devices := h.discoverFleetDevices(brokerID)

	nodes := []models.TopologyNode{
		{
			ID:     "broker:" + brokerID,
			Label:  "MQTT Broker (" + h.registry.Status(brokerID) + ")",
			Type:   "broker",
			Status: strings.ToLower(h.registry.Status(brokerID)),
		},
	}

	links := []models.TopologyLink{}

	for _, d := range devices {
		nodeType := "device"
		targetParent := "broker:" + brokerID

		if d.DeviceType == "zigbee2mqtt" || strings.Contains(strings.ToLower(d.Name), "bridge") || strings.Contains(strings.ToLower(d.Name), "gateway") {
			nodeType = "gateway"
		}

		nodes = append(nodes, models.TopologyNode{
			ID:     d.ID,
			Label:  d.Name,
			Type:   nodeType,
			Status: d.Status,
			MAC:    d.MAC,
			IP:     d.IP,
		})

		links = append(links, models.TopologyLink{
			Source: targetParent,
			Target: d.ID,
			Status: d.Status,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models.FleetTopology{
		Nodes: nodes,
		Links: links,
	})
}

// SendCommand publishes a management/control command to a device.
func (h *FleetHandler) SendCommand(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BrokerID string `json:"broker_id"`
		Topic    string `json:"topic"`
		Payload  string `json:"payload"`
		QoS      byte   `json:"qos"`
		Retain   bool   `json:"retain"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request json", http.StatusBadRequest)
		return
	}

	if req.BrokerID == "" {
		req.BrokerID = h.registry.DefaultBrokerID()
	}
	if req.Topic == "" {
		http.Error(w, "topic required", http.StatusBadRequest)
		return
	}

	if err := h.registry.Publish(req.BrokerID, req.Topic, req.QoS, req.Retain, []byte(req.Payload)); err != nil {
		http.Error(w, "publish failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *FleetHandler) discoverFleetDevices(brokerID string) []models.FleetDevice {
	if h.db == nil {
		return []models.FleetDevice{}
	}

	// Fetch history from database for the specified broker (last 24h)
	rows, err := h.db.Query(
		`SELECT id, topic, COALESCE(payload, ''), timestamp FROM mqtt_history 
		 WHERE broker_id = ? AND timestamp > DATETIME('now', '-24 hours') AND topic NOT LIKE '$%'
		 ORDER BY timestamp ASC`,
		brokerID,
	)
	if err != nil {
		return []models.FleetDevice{}
	}
	defer rows.Close()

	deviceMap := make(map[string]*models.FleetDevice)
	topicToDevice := make(map[string]string)

	for rows.Next() {
		var hr historyRow
		if err := rows.Scan(&hr.ID, &hr.Topic, &hr.Payload, &hr.Timestamp); err != nil {
			continue
		}

		// Apply Discovery Adapters
		h.parseHADiscovery(brokerID, hr, deviceMap, topicToDevice)
		h.parseHomieDiscovery(brokerID, hr, deviceMap, topicToDevice)
		h.parseTelemetryDiscovery(brokerID, hr, deviceMap, topicToDevice)
	}

	// Convert map to slice & filter out pseudo "generic" devices without specs
	result := make([]models.FleetDevice, 0, len(deviceMap))
	for _, dev := range deviceMap {
		if dev.DeviceType == "generic" {
			if dev.MAC == "" && dev.IP == "" && dev.Firmware == "" && dev.Hardware == "" {
				continue
			}
		}

		// Clean up duplicate topics
		topicSet := make(map[string]bool)
		cleanTopics := []string{}
		for _, t := range dev.Topics {
			if !topicSet[t] {
				topicSet[t] = true
				cleanTopics = append(cleanTopics, t)
			}
		}
		sort.Strings(cleanTopics)
		dev.Topics = cleanTopics
		result = append(result, *dev)
	}

	sort.Slice(result, func(i, j int) bool {
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})

	return result
}



// 1. Home Assistant MQTT Discovery Adapter (homeassistant/+/+/config)
func (h *FleetHandler) parseHADiscovery(brokerID string, hr historyRow, devMap map[string]*models.FleetDevice, tToDev map[string]string) {
	if !strings.HasPrefix(hr.Topic, "homeassistant/") || !strings.HasSuffix(hr.Topic, "/config") {
		return
	}

	var payloadObj struct {
		Name              string          `json:"name"`
		StateTopic        string          `json:"state_topic"`
		AvailabilityTopic string          `json:"availability_topic"`
		Device            json.RawMessage `json:"device"`
	}

	if err := json.Unmarshal([]byte(hr.Payload), &payloadObj); err != nil {
		return
	}

	var devInfo struct {
		ID           string        `json:"id"`
		Name         string        `json:"name"`
		Model        string        `json:"model"`
		Manufacturer string        `json:"manufacturer"`
		SwVersion    string        `json:"sw_version"`
		Connections  [][]string    `json:"connections"`
		Identifiers  []interface{} `json:"identifiers"`
	}

	_ = json.Unmarshal(payloadObj.Device, &devInfo)

	deviceID := devInfo.ID
	if deviceID == "" && devInfo.Name != "" {
		deviceID = sanitizeID(devInfo.Name)
	}
	if deviceID == "" && len(devInfo.Identifiers) > 0 {
		deviceID = sanitizeID(fmtString(devInfo.Identifiers[0]))
	}
	if deviceID == "" {
		parts := strings.Split(hr.Topic, "/")
		if len(parts) >= 3 {
			deviceID = parts[2]
		}
	}
	if deviceID == "" {
		return
	}

	dev := getOrCreateDevice(devMap, deviceID, brokerID)
	dev.DeviceType = "homeassistant"

	if devInfo.Name != "" {
		dev.Name = devInfo.Name
	}
	if devInfo.SwVersion != "" {
		dev.Firmware = devInfo.SwVersion
	}
	if devInfo.Model != "" || devInfo.Manufacturer != "" {
		dev.Hardware = strings.TrimSpace(devInfo.Manufacturer + " " + devInfo.Model)
	}

	// Extract MAC from connections
	for _, conn := range devInfo.Connections {
		if len(conn) >= 2 {
			if strings.EqualFold(conn[0], "mac") {
				dev.MAC = conn[1]
			}
		}
	}

	if dev.BaseTopic == "" {
		if payloadObj.StateTopic != "" {
			parts := strings.Split(payloadObj.StateTopic, "/")
			if len(parts) > 1 {
				dev.BaseTopic = parts[0]
			}
		}
	}

	dev.LastSeen = hr.Timestamp
	dev.Topics = append(dev.Topics, hr.Topic)
	if payloadObj.StateTopic != "" {
		dev.Topics = append(dev.Topics, payloadObj.StateTopic)
	}
	if payloadObj.AvailabilityTopic != "" {
		dev.Topics = append(dev.Topics, payloadObj.AvailabilityTopic)
	}
}

// 2. Homie Convention Adapter (homie/<device_id>/...)
func (h *FleetHandler) parseHomieDiscovery(brokerID string, hr historyRow, devMap map[string]*models.FleetDevice, tToDev map[string]string) {
	if !strings.HasPrefix(hr.Topic, "homie/") {
		return
	}

	parts := strings.Split(hr.Topic, "/")
	if len(parts) < 2 {
		return
	}

	deviceID := parts[1]
	dev := getOrCreateDevice(devMap, deviceID, brokerID)
	dev.DeviceType = "homie"
	dev.LastSeen = hr.Timestamp
	dev.Topics = append(dev.Topics, hr.Topic)

	if len(parts) == 3 {
		attr := parts[2]
		switch attr {
		case "$name":
			dev.Name = hr.Payload
		case "$mac":
			dev.MAC = hr.Payload
		case "$localip":
			dev.IP = hr.Payload
		case "$state":
			if hr.Payload == "ready" || hr.Payload == "init" {
				dev.Status = "online"
			} else if hr.Payload == "disconnected" || hr.Payload == "lost" {
				dev.Status = "offline"
			}
		case "$fw/version":
			dev.Firmware = hr.Payload
		case "$implementation":
			dev.Hardware = hr.Payload
		}
	}
}

// 3. Telemetry & Device Specs Adapter
func (h *FleetHandler) parseTelemetryDiscovery(brokerID string, hr historyRow, devMap map[string]*models.FleetDevice, tToDev map[string]string) {
	parts := strings.Split(hr.Topic, "/")
	if len(parts) < 2 {
		return
	}

	base := parts[0]

	// If the topic belongs to an already identified device, attach it and extract telemetry
	if existingDev, ok := devMap[base]; ok {
		existingDev.LastSeen = hr.Timestamp
		existingDev.Topics = append(existingDev.Topics, hr.Topic)
		if strings.HasPrefix(strings.TrimSpace(hr.Payload), "{") {
			var jsonMap map[string]interface{}
			if err := json.Unmarshal([]byte(hr.Payload), &jsonMap); err == nil {
				extractTelemetryInfo(jsonMap, existingDev)
			}
		}
		return
	}

	// For new devices, require a valid JSON payload containing explicit device identity attributes
	payload := strings.TrimSpace(hr.Payload)
	if !strings.HasPrefix(payload, "{") {
		return
	}

	var jsonMap map[string]interface{}
	if err := json.Unmarshal([]byte(payload), &jsonMap); err != nil {
		return
	}

	hasIdentity := false
	for k, v := range jsonMap {
		kLower := strings.ToLower(k)
		switch kLower {
		case "mac", "mac_address", "macaddress", "ip", "ip_address", "ipaddress", "hardware", "model", "board", "firmware", "sw_version", "device_id", "node_id":
			if strVal, ok := v.(string); ok && strVal != "" {
				hasIdentity = true
			}
		}
	}

	if !hasIdentity {
		return
	}

	dev := getOrCreateDevice(devMap, base, brokerID)
	dev.DeviceType = "generic"
	dev.LastSeen = hr.Timestamp
	dev.Topics = append(dev.Topics, hr.Topic)
	if dev.BaseTopic == "" {
		dev.BaseTopic = base
	}
	extractTelemetryInfo(jsonMap, dev)
}



func extractTelemetryInfo(m map[string]interface{}, dev *models.FleetDevice) {
	for k, v := range m {
		kLower := strings.ToLower(k)
		switch {
		case kLower == "mac" || kLower == "mac_address" || kLower == "macaddress":
			if s, ok := v.(string); ok && dev.MAC == "" {
				dev.MAC = s
			}
		case kLower == "ip" || kLower == "ip_address" || kLower == "ipaddress":
			if s, ok := v.(string); ok && dev.IP == "" {
				dev.IP = s
			}
		case kLower == "rssi" || kLower == "wifi_rssi" || kLower == "signal":
			if f, ok := v.(float64); ok {
				dev.RSSI = int(f)
			}
		case kLower == "firmware" || kLower == "version" || kLower == "sw_version":
			if s, ok := v.(string); ok && dev.Firmware == "" {
				dev.Firmware = s
			}
		case kLower == "hardware" || kLower == "model" || kLower == "board":
			if s, ok := v.(string); ok && dev.Hardware == "" {
				dev.Hardware = s
			}
		case kLower == "uptime":
			if f, ok := v.(float64); ok {
				dev.Uptime = int64(f)
			}
		}
	}
}

func getOrCreateDevice(devMap map[string]*models.FleetDevice, id string, brokerID string) *models.FleetDevice {
	if dev, ok := devMap[id]; ok {
		return dev
	}

	cleanName := strings.ReplaceAll(id, "_", " ")
	cleanName = strings.ReplaceAll(cleanName, "-", " ")
	cleanName = titleCase(cleanName)

	dev := &models.FleetDevice{
		ID:         id,
		Name:       cleanName,
		BrokerID:   brokerID,
		Status:     "online", // Default to online if active messages arrive recently
		DeviceType: "generic",
		BaseTopic:  id,
		Topics:     []string{},
	}
	devMap[id] = dev
	return dev
}

func titleCase(s string) string {
	words := strings.Fields(s)
	for i, w := range words {
		if len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + strings.ToLower(w[1:])
		}
	}
	return strings.Join(words, " ")
}

func sanitizeID(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	reg := regexp.MustCompile(`[^a-z0-9_-]+`)
	return reg.ReplaceAllString(s, "-")
}

func fmtString(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
