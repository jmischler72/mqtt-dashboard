package handlers

import (
	"encoding/json"
	"net/http"

	mqttclient "mqtt-dashboard/mqtt"
)

type PublishHandler struct {
	mqtt *mqttclient.MQTTManager
}

func NewPublishHandler(mqtt *mqttclient.MQTTManager) *PublishHandler {
	return &PublishHandler{mqtt: mqtt}
}

func (h *PublishHandler) Publish(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Topic   string `json:"topic"`
		Payload string `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Topic == "" {
		http.Error(w, "topic is required", http.StatusBadRequest)
		return
	}

	if h.mqtt.Status() != "CONNECTED" {
		http.Error(w, "not connected to broker", http.StatusServiceUnavailable)
		return
	}

	if err := h.mqtt.Publish(req.Topic, []byte(req.Payload)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "published"})
}
