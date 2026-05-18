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
			sort_order INTEGER NOT NULL DEFAULT 0
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
			show_sys_topics BOOLEAN DEFAULT 0
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

	// Beta-safe compatibility: add the column if DB was created before this field.
	_, _ = db.Exec(`ALTER TABLE app_settings ADD COLUMN show_sys_topics BOOLEAN DEFAULT 0`)

	_, err := db.Exec(`INSERT OR IGNORE INTO app_settings (id) VALUES (1)`)
	return err
}
