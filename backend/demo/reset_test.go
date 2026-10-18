package demo_test

import (
	"os"
	"path/filepath"
	"testing"

	"mqtt-dashboard/cron"
	"mqtt-dashboard/db"
	"mqtt-dashboard/demo"
	"mqtt-dashboard/logic"
	mqttclient "mqtt-dashboard/mqtt"
	"mqtt-dashboard/ws"
)

func TestResetDatabase(t *testing.T) {
	dbFile := filepath.Join(t.TempDir(), "test.db")
	database, err := db.InitDB(dbFile)
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	registry := mqttclient.NewRegistry(database)
	scheduler, err := cron.NewScheduler(registry)
	if err != nil {
		t.Fatalf("NewScheduler: %v", err)
	}
	logicEngine := logic.NewEngine(registry)
	defer logicEngine.Stop()
	wsHub := ws.NewHub(registry, database)

	// Seed some custom data that should be wiped
	_, err = database.Exec(`INSERT INTO dashboards (id, name) VALUES ('custom-dash', 'Custom Dashboard')`)
	if err != nil {
		t.Fatalf("insert dashboard: %v", err)
	}
	_, err = database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload, qos, retained, timestamp) VALUES ('b1', 'foo', 'bar', 0, 0, '2026-01-01 00:00:00')`)
	if err != nil {
		t.Fatalf("insert history: %v", err)
	}
	_, err = database.Exec(`UPDATE app_settings SET retention_period_hours = 99 WHERE id = 1`)
	if err != nil {
		t.Fatalf("update settings: %v", err)
	}

	// Create a temp seed file
	seedContent := `{
		"settings": {
			"retention_period_hours": 24,
			"save_sys_topics": false
		},
		"brokers": [
			{
				"id": "plain-local-broker",
				"name": "Mosquitto (Plain)",
				"host": "localhost",
				"port": 1883,
				"is_enabled": false
			}
		],
		"dashboards": [
			{
				"id": "default",
				"name": "Home Automation",
				"panels": [
					{
						"title": "Living Room Temp",
						"panel_type": "metric",
						"w": 4,
						"h": 3,
						"broker_id": "plain-local-broker"
					}
				]
			}
		]
	}`
	seedPath := filepath.Join(t.TempDir(), "dev-seed.json")
	if err := os.WriteFile(seedPath, []byte(seedContent), 0o644); err != nil {
		t.Fatalf("write seed file: %v", err)
	}

	demo.ResetDatabase(database, registry, scheduler, logicEngine, wsHub, seedPath)

	// Verify custom dash is gone and default dash is renamed
	var dashCount int
	if err := database.QueryRow(`SELECT COUNT(*) FROM dashboards`).Scan(&dashCount); err != nil || dashCount != 1 {
		t.Errorf("expected 1 dashboard remaining, got %d (err: %v)", dashCount, err)
	}
	var dashName string
	if err := database.QueryRow(`SELECT name FROM dashboards WHERE id = 'default'`).Scan(&dashName); err != nil || dashName != "Home Automation" {
		t.Errorf("expected default dashboard name 'Home Automation', got %q", dashName)
	}

	// Verify history wiped
	var histCount int
	if err := database.QueryRow(`SELECT COUNT(*) FROM mqtt_history`).Scan(&histCount); err != nil || histCount != 0 {
		t.Errorf("expected 0 history records, got %d", histCount)
	}

	// Verify broker seeded
	var brokerCount int
	if err := database.QueryRow(`SELECT COUNT(*) FROM mqtt_brokers WHERE id = 'plain-local-broker'`).Scan(&brokerCount); err != nil || brokerCount != 1 {
		t.Errorf("expected 1 seeded broker, got %d", brokerCount)
	}

	// Verify panels seeded
	var panelCount int
	if err := database.QueryRow(`SELECT COUNT(*) FROM dashboard_layouts WHERE dashboard_id = 'default'`).Scan(&panelCount); err != nil || panelCount != 1 {
		t.Errorf("expected 1 seeded panel, got %d", panelCount)
	}

	// Verify app settings reset
	var retention int
	if err := database.QueryRow(`SELECT retention_period_hours FROM app_settings WHERE id = 1`).Scan(&retention); err != nil || retention != 24 {
		t.Errorf("expected retention 24, got %d", retention)
	}
}

func TestSetupAutoReset(t *testing.T) {
	dbFile := filepath.Join(t.TempDir(), "test.db")
	database, err := db.InitDB(dbFile)
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	registry := mqttclient.NewRegistry(database)
	scheduler, err := cron.NewScheduler(registry)
	if err != nil {
		t.Fatalf("NewScheduler: %v", err)
	}
	scheduler.Start()
	defer scheduler.Stop()
	logicEngine := logic.NewEngine(registry)
	defer logicEngine.Stop()
	wsHub := ws.NewHub(registry, database)

	// Test disabled
	if err := demo.SetupAutoReset(database, registry, scheduler, logicEngine, wsHub, "", "off"); err != nil {
		t.Errorf("expected no error when disabled, got %v", err)
	}

	// Test invalid cron
	if err := demo.SetupAutoReset(database, registry, scheduler, logicEngine, wsHub, "", "invalid-cron"); err == nil {
		t.Error("expected error for invalid cron expression")
	}

	// Test valid cron
	if err := demo.SetupAutoReset(database, registry, scheduler, logicEngine, wsHub, "", "0 */5 * * *"); err != nil {
		t.Errorf("expected successful schedule, got %v", err)
	}
}

func TestResetDatabase_NilSafe(t *testing.T) {
	demo.ResetDatabase(nil, nil, nil, nil, nil, "")
}
