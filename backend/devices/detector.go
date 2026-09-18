package devices

import (
	"encoding/json"
	"fmt"
	"strings"
)

// DeviceUpdate represents an extracted or updated piece of device information
// from an incoming MQTT message.
type DeviceUpdate struct {
	ID           string
	BrokerID     string
	Name         string
	Convention   string // "homie", "esphome", "homeassistant", "tasmota", "generic"
	Status       string // "online", "offline", ""
	IPAddress    string
	MACAddress   string
	Hardware     string
	Firmware     string
	BaseTopic    string
	CommandTopic string
	Attributes   map[string]any
}

// DetectDeviceUpdate inspects an incoming topic and payload and returns
// a DeviceUpdate if the message matches an established device convention.
func DetectDeviceUpdate(brokerID, topic string, payload []byte) (*DeviceUpdate, bool) {
	cleanTopic := strings.TrimSpace(topic)
	if cleanTopic == "" || strings.HasPrefix(cleanTopic, "$SYS/") {
		return nil, false
	}

	payloadStr := strings.TrimSpace(string(payload))

	// 1. Homie Convention (e.g. homie/<device>/$...) or <device>/$...
	if update, ok := detectHomie(brokerID, cleanTopic, payloadStr); ok {
		return update, true
	}

	// 2. Home Assistant Discovery (e.g. homeassistant/<component>/[node_id/]<object_id>/config)
	if update, ok := detectHomeAssistant(brokerID, cleanTopic, payload); ok {
		return update, true
	}

	// 3. Tasmota Convention (e.g. tele/<device>/LWT or tele/<device>/INFO*)
	if update, ok := detectTasmota(brokerID, cleanTopic, payloadStr); ok {
		return update, true
	}

	// 4. ESPHome Convention (e.g. <device>/status, <device>/version, <device>/debug)
	if update, ok := detectESPHome(brokerID, cleanTopic, payloadStr); ok {
		return update, true
	}

	// 5. Generic Status / LWT Fallback (e.g. <device>/status, <device>/availability)
	if update, ok := detectGeneric(brokerID, cleanTopic, payloadStr); ok {
		return update, true
	}

	return nil, false
}

func detectHomie(brokerID, topic, payload string) (*DeviceUpdate, bool) {
	parts := strings.Split(topic, "/")
	// Case A: homie/<device_id>/$... (parts >= 3)
	// Case B: <device_id>/$... (parts >= 2)
	var deviceID string
	var propIndex int
	var baseTopic string

	if len(parts) >= 3 && parts[0] == "homie" && strings.HasPrefix(parts[2], "$") {
		deviceID = parts[1]
		propIndex = 2
		baseTopic = "homie/" + deviceID
	} else if len(parts) >= 2 && strings.HasPrefix(parts[1], "$") {
		deviceID = parts[0]
		propIndex = 1
		baseTopic = deviceID
	} else {
		return nil, false
	}

	if deviceID == "" {
		return nil, false
	}

	attribute := strings.Join(parts[propIndex:], "/")
	up := &DeviceUpdate{
		ID:           deviceID,
		BrokerID:     brokerID,
		Convention:   "homie",
		BaseTopic:    baseTopic,
		CommandTopic: fmt.Sprintf("%s/command", baseTopic),
		Attributes:   make(map[string]any),
	}

	switch attribute {
	case "$homie":
		up.Attributes["homie_version"] = payload
	case "$name":
		up.Name = payload
	case "$state":
		switch strings.ToLower(payload) {
		case "ready", "init", "sleeping":
			up.Status = "online"
		case "lost", "disconnected", "alert":
			up.Status = "offline"
		}
		up.Attributes["homie_state"] = payload
	case "$mac":
		up.MACAddress = payload
	case "$localip":
		up.IPAddress = payload
	case "$implementation", "$fw/name":
		up.Hardware = payload
	case "$fw/version":
		up.Firmware = payload
	case "$nodes":
		up.Attributes["nodes"] = payload
	default:
		up.Attributes[attribute] = payload
	}

	return up, true
}

func detectHomeAssistant(brokerID, topic string, payloadBytes []byte) (*DeviceUpdate, bool) {
	// homeassistant/<component>/[<node_id>/]<object_id>/config
	if !strings.HasPrefix(topic, "homeassistant/") || !strings.HasSuffix(topic, "/config") {
		return nil, false
	}

	var doc struct {
		Name         string `json:"name"`
		StateTopic   string `json:"state_topic"`
		CommandTopic string `json:"command_topic"`
		AvailTopic   string `json:"availability_topic"`
		Device       *struct {
			Identifiers     any             `json:"identifiers"`
			Name            string          `json:"name"`
			Model           string          `json:"model"`
			Manufacturer    string          `json:"manufacturer"`
			SWVersion       string          `json:"sw_version"`
			Connections     [][]string      `json:"connections"`
			ConfigURL       string          `json:"configuration_url"`
		} `json:"device"`
	}

	if err := json.Unmarshal(payloadBytes, &doc); err != nil {
		return nil, false
	}

	parts := strings.Split(topic, "/")
	if len(parts) < 4 {
		return nil, false
	}

	var deviceID string
	var devName string
	var model string
	var swVersion string
	var mac string
	var ip string
	convention := "homeassistant"

	if doc.Device != nil {
		devName = doc.Device.Name
		model = doc.Device.Model
		swVersion = doc.Device.SWVersion

		mfgLower := strings.ToLower(doc.Device.Manufacturer)
		swLower := strings.ToLower(doc.Device.SWVersion)
		if strings.Contains(mfgLower, "esphome") || strings.Contains(swLower, "esphome") {
			convention = "esphome"
		} else if strings.Contains(mfgLower, "tasmota") {
			convention = "tasmota"
		}

		if idStr, ok := doc.Device.Identifiers.(string); ok && idStr != "" {
			deviceID = idStr
		} else if idArr, ok := doc.Device.Identifiers.([]any); ok && len(idArr) > 0 {
			if first, ok := idArr[0].(string); ok {
				deviceID = first
			}
		}

		for _, conn := range doc.Device.Connections {
			if len(conn) >= 2 {
				switch strings.ToLower(conn[0]) {
				case "mac":
					mac = conn[1]
				case "ip":
					ip = conn[1]
				}
			}
		}
	}

	if deviceID == "" {
		// Use node_id or object_id from topic
		if len(parts) >= 5 {
			deviceID = parts[2]
		} else {
			deviceID = parts[2]
		}
	}

	if devName == "" {
		if doc.Name != "" {
			devName = doc.Name
		} else {
			devName = deviceID
		}
	}

	baseTopic := strings.TrimSuffix(topic, "/config")
	if doc.StateTopic != "" {
		subParts := strings.Split(doc.StateTopic, "/")
		if len(subParts) > 1 {
			baseTopic = subParts[0]
		}
	}

	up := &DeviceUpdate{
		ID:           deviceID,
		BrokerID:     brokerID,
		Name:         devName,
		Convention:   convention,
		Status:       "online",
		Hardware:     model,
		Firmware:     swVersion,
		MACAddress:   mac,
		IPAddress:    ip,
		BaseTopic:    baseTopic,
		CommandTopic: doc.CommandTopic,
		Attributes:   make(map[string]any),
	}
	if doc.AvailTopic != "" {
		up.Attributes["availability_topic"] = doc.AvailTopic
	}

	return up, true
}

func detectTasmota(brokerID, topic, payload string) (*DeviceUpdate, bool) {
	if !strings.HasPrefix(topic, "tele/") {
		return nil, false
	}

	parts := strings.Split(topic, "/")
	if len(parts) < 3 {
		return nil, false
	}

	deviceID := parts[1]
	sub := parts[2]
	baseTopic := "tele/" + deviceID

	up := &DeviceUpdate{
		ID:           deviceID,
		BrokerID:     brokerID,
		Convention:   "tasmota",
		BaseTopic:    baseTopic,
		CommandTopic: fmt.Sprintf("cmnd/%s/Restart", deviceID),
		Attributes:   make(map[string]any),
	}

	switch sub {
	case "LWT":
		lower := strings.ToLower(payload)
		if lower == "online" {
			up.Status = "online"
		} else if lower == "offline" {
			up.Status = "offline"
		}
	case "INFO1":
		var info struct {
			Module  string `json:"Module"`
			Version string `json:"Version"`
		}
		if err := json.Unmarshal([]byte(payload), &info); err == nil {
			up.Hardware = info.Module
			up.Firmware = info.Version
		}
	case "INFO2":
		var info struct {
			IPAddress string `json:"IPAddress"`
			Hostname  string `json:"Hostname"`
		}
		if err := json.Unmarshal([]byte(payload), &info); err == nil {
			up.IPAddress = info.IPAddress
			if info.Hostname != "" {
				up.Name = info.Hostname
			}
		}
	case "STATE":
		var st struct {
			Wifi struct {
				Mac  string `json:"Mac"`
				SSId string `json:"SSId"`
				RSSI int    `json:"RSSI"`
			} `json:"Wifi"`
		}
		if err := json.Unmarshal([]byte(payload), &st); err == nil {
			up.MACAddress = st.Wifi.Mac
			if st.Wifi.SSId != "" {
				up.Attributes["wifi_ssid"] = st.Wifi.SSId
			}
			if st.Wifi.RSSI != 0 {
				up.Attributes["wifi_rssi"] = st.Wifi.RSSI
			}
		}
	}

	return up, true
}

func detectESPHome(brokerID, topic, payload string) (*DeviceUpdate, bool) {
	parts := strings.Split(topic, "/")
	if len(parts) < 2 {
		return nil, false
	}

	// Topics like <device>/status, <device>/version, <device>/debug, <device>/ip, <device>/mac
	deviceID := parts[0]
	sub := parts[1]

	// Filter out common top-level non-device topic prefixes
	switch deviceID {
	case "demo", "sensors", "test", "homie", "tele", "cmnd", "stat", "homeassistant":
		return nil, false
	}

	up := &DeviceUpdate{
		ID:           deviceID,
		BrokerID:     brokerID,
		Convention:   "esphome",
		BaseTopic:    deviceID,
		CommandTopic: fmt.Sprintf("%s/button/restart/command", deviceID),
		Attributes:   make(map[string]any),
	}

	lowerPayload := strings.ToLower(payload)

	switch sub {
	case "status":
		if lowerPayload == "online" {
			up.Status = "online"
		} else if lowerPayload == "offline" {
			up.Status = "offline"
		} else {
			return nil, false
		}
	case "version":
		up.Firmware = payload
	case "ip", "localip", "ip_address":
		up.IPAddress = payload
	case "mac", "mac_address":
		up.MACAddress = payload
	case "hardware", "board":
		up.Hardware = payload
	case "name":
		up.Name = payload
	default:
		// Check sensor status or IP topics like <device>/sensor/<name>_ip_address/state
		if len(parts) >= 4 && parts[1] == "sensor" && parts[3] == "state" {
			if strings.Contains(parts[2], "ip_address") {
				up.IPAddress = payload
				return up, true
			}
			if strings.Contains(parts[2], "mac") {
				up.MACAddress = payload
				return up, true
			}
		}
		return nil, false
	}

	return up, true
}

func detectGeneric(brokerID, topic, payload string) (*DeviceUpdate, bool) {
	parts := strings.Split(topic, "/")
	if len(parts) != 2 {
		return nil, false
	}

	deviceID := parts[0]
	sub := strings.ToLower(parts[1])

	switch deviceID {
	case "demo", "sensors", "test", "homie", "tele", "cmnd", "stat", "homeassistant", "$SYS":
		return nil, false
	}

	if sub != "status" && sub != "state" && sub != "availability" && sub != "lwt" {
		return nil, false
	}

	lowerPayload := strings.ToLower(payload)
	var status string
	switch lowerPayload {
	case "online", "connected", "ready", "true", "1":
		status = "online"
	case "offline", "disconnected", "lost", "false", "0":
		status = "offline"
	default:
		return nil, false
	}

	return &DeviceUpdate{
		ID:           deviceID,
		BrokerID:     brokerID,
		Convention:   "generic",
		Status:       status,
		BaseTopic:    deviceID,
		CommandTopic: fmt.Sprintf("%s/command", deviceID),
		Attributes:   make(map[string]any),
	}, true
}
