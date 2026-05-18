package testutil

import (
	"database/sql"
	"testing"

	"mqtt-dashboard/db"
	"mqtt-dashboard/models"
)

// SetupTestDB creates an in-memory SQLite database with all migrations applied.
func SetupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("setup test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

// SeedBroker inserts a broker into the test database.
func SeedBroker(t *testing.T, database *sql.DB, b models.MQTTBroker) {
	t.Helper()
	_, err := database.Exec(
		`INSERT INTO mqtt_brokers (id, name, host, port, client_id, username, password, is_enabled, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		b.ID, b.Name, b.Host, b.Port, b.ClientID, b.Username, b.Password, b.IsEnabled, b.SortOrder,
	)
	if err != nil {
		t.Fatalf("seed broker: %v", err)
	}
}

// SeedDashboard inserts a dashboard into the test database.
func SeedDashboard(t *testing.T, database *sql.DB, id, name string) {
	t.Helper()
	_, err := database.Exec(`INSERT OR IGNORE INTO dashboards (id, name) VALUES (?, ?)`, id, name)
	if err != nil {
		t.Fatalf("seed dashboard: %v", err)
	}
}

// SeedPanel inserts a panel into the test database.
func SeedPanel(t *testing.T, database *sql.DB, p models.DashboardPanel) {
	t.Helper()
	cfgJSON := "{}"
	if len(p.ConfigJSON) > 0 {
		cfgJSON = string(p.ConfigJSON)
	}
	_, err := database.Exec(
		`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.DashboardID, p.Title, p.PanelType, p.X, p.Y, p.W, p.H, cfgJSON, p.BrokerID,
	)
	if err != nil {
		t.Fatalf("seed panel: %v", err)
	}
}

// SeedHistory inserts a history record into the test database.
func SeedHistory(t *testing.T, database *sql.DB, brokerID, topic, payload string) {
	t.Helper()
	_, err := database.Exec(
		`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES (?, ?, ?)`,
		brokerID, topic, payload,
	)
	if err != nil {
		t.Fatalf("seed history: %v", err)
	}
}
