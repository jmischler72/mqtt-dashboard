package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/models"
)

type DeviceTracker interface {
	GetDevices(brokerID string) []*models.Device
	GetDevice(brokerID, id string) (*models.Device, bool)
	ScanHistory(brokerID string) error
}

type DevicesHandler struct {
	devices  DeviceTracker
	registry BrokerRegistry
}

func NewDevicesHandler(devices DeviceTracker, registry BrokerRegistry) *DevicesHandler {
	return &DevicesHandler{
		devices:  devices,
		registry: registry,
	}
}

// GetDevices returns all discovered devices for the specified brokerID.
func (h *DevicesHandler) GetDevices(w http.ResponseWriter, r *http.Request) {
	brokerID := r.URL.Query().Get("broker_id")
	if brokerID == "" {
		brokerID = h.registry.DefaultBrokerID()
	}
	if brokerID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]*models.Device{})
		return
	}

	devs := h.devices.GetDevices(brokerID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(devs)
}

// GetDevice returns details of a single device.
func (h *DevicesHandler) GetDevice(w http.ResponseWriter, r *http.Request) {
	brokerID := r.URL.Query().Get("broker_id")
	if brokerID == "" {
		brokerID = h.registry.DefaultBrokerID()
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		http.Error(w, "device id is required", http.StatusBadRequest)
		return
	}

	dev, ok := h.devices.GetDevice(brokerID, id)
	if !ok || dev == nil {
		http.Error(w, "device not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dev)
}

// RestartDevice sends a restart command tailored to the device's convention.
func (h *DevicesHandler) RestartDevice(w http.ResponseWriter, r *http.Request) {
	brokerID := r.URL.Query().Get("broker_id")
	if brokerID == "" {
		brokerID = h.registry.DefaultBrokerID()
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		http.Error(w, "device id is required", http.StatusBadRequest)
		return
	}

	dev, ok := h.devices.GetDevice(brokerID, id)
	if !ok || dev == nil {
		http.Error(w, "device not found", http.StatusNotFound)
		return
	}

	var topic, payload string
	switch dev.Convention {
	case "homie":
		topic = fmt.Sprintf("%s/command", dev.BaseTopic)
		payload = "restart"
	case "tasmota":
		topic = fmt.Sprintf("cmnd/%s/Restart", dev.ID)
		payload = "1"
	case "esphome":
		if dev.CommandTopic != "" {
			topic = dev.CommandTopic
			payload = "PRESS"
		} else {
			topic = fmt.Sprintf("%s/button/restart/command", dev.BaseTopic)
			payload = "PRESS"
		}
	default:
		if dev.CommandTopic != "" {
			topic = dev.CommandTopic
			payload = "restart"
		} else {
			topic = fmt.Sprintf("%s/command", dev.BaseTopic)
			payload = "restart"
		}
	}

	if err := h.registry.Publish(brokerID, topic, 1, false, []byte(payload)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "restart_sent",
		"topic":   topic,
		"payload": payload,
	})
}

// PingDevice sends a ping/status request to the device.
func (h *DevicesHandler) PingDevice(w http.ResponseWriter, r *http.Request) {
	brokerID := r.URL.Query().Get("broker_id")
	if brokerID == "" {
		brokerID = h.registry.DefaultBrokerID()
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		http.Error(w, "device id is required", http.StatusBadRequest)
		return
	}

	dev, ok := h.devices.GetDevice(brokerID, id)
	if !ok || dev == nil {
		http.Error(w, "device not found", http.StatusNotFound)
		return
	}

	var topic, payload string
	switch dev.Convention {
	case "tasmota":
		topic = fmt.Sprintf("cmnd/%s/Status", dev.ID)
		payload = ""
	case "homie":
		topic = fmt.Sprintf("%s/command", dev.BaseTopic)
		payload = "ping"
	default:
		topic = fmt.Sprintf("%s/command", dev.BaseTopic)
		payload = "ping"
	}

	if err := h.registry.Publish(brokerID, topic, 0, false, []byte(payload)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ping_sent",
		"topic":   topic,
		"payload": payload,
	})
}

// SendCommand sends a custom payload to the device.
func (h *DevicesHandler) SendCommand(w http.ResponseWriter, r *http.Request) {
	brokerID := r.URL.Query().Get("broker_id")
	if brokerID == "" {
		brokerID = h.registry.DefaultBrokerID()
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		http.Error(w, "device id is required", http.StatusBadRequest)
		return
	}

	dev, ok := h.devices.GetDevice(brokerID, id)
	if !ok || dev == nil {
		http.Error(w, "device not found", http.StatusNotFound)
		return
	}

	var req struct {
		Payload string `json:"payload"`
		Topic   string `json:"topic"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	targetTopic := strings.TrimSpace(req.Topic)
	if targetTopic == "" {
		if dev.CommandTopic != "" {
			targetTopic = dev.CommandTopic
		} else {
			targetTopic = fmt.Sprintf("%s/command", dev.BaseTopic)
		}
	} else if !strings.HasPrefix(targetTopic, dev.BaseTopic+"/") && targetTopic != dev.BaseTopic &&
		!strings.HasPrefix(targetTopic, "homie/") && !strings.HasPrefix(targetTopic, "cmnd/") &&
		!strings.HasPrefix(targetTopic, "tele/") && !strings.HasPrefix(targetTopic, "stat/") {
		targetTopic = fmt.Sprintf("%s/%s", strings.TrimSuffix(dev.BaseTopic, "/"), strings.TrimPrefix(targetTopic, "/"))
	}

	if err := h.registry.Publish(brokerID, targetTopic, 0, false, []byte(req.Payload)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "command_sent",
		"topic":   targetTopic,
		"payload": req.Payload,
	})
}

// RescanHistory triggers a historical scan of mqtt_history to discover devices.
func (h *DevicesHandler) RescanHistory(w http.ResponseWriter, r *http.Request) {
	brokerID := r.URL.Query().Get("broker_id")
	if brokerID == "" {
		brokerID = h.registry.DefaultBrokerID()
	}
	if brokerID == "" {
		http.Error(w, "broker_id required", http.StatusBadRequest)
		return
	}

	if err := h.devices.ScanHistory(brokerID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "rescan_complete",
	})
}
