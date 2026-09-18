package devices

import (
	"testing"
)

func TestDetectHomie(t *testing.T) {
	brokerID := "b1"

	// $name
	u, ok := DetectDeviceUpdate(brokerID, "homie/kitchen-plug/$name", []byte("Kitchen Smart Plug"))
	if !ok || u == nil {
		t.Fatalf("expected homie update for $name, got ok=%v", ok)
	}
	if u.ID != "kitchen-plug" || u.Name != "Kitchen Smart Plug" || u.Convention != "homie" {
		t.Errorf("unexpected update: %+v", u)
	}

	// $state
	u, ok = DetectDeviceUpdate(brokerID, "homie/kitchen-plug/$state", []byte("ready"))
	if !ok || u.Status != "online" {
		t.Errorf("expected online status, got: %+v", u)
	}

	u, ok = DetectDeviceUpdate(brokerID, "homie/kitchen-plug/$state", []byte("lost"))
	if !ok || u.Status != "offline" {
		t.Errorf("expected offline status, got: %+v", u)
	}

	// $mac and $localip
	u, ok = DetectDeviceUpdate(brokerID, "homie/kitchen-plug/$mac", []byte("30:AE:A4:77:88:99"))
	if !ok || u.MACAddress != "30:AE:A4:77:88:99" {
		t.Errorf("expected MAC, got: %+v", u)
	}

	u, ok = DetectDeviceUpdate(brokerID, "homie/kitchen-plug/$localip", []byte("192.168.1.112"))
	if !ok || u.IPAddress != "192.168.1.112" {
		t.Errorf("expected IP, got: %+v", u)
	}

	// $implementation
	u, ok = DetectDeviceUpdate(brokerID, "homie/kitchen-plug/$implementation", []byte("ESP8266-Relay"))
	if !ok || u.Hardware != "ESP8266-Relay" {
		t.Errorf("expected Hardware, got: %+v", u)
	}
}

func TestDetectHomeAssistant(t *testing.T) {
	brokerID := "b1"
	payload := []byte(`{
		"name": "Living Room Sensor",
		"state_topic": "livingroom/sensor/temp",
		"command_topic": "livingroom/sensor/set",
		"device": {
			"identifiers": ["livingroom-sensor-01"],
			"name": "Living Room MultiSensor",
			"model": "ESP32-S3",
			"manufacturer": "ESPHome",
			"sw_version": "2024.6.0",
			"connections": [["mac", "48:E7:29:A0:11:BC"], ["ip", "192.168.1.130"]]
		}
	}`)

	u, ok := DetectDeviceUpdate(brokerID, "homeassistant/sensor/livingroom/temp/config", payload)
	if !ok || u == nil {
		t.Fatalf("expected HA discovery update, got ok=%v", ok)
	}

	if u.ID != "livingroom-sensor-01" {
		t.Errorf("expected ID livingroom-sensor-01, got %q", u.ID)
	}
	if u.Name != "Living Room MultiSensor" {
		t.Errorf("expected Name Living Room MultiSensor, got %q", u.Name)
	}
	if u.Convention != "esphome" {
		t.Errorf("expected Convention esphome due to manufacturer, got %q", u.Convention)
	}
	if u.MACAddress != "48:E7:29:A0:11:BC" {
		t.Errorf("expected MAC 48:E7:29:A0:11:BC, got %q", u.MACAddress)
	}
	if u.IPAddress != "192.168.1.130" {
		t.Errorf("expected IP 192.168.1.130, got %q", u.IPAddress)
	}
	if u.Hardware != "ESP32-S3" {
		t.Errorf("expected Hardware ESP32-S3, got %q", u.Hardware)
	}
}

func TestDetectTasmota(t *testing.T) {
	brokerID := "b1"

	u, ok := DetectDeviceUpdate(brokerID, "tele/tasmota_plug/LWT", []byte("Online"))
	if !ok || u.Status != "online" || u.Convention != "tasmota" {
		t.Errorf("expected Tasmota online, got: %+v", u)
	}

	info2 := []byte(`{"IPAddress":"192.168.1.105","Hostname":"Livingroom Esp32"}`)
	u, ok = DetectDeviceUpdate(brokerID, "tele/tasmota_plug/INFO2", info2)
	if !ok || u.IPAddress != "192.168.1.105" || u.Name != "Livingroom Esp32" {
		t.Errorf("expected Tasmota INFO2 parsing, got: %+v", u)
	}
}

func TestDetectESPHome(t *testing.T) {
	brokerID := "b1"

	u, ok := DetectDeviceUpdate(brokerID, "office-air/status", []byte("online"))
	if !ok || u.Status != "online" || u.Convention != "esphome" || u.ID != "office-air" {
		t.Errorf("expected ESPHome status, got: %+v", u)
	}

	u, ok = DetectDeviceUpdate(brokerID, "office-air/ip", []byte("192.168.1.120"))
	if !ok || u.IPAddress != "192.168.1.120" {
		t.Errorf("expected ESPHome IP, got: %+v", u)
	}
}

func TestDetectGeneric(t *testing.T) {
	brokerID := "b1"

	u, ok := DetectDeviceUpdate(brokerID, "custom-gadget/availability", []byte("online"))
	if !ok || u.Status != "online" || u.Convention != "generic" || u.ID != "custom-gadget" {
		t.Errorf("expected generic status, got: %+v", u)
	}
}
