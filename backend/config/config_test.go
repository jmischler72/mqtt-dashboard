package config

import (
	"os"
	"strings"
	"testing"

	"mqtt-dashboard/db"
)

func TestSeedBrokersFromConfig(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	defer database.Close()

	tmpDir := t.TempDir()
	cfgPath := tmpDir + "/config.json"
	os.WriteFile(cfgPath, []byte(`{"brokers":[{"name":"Test Config Broker","host":"localhost","port":1883,"is_enabled":true}]}`), 0600)

	t.Setenv("CONFIG_FILE", cfgPath)
	SeedBrokersFromConfig(database)

	var count int
	row := database.QueryRow(`SELECT COUNT(*) FROM mqtt_brokers WHERE name = 'Test Config Broker'`)
	if err := row.Scan(&count); err != nil || count != 1 {
		t.Fatalf("Expected 1 seeded broker from config file, got count %d (err: %v)", count, err)
	}

	// Verify non-destructive behavior (does NOT duplicate or delete existing brokers)
	SeedBrokersFromConfig(database)
	var countAfterReSeed int
	database.QueryRow(`SELECT COUNT(*) FROM mqtt_brokers WHERE name = 'Test Config Broker'`).Scan(&countAfterReSeed)
	if countAfterReSeed != 1 {
		t.Errorf("Re-seeding should not duplicate or delete existing broker, got count %d", countAfterReSeed)
	}
}

func TestSeedBrokersFromConfig_NilDatabase(t *testing.T) {
	// Must handle nil DB without panic
	SeedBrokersFromConfig(nil)
}

func TestSeedBrokersFromConfig_NonExistentFile(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	defer database.Close()

	t.Setenv("CONFIG_FILE", "/non/existent/path/config.json")
	SeedBrokersFromConfig(database)

	var count int
	database.QueryRow(`SELECT COUNT(*) FROM mqtt_brokers`).Scan(&count)
	if count != 0 {
		t.Errorf("Expected 0 brokers when config file does not exist, got %d", count)
	}
}

func TestSeedBrokersFromConfig_InvalidJSON(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	defer database.Close()

	tmpDir := t.TempDir()
	cfgPath := tmpDir + "/bad_config.json"
	os.WriteFile(cfgPath, []byte(`{ invalid json`), 0600)

	t.Setenv("CONFIG_FILE", cfgPath)
	SeedBrokersFromConfig(database)

	var count int
	database.QueryRow(`SELECT COUNT(*) FROM mqtt_brokers`).Scan(&count)
	if count != 0 {
		t.Errorf("Expected 0 brokers for invalid JSON, got %d", count)
	}
}

func TestSeedBrokersFromConfig_ArrayFormat(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	defer database.Close()

	tmpDir := t.TempDir()
	cfgPath := tmpDir + "/array_config.json"
	jsonContent := `[
		{"host":"192.168.1.50","port":1883},
		{"name":"Array Broker 2","host":"192.168.1.51","port":1884,"username":"admin","password":"secret"}
	]`
	os.WriteFile(cfgPath, []byte(jsonContent), 0600)

	t.Setenv("CONFIG_FILE", cfgPath)
	SeedBrokersFromConfig(database)

	var count int
	database.QueryRow(`SELECT COUNT(*) FROM mqtt_brokers`).Scan(&count)
	if count != 2 {
		t.Fatalf("Expected 2 seeded brokers from JSON array, got %d", count)
	}

	// Verify default name assignment for unnamed broker
	var b1Name, b1AuthMode string
	database.QueryRow(`SELECT name, auth_mode FROM mqtt_brokers WHERE host = '192.168.1.50'`).Scan(&b1Name, &b1AuthMode)
	if b1Name != "Broker 1" {
		t.Errorf("Expected default name 'Broker 1', got %q", b1Name)
	}
	if b1AuthMode != "none" {
		t.Errorf("Expected auth_mode 'none', got %q", b1AuthMode)
	}

	// Verify password auth_mode auto-detection for broker with credentials
	var b2AuthMode string
	database.QueryRow(`SELECT auth_mode FROM mqtt_brokers WHERE name = 'Array Broker 2'`).Scan(&b2AuthMode)
	if b2AuthMode != "password" {
		t.Errorf("Expected auth_mode 'password', got %q", b2AuthMode)
	}
}

func TestSeedBrokersFromConfig_ObjectFormatWithBrokersAndSettings(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	defer database.Close()

	tmpDir := t.TempDir()
	cfgPath := tmpDir + "/full_config.json"
	jsonContent := `{
		"brokers": [
			{
				"name": "TLS Broker",
				"host": "mqtt.example.com",
				"port": 8883,
				"tls_enabled": true,
				"tls_skip_verify": true,
				"auth_mode": "certificate",
				"ca_cert": "-----BEGIN CERTIFICATE-----\n..."
			}
		],
		"settings": {
			"retention_period_hours": 72,
			"save_sys_topics": true
		}
	}`
	os.WriteFile(cfgPath, []byte(jsonContent), 0600)

	t.Setenv("CONFIG_FILE", cfgPath)
	SeedBrokersFromConfig(database)

	// Verify broker TLS settings
	var tlsEnabled, tlsSkipVerify bool
	var authMode, caCert string
	err = database.QueryRow(`SELECT tls_enabled, tls_skip_verify, auth_mode, ca_cert FROM mqtt_brokers WHERE name = 'TLS Broker'`).Scan(&tlsEnabled, &tlsSkipVerify, &authMode, &caCert)
	if err != nil {
		t.Fatalf("Failed to query TLS Broker: %v", err)
	}
	if !tlsEnabled || !tlsSkipVerify || authMode != "certificate" || caCert == "" {
		t.Errorf("TLS broker fields mismatch: tls_enabled=%v, tls_skip_verify=%v, auth_mode=%s", tlsEnabled, tlsSkipVerify, authMode)
	}

	// Verify app settings update
	var retentionHours int
	var saveSysTopics bool
	err = database.QueryRow(`SELECT retention_period_hours, save_sys_topics FROM app_settings WHERE id = 1`).Scan(&retentionHours, &saveSysTopics)
	if err != nil {
		t.Fatalf("Failed to query app_settings: %v", err)
	}
	if retentionHours != 72 {
		t.Errorf("Expected retention_period_hours = 72, got %d", retentionHours)
	}
	if !saveSysTopics {
		t.Errorf("Expected save_sys_topics = true, got false")
	}
}

func TestSeedBrokersFromConfig_SettingsOnly(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	defer database.Close()

	tmpDir := t.TempDir()
	cfgPath := tmpDir + "/settings_config.json"
	jsonContent := `{
		"settings": {
			"retention_period_hours": 48,
			"save_sys_topics": true
		}
	}`
	os.WriteFile(cfgPath, []byte(jsonContent), 0600)

	t.Setenv("CONFIG_FILE", cfgPath)
	SeedBrokersFromConfig(database)

	var retentionHours int
	var saveSysTopics bool
	database.QueryRow(`SELECT retention_period_hours, save_sys_topics FROM app_settings WHERE id = 1`).Scan(&retentionHours, &saveSysTopics)
	if retentionHours != 48 || !saveSysTopics {
		t.Errorf("Settings-only config failed: retention=%d (want 48), save_sys_topics=%v (want true)", retentionHours, saveSysTopics)
	}
}

func TestSeedBrokersFromConfig_DeduplicationByHostAndPort(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	defer database.Close()

	// Pre-insert a broker
	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port) VALUES ('existing-1', 'Preexisting Broker', '10.0.0.100', 1883)`)

	tmpDir := t.TempDir()
	cfgPath := tmpDir + "/dedup_config.json"
	// One matching name, one matching host+port, one completely new
	jsonContent := `[
		{"name": "Preexisting Broker", "host": "10.0.0.101", "port": 1883},
		{"name": "Another Name", "host": "10.0.0.100", "port": 1883},
		{"name": "New Unique Broker", "host": "10.0.0.200", "port": 1883}
	]`
	os.WriteFile(cfgPath, []byte(jsonContent), 0600)

	t.Setenv("CONFIG_FILE", cfgPath)
	SeedBrokersFromConfig(database)

	var count int
	database.QueryRow(`SELECT COUNT(*) FROM mqtt_brokers`).Scan(&count)
	if count != 2 {
		t.Errorf("Expected 2 total brokers (1 preexisting + 1 new unique), got %d", count)
	}

	var newCount int
	database.QueryRow(`SELECT COUNT(*) FROM mqtt_brokers WHERE name = 'New Unique Broker'`).Scan(&newCount)
	if newCount != 1 {
		t.Errorf("Expected 'New Unique Broker' to be seeded")
	}
}

func TestSeedBrokersFromConfig_CertFilePaths(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	defer database.Close()

	tmpDir := t.TempDir()
	caFile := tmpDir + "/ca.crt"
	clientCertFile := tmpDir + "/client.crt"
	clientKeyFile := tmpDir + "/client.key"

	os.WriteFile(caFile, []byte("-----BEGIN CERTIFICATE-----\nCA_CONTENT\n-----END CERTIFICATE-----"), 0600)
	os.WriteFile(clientCertFile, []byte("-----BEGIN CERTIFICATE-----\nCLIENT_CERT_CONTENT\n-----END CERTIFICATE-----"), 0600)
	os.WriteFile(clientKeyFile, []byte("-----BEGIN PRIVATE KEY-----\nCLIENT_KEY_CONTENT\n-----END PRIVATE KEY-----"), 0600)

	cfgPath := tmpDir + "/cert_paths_config.json"
	jsonContent := `{
		"brokers": [
			{
				"name": "mTLS Path Broker",
				"host": "mtls.example.com",
				"port": 8883,
				"tls_enabled": true,
				"ca_cert_file": "ca.crt",
				"client_cert_file": "client.crt",
				"client_key_file": "client.key"
			}
		]
	}`
	os.WriteFile(cfgPath, []byte(jsonContent), 0600)

	t.Setenv("CONFIG_FILE", cfgPath)
	SeedBrokersFromConfig(database)

	var authMode, caCert, clientCert, clientKey string
	err = database.QueryRow(`SELECT auth_mode, ca_cert, client_cert, client_key FROM mqtt_brokers WHERE name = 'mTLS Path Broker'`).Scan(&authMode, &caCert, &clientCert, &clientKey)
	if err != nil {
		t.Fatalf("Query failed: %v", err)
	}

	if authMode != "certificate" {
		t.Errorf("Expected auth_mode 'certificate', got %q", authMode)
	}
	if !strings.Contains(caCert, "CA_CONTENT") {
		t.Errorf("Expected ca_cert to contain CA_CONTENT, got %q", caCert)
	}
	if !strings.Contains(clientCert, "CLIENT_CERT_CONTENT") {
		t.Errorf("Expected client_cert to contain CLIENT_CERT_CONTENT, got %q", clientCert)
	}
	if !strings.Contains(clientKey, "CLIENT_KEY_CONTENT") {
		t.Errorf("Expected client_key to contain CLIENT_KEY_CONTENT, got %q", clientKey)
	}
}

func TestSeedDashboardsAndPanelsFromConfig(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	defer database.Close()

	tmpDir := t.TempDir()
	cfgPath := tmpDir + "/dash_config.json"
	jsonContent := `{
		"brokers": [
			{
				"name": "Main Broker",
				"host": "localhost",
				"port": 1883,
				"is_enabled": true
			}
		],
		"dashboards": [
			{
				"name": "Dev Showcase",
				"panels": [
					{
						"title": "Living Room Temp",
						"panel_type": "gauge",
						"x": 0,
						"y": 0,
						"w": 3,
						"h": 3,
						"config_json": {"topic": "sensors/temp", "unit": "°C"},
						"broker_name": "Main Broker"
					},
					{
						"title": "Boost Fan Button",
						"panel_type": "button",
						"x": 3,
						"y": 0,
						"w": 3,
						"h": 3,
						"config_json": {"topic": "home/fan", "payload": "boost"}
					}
				]
			}
		]
	}`
	os.WriteFile(cfgPath, []byte(jsonContent), 0600)

	t.Setenv("CONFIG_FILE", cfgPath)
	SeedBrokersFromConfig(database)

	var dashID, dashName string
	err = database.QueryRow(`SELECT id, name FROM dashboards WHERE name = 'Dev Showcase'`).Scan(&dashID, &dashName)
	if err != nil {
		t.Fatalf("Failed to query seeded dashboard: %v", err)
	}
	if dashName != "Dev Showcase" {
		t.Errorf("Expected dashboard name 'Dev Showcase', got %q", dashName)
	}

	var panelCount int
	err = database.QueryRow(`SELECT COUNT(*) FROM dashboard_layouts WHERE dashboard_id = ?`, dashID).Scan(&panelCount)
	if err != nil || panelCount != 2 {
		t.Fatalf("Expected 2 panels in seeded dashboard, got %d (err: %v)", panelCount, err)
	}

	// Verify broker resolution by name
	var brokerID string
	err = database.QueryRow(`SELECT id FROM mqtt_brokers WHERE name = 'Main Broker'`).Scan(&brokerID)
	if err != nil {
		t.Fatalf("Failed to query Main Broker ID: %v", err)
	}

	var panelBrokerID, panelType string
	err = database.QueryRow(`SELECT broker_id, panel_type FROM dashboard_layouts WHERE dashboard_id = ? AND title = 'Living Room Temp'`, dashID).Scan(&panelBrokerID, &panelType)
	if err != nil {
		t.Fatalf("Failed to query panel: %v", err)
	}
	if panelBrokerID != brokerID {
		t.Errorf("Expected panel broker_id = %q (resolved from 'Main Broker'), got %q", brokerID, panelBrokerID)
	}
	if panelType != "gauge" {
		t.Errorf("Expected panel_type = 'gauge', got %q", panelType)
	}

	// Verify re-seeding is non-destructive
	SeedBrokersFromConfig(database)
	var panelCountAfter int
	database.QueryRow(`SELECT COUNT(*) FROM dashboard_layouts WHERE dashboard_id = ?`, dashID).Scan(&panelCountAfter)
	if panelCountAfter != 2 {
		t.Errorf("Re-seeding should not duplicate panels, got %d", panelCountAfter)
	}
}

