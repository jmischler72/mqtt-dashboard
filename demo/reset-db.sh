#!/bin/sh
DB=/app/data/mqtt-dashboard.db

if [ ! -f "$DB" ]; then
  echo "$(date): database not found, skipping reset"
  exit 0
fi

sqlite3 "$DB" "
  DELETE FROM mqtt_brokers;
  DELETE FROM dashboard_layouts;
  DELETE FROM dashboards WHERE id != 'default';
  DELETE FROM mqtt_history;
  UPDATE app_settings SET retention_period_hours=24, save_sys_topics=0 WHERE id=1;
"

echo "$(date): database reset complete"
