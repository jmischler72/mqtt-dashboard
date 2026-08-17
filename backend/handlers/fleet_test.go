package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"mqtt-dashboard/db"
	"mqtt-dashboard/handlers"
	"mqtt-dashboard/models"
	mqttclient "mqtt-dashboard/mqtt"
)

func TestFleetHandler_GetDevicesAndTopology(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	defer database.Close()

	registry := mqttclient.NewRegistry(database)
	h := handlers.NewFleetHandler(database, registry)

	brokerID := "broker-1"

	// Seed test data in mqtt_history
	_, err = database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload, qos, retained) VALUES 
		(?, 'homeassistant/sensor/esp32_sensor/config', '{"name":"Living Room Sensor","state_topic":"livingroom/state","device":{"name":"Living Room Sensor","model":"ESP32-S3","manufacturer":"Espressif","sw_version":"v2.1","connections":[["mac","AA:BB:CC:DD:EE:FF"]]}}', 0, 0),
		(?, 'livingroom/status', 'online', 0, 0),
		(?, 'livingroom/telemetry', '{"ip":"192.168.1.105","rssi":-55,"uptime":3600}', 0, 0),
		(?, 'homie/light-1/$name', 'Kitchen Light', 0, 0),
		(?, 'homie/light-1/$state', 'ready', 0, 0),
		(?, 'homie/light-1/$mac', '11:22:33:44:55:66', 0, 0),
		(?, 'homie/light-1/$localip', '192.168.1.110', 0, 0)`,
		brokerID, brokerID, brokerID, brokerID, brokerID, brokerID, brokerID,
	)
	if err != nil {
		t.Fatalf("Failed to seed mqtt_history: %v", err)
	}

	// Test GET /api/fleet/devices
	req := httptest.NewRequest("GET", "/api/fleet/devices?broker_id="+brokerID, nil)
	w := httptest.NewRecorder()
	h.GetDevices(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GetDevices returned status %d", w.Code)
	}

	var devices []models.FleetDevice
	if err := json.Unmarshal(w.Body.Bytes(), &devices); err != nil {
		t.Fatalf("Failed to decode devices response: %v", err)
	}

	if len(devices) < 2 {
		t.Errorf("Expected at least 2 discovered devices, got %d", len(devices))
	}

	foundHA := false
	foundHomie := false

	for _, d := range devices {
		if d.DeviceType == "homeassistant" || d.ID == "esp32-sensor" || d.ID == "livingroom" {
			foundHA = true
		}
		if d.DeviceType == "homie" || d.ID == "light-1" {
			foundHomie = true
		}
	}

	if !foundHA {
		t.Errorf("Expected Home Assistant / ESPHome device in fleet results")
	}
	if !foundHomie {
		t.Errorf("Expected Homie device in fleet results")
	}

	// Test GET /api/fleet/topology
	reqTopo := httptest.NewRequest("GET", "/api/fleet/topology?broker_id="+brokerID, nil)
	wTopo := httptest.NewRecorder()
	h.GetTopology(wTopo, reqTopo)

	if wTopo.Code != http.StatusOK {
		t.Fatalf("GetTopology returned status %d", wTopo.Code)
	}

	var topo models.FleetTopology
	if err := json.Unmarshal(wTopo.Body.Bytes(), &topo); err != nil {
		t.Fatalf("Failed to decode topology response: %v", err)
	}

	if len(topo.Nodes) == 0 {
		t.Errorf("Expected non-empty topology nodes")
	}
}

func TestFleetHandler_SendCommand(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	defer database.Close()

	registry := mqttclient.NewRegistry(database)
	h := handlers.NewFleetHandler(database, registry)

	// Test missing topic
	body, _ := json.Marshal(map[string]string{"broker_id": "test", "topic": ""})
	req := httptest.NewRequest("POST", "/api/fleet/devices/test/command", bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.SendCommand(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 status for missing topic, got %d", w.Code)
	}
}
