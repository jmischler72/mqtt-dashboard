#!/usr/bin/env python3
"""
MQTT Worker — publishes test messages to all three dev brokers.

Two publishing profiles run concurrently:
  - IoT simulator  : random sensor data on sensors/<room>/<metric> topics
  - Simple payloads: incrementing counters on test/<topic> topics

Environment variables:
  PUBLISH_INTERVAL   seconds between publish rounds (default: 5)
  BROKER_PLAIN_HOST  plain broker host (default: mosquitto)
  BROKER_PLAIN_PORT  plain broker port (default: 1883)
  BROKER_PASS_HOST   password broker host (default: mosquitto-password)
  BROKER_PASS_PORT   password broker port (default: 1883)
  BROKER_PASS_USER   username for password broker (default: testuser)
  BROKER_PASS_PASS   password for password broker (default: testpass)
  BROKER_TLS_HOST    TLS broker host (default: mosquitto-tls)
  BROKER_TLS_PORT    TLS broker port (default: 8883)
  TLS_CA_CERT        path to CA certificate for TLS broker (default: /certs/ca.crt)
"""

import json
import logging
import os
import random
import signal
import ssl
import sys
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger("mqtt-worker")

# ── Configuration ──────────────────────────────────────────────────────────────

PUBLISH_INTERVAL = float(os.environ.get("PUBLISH_INTERVAL", "5"))

BROKERS = [
    {
        "name": "plain",
        "host": os.environ.get("BROKER_PLAIN_HOST", "mosquitto"),
        "port": int(os.environ.get("BROKER_PLAIN_PORT", "1883")),
        "tls": False,
        "username": None,
        "password": None,
    },
    {
        "name": "password",
        "host": os.environ.get("BROKER_PASS_HOST", "mosquitto-password"),
        "port": int(os.environ.get("BROKER_PASS_PORT", "1883")),
        "tls": False,
        "username": os.environ.get("BROKER_PASS_USER", "testuser"),
        "password": os.environ.get("BROKER_PASS_PASS", "testpass"),
    },
    {
        "name": "tls",
        "host": os.environ.get("BROKER_TLS_HOST", "mosquitto-tls"),
        "port": int(os.environ.get("BROKER_TLS_PORT", "8883")),
        "tls": True,
        "ca_cert": os.environ.get("TLS_CA_CERT", "/certs/ca.crt"),
        "username": None,
        "password": None,
    },
]

# ── IoT simulator topics ───────────────────────────────────────────────────────

ROOMS = ["living-room", "bedroom", "kitchen", "office", "bathroom"]

IOT_TOPICS = [
    ("sensors/{room}/temperature", lambda: round(random.uniform(18.0, 28.0), 1)),
    ("sensors/{room}/humidity",    lambda: round(random.uniform(30.0, 70.0), 1)),
    ("sensors/{room}/pressure",    lambda: round(random.uniform(990.0, 1030.0), 1)),
    ("sensors/{room}/motion",      lambda: random.choice([True, False])),
    ("sensors/{room}/light",       lambda: random.randint(0, 1000)),
]

# ── Simple test topics ─────────────────────────────────────────────────────────

SIMPLE_TOPICS = ["test/topic1", "test/topic2", "test/counter", "test/status"]
_counter = 0


def next_counter():
    global _counter
    _counter += 1
    return _counter


SIMPLE_PAYLOADS = [
    lambda: f"hello from worker #{next_counter()}",
    lambda: str(random.randint(0, 9999)),
    lambda: str(next_counter()),
    lambda: random.choice(["online", "offline", "idle", "busy"]),
]

# ── MQTT client factory ────────────────────────────────────────────────────────


def make_client(broker: dict) -> mqtt.Client:
    client_id = f"mqtt-worker-{broker['name']}-{random.randint(1000, 9999)}"
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)

    if broker.get("username"):
        client.username_pw_set(broker["username"], broker["password"])

    if broker.get("tls"):
        ca_cert = broker.get("ca_cert", "/certs/ca.crt")
        if not os.path.exists(ca_cert):
            logger.warning("TLS broker %s: CA cert not found at %s — skipping TLS setup", broker["name"], ca_cert)
        else:
            client.tls_set(ca_certs=ca_cert, tls_version=ssl.PROTOCOL_TLS_CLIENT)
            client.tls_insecure_set(False)

    def on_connect(c, userdata, flags, reason_code, properties):
        if reason_code == 0:
            logger.info("Connected to %s broker at %s:%d", broker["name"], broker["host"], broker["port"])
        else:
            logger.error("Failed to connect to %s broker: reason_code=%s", broker["name"], reason_code)

    def on_disconnect(c, userdata, disconnect_flags, reason_code, properties):
        if reason_code != 0:
            logger.warning("Disconnected from %s broker unexpectedly: %s", broker["name"], reason_code)

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect

    return client


def connect_client(client: mqtt.Client, broker: dict) -> bool:
    try:
        client.connect(broker["host"], broker["port"], keepalive=60)
        client.loop_start()
        time.sleep(1)  # let on_connect fire
        return True
    except Exception as exc:
        logger.error("Could not connect to %s broker at %s:%d — %s", broker["name"], broker["host"], broker["port"], exc)
        return False


# ── Publish helpers ────────────────────────────────────────────────────────────


def publish_iot(client: mqtt.Client, broker_name: str):
    room = random.choice(ROOMS)
    topic_template, value_fn = random.choice(IOT_TOPICS)
    topic = topic_template.format(room=room)
    payload = json.dumps({
        "value": value_fn(),
        "unit": _unit_for(topic_template),
        "room": room,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "broker": broker_name,
    })
    return topic, payload


def publish_simple(client: mqtt.Client, broker_name: str):
    idx = random.randint(0, len(SIMPLE_TOPICS) - 1)
    topic = SIMPLE_TOPICS[idx]
    payload = SIMPLE_PAYLOADS[idx]()
    return topic, str(payload)


def _unit_for(template: str) -> str:
    if "temperature" in template:
        return "°C"
    if "humidity" in template:
        return "%"
    if "pressure" in template:
        return "hPa"
    if "light" in template:
        return "lux"
    return ""


# ── Main loop ─────────────────────────────────────────────────────────────────

_running = True


def _shutdown(sig, frame):
    global _running
    logger.info("Shutdown signal received — stopping...")
    _running = False


signal.signal(signal.SIGTERM, _shutdown)
signal.signal(signal.SIGINT, _shutdown)


def main():
    logger.info("MQTT Worker starting — interval=%.1fs, brokers=%s",
                PUBLISH_INTERVAL, [b["name"] for b in BROKERS])

    clients = []
    for broker in BROKERS:
        client = make_client(broker)
        ok = connect_client(client, broker)
        if ok:
            clients.append((client, broker))
        else:
            logger.warning("Broker %s skipped — could not connect at startup", broker["name"])

    if not clients:
        logger.error("No brokers connected — exiting")
        sys.exit(1)

    round_num = 0
    while _running:
        round_num += 1
        for client, broker in clients:
            if not client.is_connected():
                logger.warning("Broker %s disconnected — skipping round %d", broker["name"], round_num)
                continue

            # IoT payload
            topic, payload = publish_iot(client, broker["name"])
            qos = random.choice([0, 1, 2])
            retain = random.random() < 0.2  # 20% chance of retain
            result = client.publish(topic, payload, qos=qos, retain=retain)
            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                logger.debug("[%s] IoT → %s (qos=%d retain=%s): %s", broker["name"], topic, qos, retain, payload)
            else:
                logger.warning("[%s] Publish failed on %s: rc=%d", broker["name"], topic, result.rc)

            # Simple payload
            topic, payload = publish_simple(client, broker["name"])
            qos = random.choice([0, 1, 2])
            retain = random.random() < 0.2
            result = client.publish(topic, payload, qos=qos, retain=retain)
            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                logger.debug("[%s] Simple → %s (qos=%d retain=%s): %s", broker["name"], topic, qos, retain, payload)
            else:
                logger.warning("[%s] Publish failed on %s: rc=%d", broker["name"], topic, result.rc)

        logger.info("Round %d done — published to %d broker(s) — next in %.1fs",
                    round_num, len(clients), PUBLISH_INTERVAL)
        time.sleep(PUBLISH_INTERVAL)

    for client, broker in clients:
        client.loop_stop()
        client.disconnect()
        logger.info("Disconnected from %s broker", broker["name"])


if __name__ == "__main__":
    main()
