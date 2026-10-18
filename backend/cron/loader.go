package cron

import (
	"database/sql"
	"encoding/json"
	"log/slog"
)

// LoadJobsFromDB reloads all cron panel jobs from the database into the scheduler.
func LoadJobsFromDB(database *sql.DB, scheduler *Scheduler) {
	if database == nil || scheduler == nil {
		return
	}
	rows, err := database.Query(`SELECT id, COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts WHERE panel_type = 'cron'`)
	if err != nil {
		slog.Error("load cron jobs", "err", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var panelID, cfgJSON, brokerID string
		if err := rows.Scan(&panelID, &cfgJSON, &brokerID); err != nil {
			continue
		}
		var cfg struct {
			BrokerID string `json:"broker_id"`
			CronExpr string `json:"cron_expr"`
			Topic    string `json:"topic"`
			Payload  string `json:"payload"`
			QoS      int    `json:"qos"`
			Retain   bool   `json:"retain"`
			Enabled  bool   `json:"enabled"`
		}
		if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil || cfg.CronExpr == "" {
			continue
		}
		bID := cfg.BrokerID
		if bID == "" {
			bID = brokerID
		}
		if err := scheduler.AddJob(panelID, bID, cfg.CronExpr, cfg.Topic, cfg.Payload, byte(cfg.QoS), cfg.Retain, cfg.Enabled); err != nil {
			slog.Error("load cron job", "panel_id", panelID, "err", err)
		}
	}
}
