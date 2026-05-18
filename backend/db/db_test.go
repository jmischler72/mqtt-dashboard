package db_test

import (
	"testing"

	"mqtt-dashboard/db"
)

func TestInitDB_InMemory(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	if err := database.Ping(); err != nil {
		t.Fatalf("Ping after init: %v", err)
	}
}

func TestMigrate_CreatesAllTables(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	tables := []string{"mqtt_brokers", "dashboards", "dashboard_layouts", "app_settings", "mqtt_history"}
	for _, table := range tables {
		var name string
		if err := database.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&name); err != nil {
			t.Errorf("table %q not found: %v", table, err)
		}
	}
}

func TestMigrate_SeedsDefaultDashboard(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	var id, name string
	if err := database.QueryRow(`SELECT id, name FROM dashboards WHERE id = 'default'`).Scan(&id, &name); err != nil {
		t.Fatalf("default dashboard not seeded: %v", err)
	}
	if id != "default" {
		t.Errorf("id = %q, want 'default'", id)
	}
	if name != "Default" {
		t.Errorf("name = %q, want 'Default'", name)
	}
}

func TestMigrate_SeedsDefaultSettings(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	var hours int
	if err := database.QueryRow(`SELECT retention_period_hours FROM app_settings WHERE id = 1`).Scan(&hours); err != nil {
		t.Fatalf("app_settings not seeded: %v", err)
	}
	if hours != 24 {
		t.Errorf("retention_period_hours = %d, want 24", hours)
	}
}

func TestInitDB_CanInsertAndQuery(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	_, err = database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, sort_order) VALUES ('b1', 'Test', 'localhost', 1883, 0)`)
	if err != nil {
		t.Fatalf("insert broker: %v", err)
	}

	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM mqtt_brokers WHERE id='b1'`).Scan(&count); err != nil {
		t.Fatalf("query: %v", err)
	}
	if count != 1 {
		t.Errorf("count = %d, want 1", count)
	}
}

func TestMigrate_IdxOnMqttHistory(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	var name string
	if err := database.QueryRow(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_mqtt_history_broker_topic_time'`).Scan(&name); err != nil {
		t.Errorf("index idx_mqtt_history_broker_topic_time not found: %v", err)
	}
}
