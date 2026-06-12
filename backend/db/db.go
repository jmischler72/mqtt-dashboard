package db

import (
	"database/sql"
	"fmt"
	"log/slog"
	"strings"

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
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
			qos INTEGER NOT NULL DEFAULT 0,
			retained BOOLEAN NOT NULL DEFAULT 0
		);

		CREATE INDEX IF NOT EXISTS idx_mqtt_history_broker_topic_time ON mqtt_history(broker_id, topic, timestamp);
	`); err != nil {
		return err
	}

	if _, err := db.Exec(`INSERT OR IGNORE INTO app_settings (id) VALUES (1)`); err != nil {
		return err
	}

	// Add qos/retained columns to mqtt_history for existing databases.
	// ALTER TABLE fails with "duplicate column" if the column already exists; that
	// error is safe to ignore. Any other error is propagated.
	for _, col := range []struct {
		stmt string
		name string
	}{
		{`ALTER TABLE mqtt_history ADD COLUMN qos INTEGER NOT NULL DEFAULT 0`, "qos"},
		{`ALTER TABLE mqtt_history ADD COLUMN retained BOOLEAN NOT NULL DEFAULT 0`, "retained"},
	} {
		if _, err := db.Exec(col.stmt); err != nil && !isDuplicateColumnErr(err) {
			return fmt.Errorf("migrate mqtt_history add %s: %w", col.name, err)
		}
	}
	return nil
}

// isDuplicateColumnErr reports whether err is a SQLite "duplicate column name" error,
// which is returned when ALTER TABLE ADD COLUMN is called for a column that already exists.
func isDuplicateColumnErr(err error) bool {
	return err != nil && strings.Contains(err.Error(), "duplicate column name")
}
