package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	mqttclient "mqtt-dashboard/mqtt"
)

type PublishHandler struct {
	db       *sql.DB
	registry *mqttclient.BrokerRegistry
}

func NewPublishHandler(db *sql.DB, registry *mqttclient.BrokerRegistry) *PublishHandler {
	return &PublishHandler{db: db, registry: registry}
}

func (h *PublishHandler) Publish(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BrokerID string `json:"broker_id"`
		Topic    string `json:"topic"`
		Payload  string `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Topic == "" {
		http.Error(w, "topic is required", http.StatusBadRequest)
		return
	}

	brokerID := req.BrokerID
	if brokerID == "" {
		brokerID = h.registry.DefaultBrokerID()
	}
	if brokerID == "" {
		http.Error(w, "no broker available", http.StatusServiceUnavailable)
		return
	}

	if err := h.registry.Publish(brokerID, req.Topic, []byte(req.Payload)); err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "published"})
}
