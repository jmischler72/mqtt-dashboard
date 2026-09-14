package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadRuntimeConfig_Defaults(t *testing.T) {
	t.Setenv("MQTT_DASHBOARD_CONFIG", "")
	t.Setenv("MQTT_DASHBOARD_HTTP_ADDR", "")
	t.Setenv("MQTT_DASHBOARD_BASE_PATH", "")
	t.Setenv("MQTT_DASHBOARD_DATA_DIR", "")
	t.Setenv("MQTT_DASHBOARD_CONFIG_FILE", "")
	t.Setenv("MQTT_DASHBOARD_LOG_LEVEL", "")
	t.Setenv("CONFIG_FILE", "")
	t.Setenv("LOG_LEVEL", "")

	cfg, err := LoadRuntimeConfig()
	if err != nil {
		t.Fatalf("LoadRuntimeConfig: %v", err)
	}
	if cfg.HTTPAddr != ":8080" || cfg.BasePath != "/" || cfg.DataDir != "./data" || cfg.LogLevel != "info" {
		t.Fatalf("unexpected defaults: %#v", cfg)
	}
}

func TestLoadRuntimeConfig_TOMLThenEnvironment(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	contents := `[server]
http_addr = "127.0.0.1:8080"
base_path = "/dashboard"

[storage]
data_dir = "/var/lib/mqtt-dashboard"

[logging]
level = "warn"

[seed]
config_file = "/etc/mqtt-dashboard/seed.json"
`
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MQTT_DASHBOARD_CONFIG", path)
	t.Setenv("MQTT_DASHBOARD_HTTP_ADDR", "127.0.0.1:8181")
	t.Setenv("MQTT_DASHBOARD_BASE_PATH", "")
	t.Setenv("MQTT_DASHBOARD_DATA_DIR", "")
	t.Setenv("MQTT_DASHBOARD_CONFIG_FILE", "")
	t.Setenv("MQTT_DASHBOARD_LOG_LEVEL", "debug")
	t.Setenv("CONFIG_FILE", "")
	t.Setenv("LOG_LEVEL", "")

	cfg, err := LoadRuntimeConfig()
	if err != nil {
		t.Fatalf("LoadRuntimeConfig: %v", err)
	}
	if cfg.HTTPAddr != "127.0.0.1:8181" || cfg.BasePath != "/dashboard/" || cfg.DataDir != "/var/lib/mqtt-dashboard" || cfg.SeedConfigFile != "/etc/mqtt-dashboard/seed.json" || cfg.LogLevel != "debug" {
		t.Fatalf("unexpected resolved config: %#v", cfg)
	}
}

func TestLoadRuntimeConfig_RejectsInvalidBasePath(t *testing.T) {
	t.Setenv("MQTT_DASHBOARD_CONFIG", "")
	t.Setenv("MQTT_DASHBOARD_BASE_PATH", "/dashboard/../private")
	if _, err := LoadRuntimeConfig(); err == nil {
		t.Fatal("LoadRuntimeConfig accepted a base path with '..'")
	}
}
