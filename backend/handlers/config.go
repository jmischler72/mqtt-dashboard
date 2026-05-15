package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"mqtt-dashboard/models"
	mqttclient "mqtt-dashboard/mqtt"
)

type ConfigHandler struct {
	db   *sql.DB
	mqtt *mqttclient.MQTTManager
}

func NewConfigHandler(db *sql.DB, mqtt *mqttclient.MQTTManager) *ConfigHandler {
	return &ConfigHandler{db: db, mqtt: mqtt}
}

func (h *ConfigHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	row := h.db.QueryRow(`SELECT id, host, port, client_id, username, is_active FROM mqtt_configurations WHERE is_active = 1 ORDER BY id DESC LIMIT 1`)
	var cfg models.MQTTConfig
	err := row.Scan(&cfg.ID, &cfg.Host, &cfg.Port, &cfg.ClientID, &cfg.Username, &cfg.IsActive)
	if err == sql.ErrNoRows {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{})
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg)
}

func (h *ConfigHandler) SaveConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Host     string `json:"host"`
		Port     string `json:"port"`
		ClientID string `json:"client_id"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	port, err := strconv.Atoi(req.Port)
	if err != nil || port < 1 || port > 65535 {
		http.Error(w, "invalid port", http.StatusBadRequest)
		return
	}
	if req.Host == "" {
		http.Error(w, "host is required", http.StatusBadRequest)
		return
	}

	// Deactivate old configs
	if _, err := h.db.Exec(`UPDATE mqtt_configurations SET is_active = 0`); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	res, err := h.db.Exec(
		`INSERT INTO mqtt_configurations (host, port, client_id, username, password, is_active) VALUES (?, ?, ?, ?, ?, 1)`,
		req.Host, port, req.ClientID, req.Username, req.Password,
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	id, _ := res.LastInsertId()

	cfg := models.MQTTConfig{
		ID:       int(id),
		Host:     req.Host,
		Port:     port,
		ClientID: req.ClientID,
		Username: req.Username,
		Password: req.Password,
		IsActive: true,
	}

	if err := h.mqtt.Connect(cfg); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ERROR", "error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "CONNECTED"})
}

func (h *ConfigHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": h.mqtt.Status()})
}
