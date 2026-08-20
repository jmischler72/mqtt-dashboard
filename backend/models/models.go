package models

import "encoding/json"

type MQTTBroker struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	ClientID    string `json:"client_id"`
	Username    string `json:"username"`
	Password    string `json:"-"` // never serialized to client
	IsEnabled   bool   `json:"is_enabled"`
	SortOrder   int    `json:"sort_order"`
	Status      string `json:"status,omitempty"`       // runtime field, not stored in DB
	StatusError string `json:"status_error,omitempty"` // last connection error, runtime only

	// Authentication mode: "none" | "password" | "certificate"
	AuthMode string `json:"auth_mode"`

	// TLS configuration
	TLSEnabled    bool   `json:"tls_enabled"`
	TLSSkipVerify bool   `json:"tls_skip_verify"`
	CACert        string `json:"-"` // PEM content, never serialized
	ClientCert    string `json:"-"` // PEM content, never serialized
	ClientKey     string `json:"-"` // PEM content, never serialized

	// Presence indicators (no sensitive content)
	HasCACert     bool `json:"has_ca_cert"`
	HasClientCert bool `json:"has_client_cert"`
}

type Dashboard struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

type DashboardPanel struct {
	ID          string          `json:"id"`
	DashboardID string          `json:"dashboard_id"`
	Title       string          `json:"title"`
	PanelType   string          `json:"panel_type"`
	X           int             `json:"x"`
	Y           int             `json:"y"`
	W           int             `json:"w"`
	H           int             `json:"h"`
	ConfigJSON  json.RawMessage `json:"config_json"`
	BrokerID    string          `json:"broker_id"`
}

type BatchLayoutUpdate struct {
	Panels []PanelPosition `json:"panels"`
}

type PanelPosition struct {
	ID string `json:"id"`
	X  int    `json:"x"`
	Y  int    `json:"y"`
	W  int    `json:"w"`
	H  int    `json:"h"`
}

type AppSettings struct {
	RetentionPeriodHours int  `json:"retention_period_hours"`
	SaveSysTopics        bool `json:"save_sys_topics"`
}

type MQTTHistoryRecord struct {
	ID        int    `json:"id"`
	BrokerID  string `json:"broker_id"`
	Topic     string `json:"topic"`
	Payload   string `json:"payload"`
	Timestamp string `json:"timestamp"`
	QoS       int    `json:"qos"`
	Retained  bool   `json:"retained"`
}

type BrokerStats struct {
	Version            string `json:"version"`
	Uptime             int64  `json:"uptime"` // seconds
	ClientsConnected   int    `json:"clients_connected"`
	MessagesSent       int64  `json:"messages_sent"`
	MessagesReceived   int64  `json:"messages_received"`
	Messages5mSent     int64  `json:"messages_5m_sent"`
	Messages5mReceived int64  `json:"messages_5m_received"`
	MemoryUsed         int64  `json:"memory_used"` // bytes
	MemoryMax          int64  `json:"memory_max"`  // bytes
	UpdatedAt          string `json:"updated_at"`  // ISO 8601 timestamp
}

type FleetDevice struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	BrokerID   string   `json:"broker_id"`
	Status     string   `json:"status"` // "online" | "offline" | "unknown"
	MAC        string   `json:"mac,omitempty"`
	IP         string   `json:"ip,omitempty"`
	Firmware   string   `json:"firmware,omitempty"`
	Hardware   string   `json:"hardware,omitempty"`
	DeviceType string   `json:"device_type"` // "esphome" | "homeassistant" | "tasmota" | "homie" | "generic"
	RSSI       int      `json:"rssi,omitempty"`
	Uptime     int64    `json:"uptime,omitempty"`
	BaseTopic  string   `json:"base_topic"`
	Topics     []string `json:"topics"`
	LastSeen   string   `json:"last_seen"`
}

type TopologyNode struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Type   string `json:"type"` // "broker" | "gateway" | "device"
	Status string `json:"status"`
	MAC    string `json:"mac,omitempty"`
	IP     string `json:"ip,omitempty"`
}

type TopologyLink struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Status string `json:"status,omitempty"`
}

type FleetTopology struct {
	Nodes []TopologyNode `json:"nodes"`
	Links []TopologyLink `json:"links"`
}

