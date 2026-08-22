import sqlite3

DB = "/app/data/mqtt-dashboard.db"

con = sqlite3.connect(DB)
con.executescript("""
DELETE FROM mqtt_brokers;
DELETE FROM dashboard_layouts;
DELETE FROM dashboards WHERE id != 'default';
DELETE FROM mqtt_history;
UPDATE app_settings SET retention_period_hours=24, save_sys_topics=0 WHERE id=1;

INSERT INTO mqtt_brokers (id, name, host, port, is_enabled, sort_order, auth_mode, tls_enabled, tls_skip_verify)
  VALUES ('demo-broker', 'Demo Broker', 'mosquitto', 1883, 1, 0, 'none', 0, 0);

INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES
  ('panel-welcome', 'default', 'Welcome',       'text',  0, 0, 12, 2, '{"markdown":"# MQTT Dashboard Demo\\nA worker publishes live sensor data every 5 seconds. **Your changes are reset every 5 hours."}', NULL),
  ('panel-stats',   'default', 'Activity',      'stats', 0, 2, 12, 6, '{"showStatTiles":true,"showChart":true,"showTopicBreakdown":true,"defaultRange":60}', 'demo-broker'),
  ('panel-sensors', 'default', 'Sensor Data',   'log',   0, 8,  6, 8, '{"topics":"sensors/#","maxMessages":50}', 'demo-broker'),
  ('panel-test',    'default', 'Test Messages', 'log',   6, 8,  6, 8, '{"topics":"test/#","maxMessages":50}', 'demo-broker');
""")
con.commit()
con.close()
print("DB reset and re-seeded")
