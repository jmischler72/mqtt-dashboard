package devices

import (
	"testing"

	"mqtt-dashboard/db"
)

func TestDeviceRegistry_ProcessAndQuery(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("failed to init in-memory db: %v", err)
	}
	defer database.Close()

	registry := NewDeviceRegistry(database)
	brokerID := "broker-1"

	// 1. Homie device messages
	registry.ProcessMessage(brokerID, "homie/kitchen-plug/$homie", []byte("4.0.0"))
	registry.ProcessMessage(brokerID, "homie/kitchen-plug/$name", []byte("Kitchen Smart Plug"))
	registry.ProcessMessage(brokerID, "homie/kitchen-plug/$state", []byte("ready"))
	registry.ProcessMessage(brokerID, "homie/kitchen-plug/$mac", []byte("30:AE:A4:77:88:99"))
	registry.ProcessMessage(brokerID, "homie/kitchen-plug/$localip", []byte("192.168.1.112"))
	registry.ProcessMessage(brokerID, "homie/kitchen-plug/$implementation", []byte("ESP8266-Relay"))

	devices := registry.GetDevices(brokerID)
	if len(devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(devices))
	}

	dev := devices[0]
	if dev.ID != "kitchen-plug" {
		t.Errorf("expected id kitchen-plug, got %s", dev.ID)
	}
	if dev.Name != "Kitchen Smart Plug" {
		t.Errorf("expected name Kitchen Smart Plug, got %s", dev.Name)
	}
	if dev.Status != "online" {
		t.Errorf("expected status online, got %s", dev.Status)
	}
	if dev.IPAddress != "192.168.1.112" {
		t.Errorf("expected IP 192.168.1.112, got %s", dev.IPAddress)
	}
	if dev.MACAddress != "30:AE:A4:77:88:99" {
		t.Errorf("expected MAC 30:AE:A4:77:88:99, got %s", dev.MACAddress)
	}
	if dev.Hardware != "ESP8266-Relay" {
		t.Errorf("expected Hardware ESP8266-Relay, got %s", dev.Hardware)
	}

	// 2. Fetch single device
	d, ok := registry.GetDevice(brokerID, "kitchen-plug")
	if !ok || d == nil {
		t.Fatalf("expected to get device kitchen-plug")
	}
	if d.Name != "Kitchen Smart Plug" {
		t.Errorf("expected name Kitchen Smart Plug, got %s", d.Name)
	}
}

func TestDeviceRegistry_PersistenceAndReload(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("failed to init in-memory db: %v", err)
	}
	defer database.Close()

	registry1 := NewDeviceRegistry(database)
	brokerID := "b1"

	registry1.ProcessMessage(brokerID, "homie/living-room/$name", []byte("Living Room Plug"))
	registry1.ProcessMessage(brokerID, "homie/living-room/$state", []byte("ready"))
	registry1.ProcessMessage(brokerID, "homie/living-room/$mac", []byte("48:E7:29:A0:11:BC"))

	// Create a second registry using the same DB to simulate restart
	registry2 := NewDeviceRegistry(database)
	devices := registry2.GetDevices(brokerID)
	if len(devices) != 1 {
		t.Fatalf("expected 1 device reloaded from DB, got %d", len(devices))
	}

	dev := devices[0]
	if dev.Name != "Living Room Plug" || dev.MACAddress != "48:E7:29:A0:11:BC" {
		t.Errorf("unexpected reloaded device: %+v", dev)
	}
}

func TestDeviceRegistry_ScanHistory(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("failed to init in-memory db: %v", err)
	}
	defer database.Close()

	brokerID := "broker-test"
	// Insert historical messages
	_, err = database.Exec(`
		INSERT INTO mqtt_history (broker_id, topic, payload) VALUES
		(?, 'office-air/status', 'online'),
		(?, 'office-air/ip', '192.168.1.120'),
		(?, 'office-air/hardware', 'ESP32')
	`, brokerID, brokerID, brokerID)
	if err != nil {
		t.Fatalf("failed to insert history: %v", err)
	}

	registry := NewDeviceRegistry(database)
	// Initially empty
	if len(registry.GetDevices(brokerID)) != 0 {
		t.Fatalf("expected 0 devices before scan")
	}

	if err := registry.ScanHistory(brokerID); err != nil {
		t.Fatalf("failed to scan history: %v", err)
	}

	devices := registry.GetDevices(brokerID)
	if len(devices) != 1 {
		t.Fatalf("expected 1 device after scan, got %d", len(devices))
	}
	if devices[0].ID != "office-air" || devices[0].IPAddress != "192.168.1.120" {
		t.Errorf("unexpected device from history: %+v", devices[0])
	}
}
