package config

import (
	"fmt"
	"net"
	"os"
	"path"
	"strings"

	"github.com/pelletier/go-toml/v2"
)

// RuntimeConfig controls how the HTTP service runs. Values are resolved in
// this order: built-in defaults, optional TOML file, then environment
// variables. The defaults preserve the application's historical behaviour.
type RuntimeConfig struct {
	HTTPAddr       string
	BasePath       string
	DataDir        string
	SeedConfigFile string
	LogLevel       string
}

type runtimeConfigFile struct {
	Server struct {
		HTTPAddr string `toml:"http_addr"`
		BasePath string `toml:"base_path"`
	} `toml:"server"`
	Storage struct {
		DataDir string `toml:"data_dir"`
	} `toml:"storage"`
	Logging struct {
		Level string `toml:"level"`
	} `toml:"logging"`
	Seed struct {
		File string `toml:"file"`
	} `toml:"seed"`
}

// LoadRuntimeConfig resolves process configuration. MQTT_DASHBOARD_CONFIG, if
// set, must name a valid TOML file. An explicitly requested file is never
// silently ignored because that can expose the service unexpectedly.
func LoadRuntimeConfig() (RuntimeConfig, error) {
	cfg := RuntimeConfig{
		HTTPAddr: ":8080",
		BasePath: "/",
		DataDir:  "./data",
		LogLevel: "info",
	}

	if file := os.Getenv("MQTT_DASHBOARD_CONFIG"); file != "" {
		data, err := os.ReadFile(file)
		if err != nil {
			return RuntimeConfig{}, fmt.Errorf("read MQTT_DASHBOARD_CONFIG %q: %w", file, err)
		}
		var fromFile runtimeConfigFile
		if err := toml.Unmarshal(data, &fromFile); err != nil {
			return RuntimeConfig{}, fmt.Errorf("parse MQTT_DASHBOARD_CONFIG %q: %w", file, err)
		}
		applyRuntimeFile(&cfg, fromFile)
	}

	applyEnv(&cfg)
	if err := validateRuntimeConfig(&cfg); err != nil {
		return RuntimeConfig{}, err
	}
	return cfg, nil
}

func applyRuntimeFile(cfg *RuntimeConfig, fromFile runtimeConfigFile) {
	if fromFile.Server.HTTPAddr != "" {
		cfg.HTTPAddr = fromFile.Server.HTTPAddr
	}
	if fromFile.Server.BasePath != "" {
		cfg.BasePath = fromFile.Server.BasePath
	}
	if fromFile.Storage.DataDir != "" {
		cfg.DataDir = fromFile.Storage.DataDir
	}
	if fromFile.Logging.Level != "" {
		cfg.LogLevel = fromFile.Logging.Level
	}
	if fromFile.Seed.File != "" {
		cfg.SeedConfigFile = fromFile.Seed.File
	}
}

func applyEnv(cfg *RuntimeConfig) {
	if value := os.Getenv("MQTT_DASHBOARD_HTTP_ADDR"); value != "" {
		cfg.HTTPAddr = value
	}
	if value := os.Getenv("MQTT_DASHBOARD_BASE_PATH"); value != "" {
		cfg.BasePath = value
	}
	if value := os.Getenv("MQTT_DASHBOARD_DATA_DIR"); value != "" {
		cfg.DataDir = value
	}
	if value := os.Getenv("MQTT_DASHBOARD_SEED_FILE"); value != "" {
		cfg.SeedConfigFile = value
	}
	if value := os.Getenv("MQTT_DASHBOARD_LOG_LEVEL"); value != "" {
		cfg.LogLevel = value
	} else if value := os.Getenv("LOG_LEVEL"); value != "" {
		cfg.LogLevel = value
	}
}

func validateRuntimeConfig(cfg *RuntimeConfig) error {
	if _, _, err := net.SplitHostPort(cfg.HTTPAddr); err != nil {
		return fmt.Errorf("invalid HTTP address %q: %w", cfg.HTTPAddr, err)
	}
	if cfg.DataDir == "" {
		return fmt.Errorf("data directory must not be empty")
	}
	basePath, err := normalizeBasePath(cfg.BasePath)
	if err != nil {
		return err
	}
	cfg.BasePath = basePath
	return nil
}

func normalizeBasePath(value string) (string, error) {
	if value == "" || value == "/" {
		return "/", nil
	}
	if !strings.HasPrefix(value, "/") || strings.ContainsAny(value, "?#\"'<>\t\r\n ") {
		return "", fmt.Errorf("base path must be an absolute URL path, got %q", value)
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == ".." {
			return "", fmt.Errorf("base path must not contain '..', got %q", value)
		}
	}
	cleaned := path.Clean(value)
	if cleaned == "." || cleaned == "/" {
		return "/", nil
	}
	return strings.TrimSuffix(cleaned, "/") + "/", nil
}
