package demo

import (
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"sync"

	"mqtt-dashboard/config"
	"mqtt-dashboard/cron"
	"mqtt-dashboard/logic"
	mqttclient "mqtt-dashboard/mqtt"
	"mqtt-dashboard/ws"
)

var resetMu sync.Mutex

// ResetDatabase wipes user-modified tables, re-seeds from the configured seed file,
// and resynchronizes in-memory registries, scheduler, logic engine, and WebSocket connections.
func ResetDatabase(database *sql.DB, registry *mqttclient.BrokerRegistry, scheduler *cron.Scheduler, logicEngine logic.LogicEngine, wsHub *ws.Hub, seedFile string) {
	resetMu.Lock()
	defer resetMu.Unlock()

	if database == nil || registry == nil || scheduler == nil || logicEngine == nil {
		slog.Error("demo reset skipped: missing required dependencies")
		return
	}

	slog.Info("demo auto-reset starting")

	if seedFile == "" {
		seedFile = os.Getenv("MQTT_DASHBOARD_SEED_FILE")
	}

	tx, err := database.Begin()
	if err != nil {
		slog.Error("demo reset begin transaction failed", "err", err)
		return
	}

	queries := []string{
		"DELETE FROM mqtt_history",
		"DELETE FROM dashboard_layouts",
		"DELETE FROM dashboards WHERE id != 'default'",
		"DELETE FROM mqtt_brokers",
		"UPDATE dashboards SET name = 'Home Automation' WHERE id = 'default'",
		"UPDATE app_settings SET retention_period_hours = 24, save_sys_topics = 0 WHERE id = 1",
	}
	for _, q := range queries {
		if _, err := tx.Exec(q); err != nil {
			_ = tx.Rollback()
			slog.Error("demo reset query failed", "query", q, "err", err)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		slog.Error("demo reset commit failed", "err", err)
		return
	}

	config.SeedBrokersFromPath(database, seedFile)

	if wsHub != nil {
		wsHub.CloseAllClients()
	}

	registry.RemoveAllBrokers()
	mqttclient.AutoConnectFromDB(database, registry)

	scheduler.RemoveAllPanelJobs()
	cron.LoadJobsFromDB(database, scheduler)

	logicEngine.ClearAllRules()
	logic.LoadRulesFromDB(database, logicEngine)

	slog.Info("demo auto-reset completed successfully")
}

// SetupAutoReset schedules periodic demo database resets if cronExpr is enabled.
func SetupAutoReset(database *sql.DB, registry *mqttclient.BrokerRegistry, scheduler *cron.Scheduler, logicEngine logic.LogicEngine, wsHub *ws.Hub, seedFile, cronExpr string) error {
	if cronExpr == "" {
		cronExpr = "0 */5 * * *"
	}
	if cronExpr == "off" || cronExpr == "disabled" {
		slog.Info("demo auto-reset disabled via configuration")
		return nil
	}

	err := scheduler.AddSystemJob("demo-reset", cronExpr, func() {
		ResetDatabase(database, registry, scheduler, logicEngine, wsHub, seedFile)
	})
	if err != nil {
		return fmt.Errorf("schedule demo auto-reset: %w", err)
	}

	slog.Info("demo auto-reset scheduled", "cron", cronExpr)
	return nil
}
