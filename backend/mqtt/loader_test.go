package mqtt

import (
	"testing"

	"mqtt-dashboard/db"
	"mqtt-dashboard/models"
)

func TestAutoConnectFromDB(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	registry := NewRegistry(database)

	// Nil safety
	AutoConnectFromDB(nil, registry)
	AutoConnectFromDB(database, nil)

	_, err = database.Exec(`
		INSERT INTO mqtt_brokers (id, name, host, port, is_enabled, sort_order)
		VALUES 
			('b1', 'Broker 1', 'localhost', 1883, 1, 0),
			('b2', 'Broker 2', 'localhost', 1884, 0, 1)
	`)
	if err != nil {
		t.Fatalf("insert brokers: %v", err)
	}

	AutoConnectFromDB(database, registry)

	if registry.DefaultBrokerID() != "b1" {
		t.Errorf("DefaultBrokerID = %q, want 'b1'", registry.DefaultBrokerID())
	}

	// Test with closed DB
	dbClosed, _ := db.InitDB(":memory:")
	dbClosed.Close()
	AutoConnectFromDB(dbClosed, registry)
}

func TestRemoveAllBrokers(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	registry := NewRegistry(database)
	_ = registry.AddBroker(models.MQTTBroker{ID: "b1", Name: "Broker 1", Host: "127.0.0.1", Port: 1883})
	_ = registry.AddBroker(models.MQTTBroker{ID: "b2", Name: "Broker 2", Host: "127.0.0.1", Port: 1884})

	registry.RemoveAllBrokers()

	if len(registry.AllStatuses()) != 0 {
		t.Errorf("expected 0 brokers after RemoveAllBrokers, got %d", len(registry.AllStatuses()))
	}
}
