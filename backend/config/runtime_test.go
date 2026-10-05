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
	t.Setenv("MQTT_DASHBOARD_SEED_FILE", "")
	t.Setenv("MQTT_DASHBOARD_LOG_LEVEL", "")
	t.Setenv("LOG_LEVEL", "")
	t.Setenv("MQTT_DASHBOARD_DEMO_MODE", "")

	cfg, err := LoadRuntimeConfig()
	if err != nil {
		t.Fatalf("LoadRuntimeConfig: %v", err)
	}
	if cfg.HTTPAddr != ":8080" || cfg.BasePath != "/" || cfg.DataDir != "./data" || cfg.LogLevel != "info" || cfg.SeedConfigFile != "" || cfg.DemoMode {
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
file = "/etc/mqtt-dashboard/seed.json"
`
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MQTT_DASHBOARD_CONFIG", path)
	t.Setenv("MQTT_DASHBOARD_HTTP_ADDR", "127.0.0.1:8181")
	t.Setenv("MQTT_DASHBOARD_BASE_PATH", "")
	t.Setenv("MQTT_DASHBOARD_DATA_DIR", "")
	t.Setenv("MQTT_DASHBOARD_SEED_FILE", "")
	t.Setenv("MQTT_DASHBOARD_LOG_LEVEL", "debug")
	t.Setenv("LOG_LEVEL", "")

	cfg, err := LoadRuntimeConfig()
	if err != nil {
		t.Fatalf("LoadRuntimeConfig: %v", err)
	}
	if cfg.HTTPAddr != "127.0.0.1:8181" || cfg.BasePath != "/dashboard/" || cfg.DataDir != "/var/lib/mqtt-dashboard" || cfg.SeedConfigFile != "/etc/mqtt-dashboard/seed.json" || cfg.LogLevel != "debug" {
		t.Fatalf("unexpected resolved config: %#v", cfg)
	}
}

func TestLoadRuntimeConfig_SeedFileEnvOverridesTOML(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	contents := `[seed]
file = "/etc/mqtt-dashboard/seed.json"
`
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MQTT_DASHBOARD_CONFIG", path)
	t.Setenv("MQTT_DASHBOARD_SEED_FILE", "/custom/seed.json")

	cfg, err := LoadRuntimeConfig()
	if err != nil {
		t.Fatalf("LoadRuntimeConfig: %v", err)
	}
	if cfg.SeedConfigFile != "/custom/seed.json" {
		t.Fatalf("expected SeedConfigFile to be /custom/seed.json, got %q", cfg.SeedConfigFile)
	}
}

func TestLoadRuntimeConfig_IgnoresLegacyConfigFileEnv(t *testing.T) {
	t.Setenv("MQTT_DASHBOARD_CONFIG", "")
	t.Setenv("MQTT_DASHBOARD_SEED_FILE", "")
	t.Setenv("CONFIG_FILE", "/legacy/config.json")
	t.Setenv("MQTT_DASHBOARD_CONFIG_FILE", "/legacy/mqtt_config.json")

	cfg, err := LoadRuntimeConfig()
	if err != nil {
		t.Fatalf("LoadRuntimeConfig: %v", err)
	}
	if cfg.SeedConfigFile != "" {
		t.Fatalf("expected legacy CONFIG_FILE to be ignored, got %q", cfg.SeedConfigFile)
	}
}

func TestLoadRuntimeConfig_RejectsInvalidBasePath(t *testing.T) {
	t.Setenv("MQTT_DASHBOARD_CONFIG", "")
	t.Setenv("MQTT_DASHBOARD_BASE_PATH", "/dashboard/../private")
	if _, err := LoadRuntimeConfig(); err == nil {
		t.Fatal("LoadRuntimeConfig accepted a base path with '..'")
	}
}

func TestLoadRuntimeConfig_RelativeSeedFileResolvesRelativeToTOML(t *testing.T) {
	dir := t.TempDir()
	tomlPath := filepath.Join(dir, "config.toml")
	contents := `[seed]
file = "relative-seed.json"
`
	if err := os.WriteFile(tomlPath, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MQTT_DASHBOARD_CONFIG", tomlPath)
	t.Setenv("MQTT_DASHBOARD_SEED_FILE", "")

	cfg, err := LoadRuntimeConfig()
	if err != nil {
		t.Fatalf("LoadRuntimeConfig: %v", err)
	}
	expected := filepath.Join(dir, "relative-seed.json")
	if cfg.SeedConfigFile != expected {
		t.Fatalf("expected relative seed file to resolve to %q, got %q", expected, cfg.SeedConfigFile)
	}
}

func TestLoadRuntimeConfig_DemoMode(t *testing.T) {
	t.Run("server.demo_mode in TOML", func(t *testing.T) {
		dir := t.TempDir()
		tomlPath := filepath.Join(dir, "config.toml")
		contents := `[server]
demo_mode = true
`
		if err := os.WriteFile(tomlPath, []byte(contents), 0o600); err != nil {
			t.Fatal(err)
		}
		t.Setenv("MQTT_DASHBOARD_CONFIG", tomlPath)
		t.Setenv("MQTT_DASHBOARD_DEMO_MODE", "")

		cfg, err := LoadRuntimeConfig()
		if err != nil {
			t.Fatalf("LoadRuntimeConfig: %v", err)
		}
		if !cfg.DemoMode {
			t.Fatal("expected DemoMode to be true from server.demo_mode in TOML")
		}
	})

	t.Run("env overrides TOML", func(t *testing.T) {
		dir := t.TempDir()
		tomlPath := filepath.Join(dir, "config.toml")
		contents := `[server]
demo_mode = true
`
		if err := os.WriteFile(tomlPath, []byte(contents), 0o600); err != nil {
			t.Fatal(err)
		}
		t.Setenv("MQTT_DASHBOARD_CONFIG", tomlPath)
		t.Setenv("MQTT_DASHBOARD_DEMO_MODE", "false")

		cfg, err := LoadRuntimeConfig()
		if err != nil {
			t.Fatalf("LoadRuntimeConfig: %v", err)
		}
		if cfg.DemoMode {
			t.Fatal("expected DemoMode to be false due to MQTT_DASHBOARD_DEMO_MODE=false override")
		}
	})

	t.Run("env MQTT_DASHBOARD_DEMO_MODE=true without TOML", func(t *testing.T) {
		t.Setenv("MQTT_DASHBOARD_CONFIG", "")
		t.Setenv("MQTT_DASHBOARD_DEMO_MODE", "true")

		cfg, err := LoadRuntimeConfig()
		if err != nil {
			t.Fatalf("LoadRuntimeConfig: %v", err)
		}
		if !cfg.DemoMode {
			t.Fatal("expected DemoMode to be true from MQTT_DASHBOARD_DEMO_MODE=true")
		}
	})
}

