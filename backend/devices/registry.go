package devices

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"sort"
	"sync"
	"time"

	"mqtt-dashboard/models"
)

type DeviceRegistry struct {
	mu    sync.RWMutex
	db    *sql.DB
	cache map[string]*models.Device // key: brokerID + "\x00" + deviceID
}

func NewDeviceRegistry(db *sql.DB) *DeviceRegistry {
	r := &DeviceRegistry{
		db:    db,
		cache: make(map[string]*models.Device),
	}
	r.loadFromDB()
	return r
}

func cacheKey(brokerID, deviceID string) string {
	return brokerID + "\x00" + deviceID
}

func (r *DeviceRegistry) loadFromDB() {
	if r.db == nil {
		return
	}

	rows, err := r.db.Query(`
		SELECT id, broker_id, name, convention, status, ip_address, mac_address, hardware, firmware, base_topic, command_topic, attributes_json, last_seen, created_at
		FROM mqtt_devices
	`)
	if err != nil {
		slog.Error("failed to load devices from db", "err", err)
		return
	}
	defer rows.Close()

	r.mu.Lock()
	defer r.mu.Unlock()

	for rows.Next() {
		var d models.Device
		var attrsJSON string
		if err := rows.Scan(
			&d.ID, &d.BrokerID, &d.Name, &d.Convention, &d.Status,
			&d.IPAddress, &d.MACAddress, &d.Hardware, &d.Firmware,
			&d.BaseTopic, &d.CommandTopic, &attrsJSON,
			&d.LastSeen, &d.CreatedAt,
		); err != nil {
			continue
		}

		if attrsJSON != "" {
			_ = json.Unmarshal([]byte(attrsJSON), &d.Attributes)
		}
		if d.Attributes == nil {
			d.Attributes = make(map[string]any)
		}

		r.cache[cacheKey(d.BrokerID, d.ID)] = &d
	}
	slog.Info("loaded devices from db", "count", len(r.cache))
}

// GetDevices returns all devices registered for a specific brokerID.
func (r *DeviceRegistry) GetDevices(brokerID string) []*models.Device {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]*models.Device, 0)
	for _, dev := range r.cache {
		if dev.BrokerID == brokerID {
			// Return a copy to avoid external mutation
			cp := *dev
			result = append(result, &cp)
		}
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].Status != result[j].Status {
			// Online first
			return result[i].Status == "online"
		}
		return result[i].Name < result[j].Name
	})

	return result
}

// GetDevice returns a single device by brokerID and id.
func (r *DeviceRegistry) GetDevice(brokerID, id string) (*models.Device, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	dev, ok := r.cache[cacheKey(brokerID, id)]
	if !ok {
		return nil, false
	}
	cp := *dev
	return &cp, true
}

// ProcessMessage processes an incoming MQTT message, updates devices if a pattern matches,
// and saves the update to SQLite.
func (r *DeviceRegistry) ProcessMessage(brokerID, topic string, payload []byte) (*models.Device, bool) {
	update, ok := DetectDeviceUpdate(brokerID, topic, payload)
	if !ok || update == nil || update.ID == "" {
		return nil, false
	}

	key := cacheKey(brokerID, update.ID)
	now := time.Now().UTC().Format(time.RFC3339)

	r.mu.Lock()
	dev, exists := r.cache[key]
	if !exists {
		devName := update.Name
		if devName == "" {
			devName = update.ID
		}
		status := update.Status
		if status == "" {
			status = "unknown"
		}
		dev = &models.Device{
			ID:           update.ID,
			BrokerID:     brokerID,
			Name:         devName,
			Convention:   update.Convention,
			Status:       status,
			IPAddress:    update.IPAddress,
			MACAddress:   update.MACAddress,
			Hardware:     update.Hardware,
			Firmware:     update.Firmware,
			BaseTopic:    update.BaseTopic,
			CommandTopic: update.CommandTopic,
			Attributes:   make(map[string]any),
			CreatedAt:    now,
			LastSeen:     now,
		}
		r.cache[key] = dev
	} else {
		if update.Name != "" {
			dev.Name = update.Name
		}
		if update.Status != "" {
			dev.Status = update.Status
		}
		if update.IPAddress != "" {
			dev.IPAddress = update.IPAddress
		}
		if update.MACAddress != "" {
			dev.MACAddress = update.MACAddress
		}
		if update.Hardware != "" {
			dev.Hardware = update.Hardware
		}
		if update.Firmware != "" {
			dev.Firmware = update.Firmware
		}
		if update.Convention != "" && (dev.Convention == "generic" || dev.Convention == "" || dev.Convention == "unknown") {
			dev.Convention = update.Convention
		}
		if update.BaseTopic != "" {
			dev.BaseTopic = update.BaseTopic
		}
		if update.CommandTopic != "" {
			dev.CommandTopic = update.CommandTopic
		}
		dev.LastSeen = now
	}

	if update.Attributes != nil {
		for k, v := range update.Attributes {
			dev.Attributes[k] = v
		}
	}

	devCopy := *dev
	r.mu.Unlock()

	r.saveToDB(&devCopy)
	return &devCopy, true
}

func (r *DeviceRegistry) saveToDB(dev *models.Device) {
	if r.db == nil {
		return
	}

	attrsBytes, err := json.Marshal(dev.Attributes)
	if err != nil {
		attrsBytes = []byte("{}")
	}

	query := `
		INSERT INTO mqtt_devices (
			id, broker_id, name, convention, status, ip_address, mac_address, hardware, firmware, base_topic, command_topic, attributes_json, last_seen, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(broker_id, id) DO UPDATE SET
			name = excluded.name,
			convention = excluded.convention,
			status = excluded.status,
			ip_address = CASE WHEN excluded.ip_address != '' THEN excluded.ip_address ELSE mqtt_devices.ip_address END,
			mac_address = CASE WHEN excluded.mac_address != '' THEN excluded.mac_address ELSE mqtt_devices.mac_address END,
			hardware = CASE WHEN excluded.hardware != '' THEN excluded.hardware ELSE mqtt_devices.hardware END,
			firmware = CASE WHEN excluded.firmware != '' THEN excluded.firmware ELSE mqtt_devices.firmware END,
			base_topic = CASE WHEN excluded.base_topic != '' THEN excluded.base_topic ELSE mqtt_devices.base_topic END,
			command_topic = CASE WHEN excluded.command_topic != '' THEN excluded.command_topic ELSE mqtt_devices.command_topic END,
			attributes_json = excluded.attributes_json,
			last_seen = excluded.last_seen;
	`

	if _, err := r.db.Exec(
		query,
		dev.ID, dev.BrokerID, dev.Name, dev.Convention, dev.Status,
		dev.IPAddress, dev.MACAddress, dev.Hardware, dev.Firmware,
		dev.BaseTopic, dev.CommandTopic, string(attrsBytes),
		dev.LastSeen, dev.CreatedAt,
	); err != nil {
		slog.Error("failed to persist device to db", "broker_id", dev.BrokerID, "id", dev.ID, "err", err)
	}
}

// ScanHistory scans mqtt_history for historical device messages and processes them.
func (r *DeviceRegistry) ScanHistory(brokerID string) error {
	if r.db == nil {
		return nil
	}

	rows, err := r.db.Query(`
		SELECT topic, COALESCE(payload, '')
		FROM mqtt_history
		WHERE broker_id = ?
		  AND (
		      topic LIKE '%$%'
		      OR topic LIKE 'homeassistant/%'
		      OR topic LIKE 'tele/%'
		      OR topic LIKE '%/status'
		      OR topic LIKE '%/state'
		      OR topic LIKE '%/availability'
		      OR topic LIKE '%/lwt'
		      OR topic LIKE '%/version'
		      OR topic LIKE '%/ip'
		      OR topic LIKE '%/mac'
		  )
		ORDER BY timestamp ASC
	`, brokerID)
	if err != nil {
		return err
	}
	defer rows.Close()

	type histItem struct {
		topic   string
		payload string
	}
	var items []histItem
	for rows.Next() {
		var item histItem
		if err := rows.Scan(&item.topic, &item.payload); err != nil {
			continue
		}
		items = append(items, item)
	}
	rows.Close()

	count := 0
	for _, item := range items {
		if _, ok := r.ProcessMessage(brokerID, item.topic, []byte(item.payload)); ok {
			count++
		}
	}
	slog.Info("completed device scan from history", "broker_id", brokerID, "matched_messages", count)
	return nil
}
