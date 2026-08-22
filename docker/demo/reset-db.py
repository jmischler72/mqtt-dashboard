import json
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

UPDATE dashboards SET name = 'Home Automation' WHERE id = 'default';
""")

panels = [
    (
        "panel-smart-home",
        "default",
        "Smart Home",
        "text",
        0,
        0,
        4,
        2,
        json.dumps({
            "markdown": "# 🏠 Smart Home\n\nLive IoT controls & environmental sensors:\n- Living Room & Bathroom\n- Bedroom Temperature\n\n> System: **Online**",
        }),
        None,
    ),
    (
        "panel-zone-divider",
        "default",
        "Zone Divider",
        "separator",
        4,
        0,
        1,
        6,
        json.dumps({
            "orientation": "vertical",
        }),
        None,
    ),
    (
        "panel-env-stats",
        "default",
        "Environment Stats",
        "stats",
        5,
        0,
        3,
        2,
        json.dumps({
            "topic": "sensors/#",
            "defaultRange": 900,
            "showStatTiles": True,
            "showChart": True,
            "showTopicBreakdown": False,
            "header_meta_pinned": False,
        }),
        "demo-broker",
    ),
    (
        "panel-floor-plan",
        "default",
        "Floor Plan",
        "image",
        8,
        0,
        4,
        2,
        json.dumps({
            "src": "https://www.livehome3d.com/assets/img/articles/design-house/how-to-design-a-house@2x.jpg",
        }),
        None,
    ),
    (
        "panel-bathroom-humidity",
        "default",
        "Bathroom Humidity",
        "button",
        0,
        2,
        2,
        2,
        json.dumps({
            "label": "Boost Fan",
            "topic": "sensors/bathroom/humidity",
            "payload": "{\n  \"action\": \"boost\"\n}",
            "qos": 0,
            "retain": False,
            "header_meta_pinned": False,
        }),
        "demo-broker",
    ),
    (
        "panel-office-sync",
        "default",
        "Office Sync",
        "cron",
        2,
        2,
        2,
        2,
        json.dumps({
            "cron_expr": "* * * * *",
            "topic": "sensors/office",
            "payload": "hello",
            "qos": 0,
            "retain": False,
            "enabled": True,
            "header_meta_pinned": True,
        }),
        "demo-broker",
    ),
    (
        "panel-living-room-temp",
        "default",
        "Living Room Temperature",
        "gauge",
        5,
        2,
        3,
        3,
        json.dumps({
            "topic": "sensors/living-room/temperature",
            "unit": "°C",
            "min": 0,
            "max": 40,
            "colorScheme": "auto",
            "gaugeType": "radial",
        }),
        "demo-broker",
    ),
    (
        "panel-custom-command",
        "default",
        "Custom Command",
        "input",
        8,
        2,
        4,
        3,
        json.dumps({
            "topic": "home/command",
            "qos": 0,
            "retain": False,
        }),
        "demo-broker",
    ),
    (
        "panel-office-log",
        "default",
        "Office Log",
        "log",
        0,
        4,
        4,
        2,
        json.dumps({
            "topics": "sensors/office/#",
            "maxMessages": 200,
            "dateFormat": "full",
            "showQos": True,
            "showRetained": True,
        }),
        "demo-broker",
    ),
    (
        "panel-section-divider",
        "default",
        "Section Divider",
        "separator",
        0,
        6,
        12,
        1,
        json.dumps({
            "orientation": "horizontal",
            "thickness": 2,
            "color": "#9ca3af",
        }),
        None,
    ),
    (
        "panel-send-custom-humidity",
        "default",
        "Send Custom Humidity",
        "input",
        0,
        7,
        4,
        2,
        json.dumps({
            "topic": "sensors/bathroom/humidity",
            "qos": 1,
            "retain": True,
            "header_meta_pinned": False,
        }),
        "demo-broker",
    ),
    (
        "panel-kitchen-log",
        "default",
        "Kitchen Log",
        "log",
        0,
        9,
        4,
        2,
        json.dumps({
            "topics": "sensors/kitchen/#",
            "maxMessages": 200,
            "dateFormat": "full",
            "showQos": True,
            "showRetained": True,
        }),
        "demo-broker",
    ),
    (
        "panel-scheduled-env-poll",
        "default",
        "Scheduled Environment Poll",
        "cron",
        4,
        7,
        4,
        4,
        json.dumps({
            "cron_expr": "*/5 * * * *",
            "topic": "sensors/bathroom/#",
            "payload": "",
            "qos": 0,
            "retain": False,
            "enabled": False,
        }),
        "demo-broker",
    ),
    (
        "panel-sensor-metrics",
        "default",
        "Sensor Metrics",
        "stats",
        8,
        7,
        4,
        4,
        json.dumps({
            "topic": "sensors/#",
            "defaultRange": 60,
            "showStatTiles": True,
            "showChart": True,
            "showTopicBreakdown": True,
            "header_meta_pinned": True,
        }),
        "demo-broker",
    ),
]

con.executemany(
    """
    INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
    panels,
)

con.commit()
con.close()
print("DB reset and re-seeded")
