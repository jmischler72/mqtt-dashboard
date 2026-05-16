package models

import "encoding/json"

type MQTTConfig struct {
	ID       int    `json:"id"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	ClientID string `json:"client_id"`
	Username string `json:"username"`
	Password string `json:"-"` // never serialized to client
	IsActive bool   `json:"is_active"`
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
