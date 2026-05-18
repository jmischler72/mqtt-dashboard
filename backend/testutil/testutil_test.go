package testutil

import (
	"encoding/json"
	"testing"

	"mqtt-dashboard/models"
)

func TestSeedHelpers_InsertExpectedRows(t *testing.T) {
	database := SetupTestDB(t)

	SeedBroker(t, database, models.MQTTBroker{
		ID:        "b1",
		Name:      "Broker 1",
		Host:      "localhost",
		Port:      1883,
		ClientID:  "cid-1",
		Username:  "user",
		Password:  "pass",
		IsEnabled: true,
		SortOrder: 0,
	})
	SeedDashboard(t, database, "dash-1", "Main")
	SeedPanel(t, database, models.DashboardPanel{
		ID:          "panel-1",
		DashboardID: "dash-1",
		Title:       "Input",
		PanelType:   "input",
		X:           1,
		Y:           2,
		W:           3,
		H:           4,
		ConfigJSON:  json.RawMessage(`{"topic":"a/b"}`),
		BrokerID:    "b1",
	})
	SeedHistory(t, database, "b1", "sensor/temp", "21")

	var brokerCount, dashboardCount, panelCount, historyCount int
	database.QueryRow(`SELECT COUNT(*) FROM mqtt_brokers WHERE id = 'b1'`).Scan(&brokerCount)
	database.QueryRow(`SELECT COUNT(*) FROM dashboards WHERE id = 'dash-1'`).Scan(&dashboardCount)
	database.QueryRow(`SELECT COUNT(*) FROM dashboard_layouts WHERE id = 'panel-1'`).Scan(&panelCount)
	database.QueryRow(`SELECT COUNT(*) FROM mqtt_history WHERE broker_id = 'b1' AND topic = 'sensor/temp'`).Scan(&historyCount)

	if brokerCount != 1 {
		t.Fatalf("expected broker row to be inserted, got count=%d", brokerCount)
	}
	if dashboardCount != 1 {
		t.Fatalf("expected dashboard row to be inserted, got count=%d", dashboardCount)
	}
	if panelCount != 1 {
		t.Fatalf("expected panel row to be inserted, got count=%d", panelCount)
	}
	if historyCount != 1 {
		t.Fatalf("expected history row to be inserted, got count=%d", historyCount)
	}
}

func TestSeedPanel_DefaultConfigJSONWhenEmpty(t *testing.T) {
	database := SetupTestDB(t)
	SeedDashboard(t, database, "dash-1", "Main")

	SeedPanel(t, database, models.DashboardPanel{
		ID:          "panel-empty-config",
		DashboardID: "dash-1",
		Title:       "Panel",
		PanelType:   "log",
		X:           0,
		Y:           0,
		W:           2,
		H:           2,
		BrokerID:    "",
	})

	var cfg string
	if err := database.QueryRow(`SELECT config_json FROM dashboard_layouts WHERE id = 'panel-empty-config'`).Scan(&cfg); err != nil {
		t.Fatalf("query panel config: %v", err)
	}
	if cfg != "{}" {
		t.Fatalf("expected default config_json '{}', got %q", cfg)
	}
}
