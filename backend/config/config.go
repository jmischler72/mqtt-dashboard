package config

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"mqtt-dashboard/models"

	"github.com/google/uuid"
)

type ConfigBroker struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Host           string `json:"host"`
	Port           int    `json:"port"`
	ClientID       string `json:"client_id"`
	Username       string `json:"username"`
	Password       string `json:"password"`
	IsEnabled      bool   `json:"is_enabled"`
	SortOrder      int    `json:"sort_order"`
	AuthMode       string `json:"auth_mode"`
	TLSEnabled     bool   `json:"tls_enabled"`
	TLSSkipVerify  bool   `json:"tls_skip_verify"`
	CACert         string `json:"ca_cert"`
	ClientCert     string `json:"client_cert"`
	ClientKey      string `json:"client_key"`
	CACertFile     string `json:"ca_cert_file"`
	ClientCertFile string `json:"client_cert_file"`
	ClientKeyFile  string `json:"client_key_file"`
}

type ConfigDashboard struct {
	ID     string        `json:"id,omitempty"`
	Name   string        `json:"name"`
	Panels []ConfigPanel `json:"panels"`
}

type ConfigPanel struct {
	ID         string          `json:"id,omitempty"`
	Title      string          `json:"title"`
	PanelType  string          `json:"panel_type"`
	X          int             `json:"x"`
	Y          int             `json:"y"`
	W          int             `json:"w"`
	H          int             `json:"h"`
	ConfigJSON json.RawMessage `json:"config_json"`
	BrokerID   string          `json:"broker_id,omitempty"`
	BrokerName string          `json:"broker_name,omitempty"`
}

type AppConfigFile struct {
	Brokers    []ConfigBroker      `json:"brokers"`
	Settings   *models.AppSettings `json:"settings,omitempty"`
	Dashboards []ConfigDashboard   `json:"dashboards,omitempty"`
}

func ResolveCertContent(val string, baseDir string) string {
	if val == "" {
		return ""
	}
	if strings.Contains(val, "-----BEGIN ") {
		return val
	}
	path := val
	if !filepath.IsAbs(path) && baseDir != "" {
		path = filepath.Join(baseDir, path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		slog.Error("failed to read cert file", "path", path, "err", err)
		return ""
	}
	return string(data)
}

// SeedBrokersFromConfig reads initial broker configurations, settings, and dashboards
// from a JSON file (CONFIG_FILE or default paths) and seeds them into the database.
func SeedBrokersFromConfig(database *sql.DB) {
	if database == nil {
		return
	}

	configFile := os.Getenv("CONFIG_FILE")
	if configFile == "" {
		candidates := []string{"./data/config.json", "./config/config.json"}
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				configFile = c
				break
			}
		}
	}

	if configFile == "" {
		return
	}

	data, err := os.ReadFile(configFile)
	if err != nil {
		slog.Error("failed to read config file", "file", configFile, "err", err)
		return
	}

	baseDir := filepath.Dir(configFile)

	var configBrokers []ConfigBroker
	var configDashboards []ConfigDashboard
	var configObj AppConfigFile

	if err := json.Unmarshal(data, &configObj); err == nil && (len(configObj.Brokers) > 0 || configObj.Settings != nil || len(configObj.Dashboards) > 0) {
		configBrokers = configObj.Brokers
		configDashboards = configObj.Dashboards
		slog.Info("loaded initial config file object", "file", configFile, "brokers_count", len(configBrokers), "dashboards_count", len(configDashboards), "has_settings", configObj.Settings != nil)
		if configObj.Settings != nil {
			retention := configObj.Settings.RetentionPeriodHours
			if retention <= 0 {
				retention = 24
			}
			_, err := database.Exec(
				`UPDATE app_settings SET retention_period_hours = ?, save_sys_topics = ? WHERE id = 1`,
				retention, configObj.Settings.SaveSysTopics,
			)
			if err != nil {
				slog.Error("failed to seed settings from config file", "err", err)
			} else {
				slog.Info("seeded settings from config file", "retention_hours", retention, "save_sys_topics", configObj.Settings.SaveSysTopics)
			}
		}
	} else if err := json.Unmarshal(data, &configBrokers); err == nil && len(configBrokers) > 0 {
		slog.Info("loaded initial brokers from config file array", "file", configFile, "count", len(configBrokers))
	} else {
		slog.Error("failed to parse config file", "file", configFile, "err", err)
		return
	}

	for i, b := range configBrokers {
		if b.Name == "" {
			b.Name = fmt.Sprintf("Broker %d", i+1)
		}
		if b.Port <= 0 {
			b.Port = 1883
		}
		if b.ID == "" {
			b.ID = uuid.New().String()
		}

		if b.CACert != "" {
			b.CACert = ResolveCertContent(b.CACert, baseDir)
		} else if b.CACertFile != "" {
			b.CACert = ResolveCertContent(b.CACertFile, baseDir)
		}

		if b.ClientCert != "" {
			b.ClientCert = ResolveCertContent(b.ClientCert, baseDir)
		} else if b.ClientCertFile != "" {
			b.ClientCert = ResolveCertContent(b.ClientCertFile, baseDir)
		}

		if b.ClientKey != "" {
			b.ClientKey = ResolveCertContent(b.ClientKey, baseDir)
		} else if b.ClientKeyFile != "" {
			b.ClientKey = ResolveCertContent(b.ClientKeyFile, baseDir)
		}

		if b.AuthMode == "" {
			if b.ClientCert != "" || b.ClientKey != "" {
				b.AuthMode = "certificate"
			} else if b.Username != "" || b.Password != "" {
				b.AuthMode = "password"
			} else {
				b.AuthMode = "none"
			}
		}

		// Check if a broker with this name or host+port already exists
		var exists int
		err := database.QueryRow(`SELECT COUNT(*) FROM mqtt_brokers WHERE name = ? OR (host = ? AND port = ?)`, b.Name, b.Host, b.Port).Scan(&exists)
		if err == nil && exists > 0 {
			continue
		}

		slog.Info("seeding initial broker from config file", "name", b.Name, "host", b.Host, "port", b.Port)
		_, err = database.Exec(
			`INSERT INTO mqtt_brokers (id, name, host, port, client_id, username, password, is_enabled, sort_order, auth_mode, tls_enabled, tls_skip_verify, ca_cert, client_cert, client_key)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			b.ID, b.Name, b.Host, b.Port, b.ClientID, b.Username, b.Password, b.IsEnabled, i, b.AuthMode, b.TLSEnabled, b.TLSSkipVerify, b.CACert, b.ClientCert, b.ClientKey,
		)
		if err != nil {
			slog.Error("failed to insert initial broker from config file", "broker", b.Name, "err", err)
		}
	}

	// Seed Dashboards and Panels (if specified)
	if len(configDashboards) > 0 {
		brokerMap := make(map[string]string)
		var defaultBrokerID string

		rows, err := database.Query(`SELECT id, name, is_enabled FROM mqtt_brokers ORDER BY sort_order ASC, is_enabled DESC`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id, name string
				var enabled bool
				if err := rows.Scan(&id, &name, &enabled); err == nil {
					brokerMap[name] = id
					brokerMap[id] = id
					if defaultBrokerID == "" && enabled {
						defaultBrokerID = id
					}
				}
			}
		}
		if defaultBrokerID == "" && len(brokerMap) > 0 {
			for _, id := range brokerMap {
				defaultBrokerID = id
				break
			}
		}

		for _, d := range configDashboards {
			if d.Name == "" {
				d.Name = "Custom Dashboard"
			}
			dashID := d.ID
			if dashID == "" {
				if strings.EqualFold(d.Name, "Default") {
					dashID = "default"
				} else {
					dashID = uuid.New().String()
				}
			}

			var existingDashID string
			err := database.QueryRow(`SELECT id FROM dashboards WHERE id = ? OR name = ? LIMIT 1`, dashID, d.Name).Scan(&existingDashID)
			if err != nil {
				_, err = database.Exec(`INSERT INTO dashboards (id, name) VALUES (?, ?)`, dashID, d.Name)
				if err != nil {
					slog.Error("failed to create dashboard from config file", "dashboard", d.Name, "err", err)
					continue
				}
				existingDashID = dashID
				slog.Info("seeded dashboard from config file", "id", dashID, "name", d.Name)
			}

			var panelCount int
			err = database.QueryRow(`SELECT COUNT(*) FROM dashboard_layouts WHERE dashboard_id = ?`, existingDashID).Scan(&panelCount)
			if err == nil && panelCount == 0 && len(d.Panels) > 0 {
				for _, p := range d.Panels {
					panelID := p.ID
					if panelID == "" {
						panelID = uuid.New().String()
					}
					w := p.W
					if w <= 0 {
						w = 4
					}
					h := p.H
					if h <= 0 {
						h = 4
					}
					panelBrokerID := p.BrokerID
					if panelBrokerID == "" && p.BrokerName != "" {
						panelBrokerID = brokerMap[p.BrokerName]
					}
					if panelBrokerID == "" {
						panelBrokerID = defaultBrokerID
					}

					cfgJSON := string(p.ConfigJSON)
					if strings.TrimSpace(cfgJSON) == "" || cfgJSON == "null" {
						cfgJSON = "{}"
					}

					_, err = database.Exec(
						`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						panelID, existingDashID, p.Title, p.PanelType, p.X, p.Y, w, h, cfgJSON, panelBrokerID,
					)
					if err != nil {
						slog.Error("failed to insert seeded panel", "dashboard", d.Name, "panel", p.Title, "err", err)
					}
				}
				slog.Info("seeded panels for dashboard", "dashboard", d.Name, "count", len(d.Panels))
			}
		}
	}
}

