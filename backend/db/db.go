package db

import (
	"database/sql"
	"fmt"
	"log/slog"

	_ "modernc.org/sqlite"
)

func InitDB(path string) (*sql.DB, error) {
	slog.Info("opening database", "path", path)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	// Serialise all DB access through a single connection to prevent SQLITE_BUSY
	// errors from concurrent goroutines (history writer, pruning cron, HTTP handlers).
	db.SetMaxOpenConns(1)
	// WAL mode allows concurrent reads alongside writes and is required for
	// reliable multi-goroutine access. busy_timeout makes the driver retry for up
	// to 5 s before returning SQLITE_BUSY instead of failing immediately.
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA synchronous=NORMAL",
	} {
		if _, err := db.Exec(pragma); err != nil {
			return nil, fmt.Errorf("apply %s: %w", pragma, err)
		}
	}
	if err := migrate(db); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}

func migrate(db *sql.DB) error {
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS mqtt_brokers (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			host TEXT NOT NULL,
			port INTEGER NOT NULL,
			client_id TEXT,
			username TEXT,
			password TEXT,
			is_enabled BOOLEAN DEFAULT 1,
			sort_order INTEGER NOT NULL DEFAULT 0,
			auth_mode TEXT NOT NULL DEFAULT 'none',
			tls_enabled BOOLEAN NOT NULL DEFAULT 0,
			tls_skip_verify BOOLEAN NOT NULL DEFAULT 0,
			ca_cert TEXT,
			client_cert TEXT,
			client_key TEXT
		);

		CREATE TABLE IF NOT EXISTS dashboards (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS dashboard_layouts (
			id TEXT PRIMARY KEY,
			dashboard_id TEXT NOT NULL DEFAULT '',
			title TEXT NOT NULL,
			panel_type TEXT NOT NULL,
			x INTEGER NOT NULL DEFAULT 0,
			y INTEGER NOT NULL DEFAULT 0,
			w INTEGER NOT NULL DEFAULT 4,
			h INTEGER NOT NULL DEFAULT 4,
			config_json TEXT,
			broker_id TEXT
		);
	`); err != nil {
		return err
	}

	if _, err := db.Exec(`INSERT OR IGNORE INTO dashboards (id, name) VALUES ('default', 'Default')`); err != nil {
		return err
	}

	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS app_settings (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			retention_period_hours INTEGER DEFAULT 24,
			save_sys_topics BOOLEAN DEFAULT 0
		);

		CREATE TABLE IF NOT EXISTS mqtt_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			broker_id TEXT NOT NULL,
			topic TEXT NOT NULL,
			payload TEXT,
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_mqtt_history_broker_topic_time ON mqtt_history(broker_id, topic, timestamp);
	`); err != nil {
		return err
	}

	_, err := db.Exec(`INSERT OR IGNORE INTO app_settings (id) VALUES (1)`)
	return err
}
