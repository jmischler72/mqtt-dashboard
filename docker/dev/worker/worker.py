#!/usr/bin/env python3
"""
MQTT Worker — feeds the dev brokers so every panel type has something to show.

Three profiles run concurrently:

  - IoT simulator  : random sensor data on sensors/<room>/<metric>, all brokers
  - Simple payloads: incrementing counters on test/<topic>, all brokers
  - Showcase device: the demo/ namespace on the plain broker only — smooth
                     series for the graph, and simulated devices that answer
                     the commands the toggle, slider, button, input and cron
                     panels publish. Without this last part those panels have
                     nowhere to publish to and never read a state back.

The showcase stays on one broker on purpose: it ticks fast, and triplicating it
would fill the history database with the same three copies of every point.

Environment variables:
  PUBLISH_INTERVAL   seconds between sensors/ and test/ rounds (default: 5)
  DEMO_INTERVAL      seconds between demo/ telemetry ticks (default: 1)
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
import threading
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
DEMO_INTERVAL = float(os.environ.get("DEMO_INTERVAL", "1"))

BROKERS = [
    {
        "name": "plain",
        "host": os.environ.get("BROKER_PLAIN_HOST", "mosquitto"),
        "port": int(os.environ.get("BROKER_PLAIN_PORT", "1883")),
        "tls": False,
        "username": None,
        "password": None,
        # The demo/ namespace lives here only — see the module docstring.
        "showcase": True,
    },
    {
        "name": "password",
        "host": os.environ.get("BROKER_PASS_HOST", "mosquitto-password"),
        "port": int(os.environ.get("BROKER_PASS_PORT", "1883")),
        "tls": False,
        "username": os.environ.get("BROKER_PASS_USER", "testuser"),
        "password": os.environ.get("BROKER_PASS_PASS", "testpass"),
        "showcase": False,
    },
    {
        "name": "tls",
        "host": os.environ.get("BROKER_TLS_HOST", "mosquitto-tls"),
        "port": int(os.environ.get("BROKER_TLS_PORT", "8883")),
        "tls": True,
        "ca_cert": os.environ.get("TLS_CA_CERT", "/certs/ca.crt"),
        "client_cert": os.environ.get("TLS_CLIENT_CERT", "/certs/client.crt"),
        "client_key": os.environ.get("TLS_CLIENT_KEY", "/certs/client.key"),
        "username": None,
        "password": None,
        "showcase": False,
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

# ── Showcase: the demo/ namespace ──────────────────────────────────────────────
#
# Telemetry is a random walk rather than an independent draw per tick: a graph
# of uniform noise says nothing about whether the chart works, where a walk with
# a visible trend does. Each series carries its bounds so it cannot wander off
# the axis a panel is configured with.

DEMO_SERIES = {
    # topic: [value, low, high, step, shape]
    "demo/graph/temperature": [21.5, 17.0, 27.0, 0.25, "json"],
    "demo/graph/humidity": [48.0, 30.0, 70.0, 0.6, "json"],
    # Bare number, no JSON around it — the other half of what payload shapes
    # have to cope with, and what most small devices actually publish.
    "demo/graph/power": [1200.0, 200.0, 2600.0, 45.0, "bare"],
    # Mostly numbers with the occasional bit of text, so the graph's "nothing
    # numeric in these messages" path and the log panel both have a subject.
    "demo/graph/mixed": [50.0, 0.0, 100.0, 4.0, "flaky"],
}

DEMO_UNITS = {
    "demo/graph/temperature": "°C",
    "demo/graph/humidity": "%",
    "demo/graph/power": "W",
    "demo/graph/mixed": "",
}

# Devices the control panels drive. State is retained so a freshly loaded
# dashboard shows the real position instead of waiting for the next command.
DEMO_STATE = {
    "lamp": "OFF",       # demo/lamp/state    — toggle panel
    "fan": 40,           # demo/fan/state     — slider panel
    "setpoint": 21.0,    # demo/thermostat/state — slider with a JSON shape
    "measured": 21.0,
}
_state_lock = threading.Lock()

# What the worker listens to. Every one of these is something a panel in the
# showcase dashboards publishes; anything arriving here is echoed to
# demo/events, which is what makes a log panel useful for debugging a control.
COMMAND_TOPICS = [
    "demo/lamp/set",
    "demo/fan/set",
    "demo/thermostat/set",
    "demo/actions/+",
    "test/command",
    "test/heartbeat",
]

EVENTS_TOPIC = "demo/events"


def _step_series(topic: str) -> str:
    """Advance one demo series and render the payload a device would send."""
    value, low, high, step, shape = DEMO_SERIES[topic]
    value += random.uniform(-step, step)
    # Reflect off the bounds rather than clamping: a series pinned flat at its
    # limit looks like a broken feed.
    if value < low:
        value = low + (low - value)
    if value > high:
        value = high - (value - high)
    DEMO_SERIES[topic][0] = value

    rounded = round(value, 1)

    if shape == "bare":
        return str(int(rounded))
    if shape == "flaky":
        if random.random() < 0.12:
            return random.choice(["n/a", "unavailable", "error"])
        return str(rounded)
    return json.dumps({
        "value": rounded,
        "unit": DEMO_UNITS[topic],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


def _publish(client: mqtt.Client, topic: str, payload: str, qos: int = 0, retain: bool = False):
    result = client.publish(topic, payload, qos=qos, retain=retain)
    if result.rc != mqtt.MQTT_ERR_SUCCESS:
        logger.warning("Publish failed on %s: rc=%d", topic, result.rc)
    return result.rc == mqtt.MQTT_ERR_SUCCESS


def publish_demo_state(client: mqtt.Client):
    """Publish every device state, retained. Called on connect and on change."""
    with _state_lock:
        lamp = DEMO_STATE["lamp"]
        fan = DEMO_STATE["fan"]
        setpoint = DEMO_STATE["setpoint"]
        measured = DEMO_STATE["measured"]

    # Three deliberately different shapes, so the panels reading them exercise
    # three different read templates rather than the same one three times.
    _publish(client, "demo/lamp/state", lamp, qos=1, retain=True)
    _publish(client, "demo/fan/state", json.dumps({"speed": fan, "unit": "%"}), qos=1, retain=True)
    _publish(
        client,
        "demo/thermostat/state",
        json.dumps({"setpoint": round(setpoint, 1), "measured": round(measured, 1), "unit": "°C"}),
        qos=1,
        retain=True,
    )


def _as_number(text: str):
    """The number in a payload, whether it is bare or wrapped in JSON."""
    try:
        return float(text)
    except ValueError:
        pass
    try:
        doc = json.loads(text)
    except (ValueError, TypeError):
        return None
    if isinstance(doc, (int, float)) and not isinstance(doc, bool):
        return float(doc)
    if isinstance(doc, dict):
        for key in ("value", "speed", "setpoint", "level", "position"):
            if isinstance(doc.get(key), (int, float)) and not isinstance(doc[key], bool):
                return float(doc[key])
    return None


ON_WORDS = ("ON", "TRUE", "1", "YES", "OPEN")
OFF_WORDS = ("OFF", "FALSE", "0", "NO", "CLOSED")


def _as_state(text: str):
    """ON/OFF out of a payload, bare or wrapped — a toggle may publish either.

    A panel writing through a shape sends `{"state": "ON"}` where a bare one
    sends `ON`; both mean the same thing to the device, so both are accepted.
    """
    word = text.strip().strip('"').upper()
    if word in ON_WORDS:
        return "ON"
    if word in OFF_WORDS:
        return "OFF"
    try:
        doc = json.loads(text)
    except (ValueError, TypeError):
        return None
    if isinstance(doc, bool):
        return "ON" if doc else "OFF"
    if isinstance(doc, dict):
        for key in ("state", "value", "power", "lamp", "status"):
            if key in doc:
                return _as_state(str(doc[key]))
    return None


def handle_command(client: mqtt.Client, topic: str, payload: str) -> str:
    """
    Apply a command from a panel and answer with the line to log.

    Returning the description rather than logging it here keeps the echo to
    demo/events in one place, so every command shows up there exactly once —
    including the ones that change nothing, which are the interesting case when
    a control panel looks like it is doing nothing.
    """
    if topic == "demo/lamp/set":
        state = _as_state(payload)
        if state is None:
            return f"lamp: unrecognised payload {payload!r}"
        with _state_lock:
            DEMO_STATE["lamp"] = state
        publish_demo_state(client)
        return f"lamp → {state}"

    if topic == "demo/fan/set":
        number = _as_number(payload)
        if number is None:
            return f"fan: no number in {payload!r}"
        speed = int(max(0, min(100, number)))
        with _state_lock:
            DEMO_STATE["fan"] = speed
        publish_demo_state(client)
        return f"fan → {speed}%"

    if topic == "demo/thermostat/set":
        number = _as_number(payload)
        if number is None:
            return f"thermostat: no number in {payload!r}"
        setpoint = max(5.0, min(30.0, number))
        with _state_lock:
            DEMO_STATE["setpoint"] = setpoint
        publish_demo_state(client)
        return f"thermostat → {setpoint:g}°C"

    if topic.startswith("demo/actions/"):
        return f"action {topic.rsplit('/', 1)[-1]}: {payload}"

    return f"{topic}: {payload}"


# ── MQTT client factory ────────────────────────────────────────────────────────


def make_client(broker: dict) -> mqtt.Client:
    client_id = f"mqtt-worker-{broker['name']}-{random.randint(1000, 9999)}"
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)

    if broker.get("username"):
        client.username_pw_set(broker["username"], broker["password"])

    if broker.get("tls"):
        ca_cert = broker.get("ca_cert", "/certs/ca.crt")
        client_cert = broker.get("client_cert", "/certs/client.crt")
        client_key = broker.get("client_key", "/certs/client.key")
        if not os.path.exists(ca_cert):
            logger.warning("TLS broker %s: CA cert not found at %s — skipping TLS setup", broker["name"], ca_cert)
        else:
            tls_kwargs = {"ca_certs": ca_cert, "tls_version": ssl.PROTOCOL_TLS_CLIENT}
            if os.path.exists(client_cert) and os.path.exists(client_key):
                tls_kwargs["certfile"] = client_cert
                tls_kwargs["keyfile"] = client_key
            client.tls_set(**tls_kwargs)
            client.tls_insecure_set(False)

    def on_connect(c, userdata, flags, reason_code, properties):
        if reason_code != 0:
            logger.error("Failed to connect to %s broker: reason_code=%s", broker["name"], reason_code)
            return
        logger.info("Connected to %s broker at %s:%d", broker["name"], broker["host"], broker["port"])
        if not broker.get("showcase"):
            return
        # Subscribing here rather than once after connect means a reconnect
        # restores the subscriptions too, instead of leaving the controls dead.
        for filt in COMMAND_TOPICS:
            c.subscribe(filt, qos=1)
        logger.info("Listening for panel commands on %s", ", ".join(COMMAND_TOPICS))
        publish_demo_state(c)

    def on_disconnect(c, userdata, disconnect_flags, reason_code, properties):
        if reason_code != 0:
            logger.warning("Disconnected from %s broker unexpectedly: %s", broker["name"], reason_code)

    def on_message(c, userdata, msg):
        payload = msg.payload.decode("utf-8", errors="replace")
        try:
            description = handle_command(c, msg.topic, payload)
        except Exception as exc:  # a bad payload must not kill the worker
            logger.exception("Error handling %s", msg.topic)
            description = f"{msg.topic}: error — {exc}"
        logger.info("Command %s → %s", msg.topic, description)
        _publish(
            c,
            EVENTS_TOPIC,
            json.dumps({
                "topic": msg.topic,
                "payload": payload,
                "result": description,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }),
        )

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = on_message

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


def publish_demo_tick(client: mqtt.Client):
    """One tick of showcase telemetry: every series, every time.

    The sensors/ simulator picks one random topic per round, which leaves any
    single topic with a point every few minutes — far too sparse to draw a line
    with. The showcase series are published together on every tick instead.
    """
    for topic in DEMO_SERIES:
        _publish(client, topic, _step_series(topic))

    # The measured temperature chases the setpoint, so moving the thermostat
    # slider shows up as a curve on the graph rather than an instant jump.
    with _state_lock:
        setpoint = DEMO_STATE["setpoint"]
        measured = DEMO_STATE["measured"]
        measured += (setpoint - measured) * 0.08 + random.uniform(-0.05, 0.05)
        DEMO_STATE["measured"] = measured
        fan = DEMO_STATE["fan"]
        lamp = DEMO_STATE["lamp"]

    _publish(client, "demo/thermostat/measured", json.dumps({"value": round(measured, 2), "unit": "°C"}))
    # A single JSON document holding everything, for panels reading one topic
    # through different shapes — and an easy target for a debug log panel.
    _publish(client, "demo/house/summary", json.dumps({
        "lamp": lamp,
        "fan": {"speed": fan, "unit": "%"},
        "thermostat": {"setpoint": round(setpoint, 1), "measured": round(measured, 1)},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }))


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
    logger.info("MQTT Worker starting — interval=%.1fs, demo interval=%.1fs, brokers=%s",
                PUBLISH_INTERVAL, DEMO_INTERVAL, [b["name"] for b in BROKERS])

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

    # The two profiles run at different rates, so the slow one is driven by
    # elapsed time rather than by counting fast ticks.
    round_num = 0
    next_slow_round = 0.0

    while _running:
        now = time.monotonic()

        for client, broker in clients:
            if not client.is_connected():
                continue
            if broker.get("showcase"):
                publish_demo_tick(client)

        if now >= next_slow_round:
            round_num += 1
            published_to = 0
            for client, broker in clients:
                if not client.is_connected():
                    logger.warning("Broker %s disconnected — skipping round %d", broker["name"], round_num)
                    continue
                published_to += 1

                # IoT payload
                topic, payload = publish_iot(client, broker["name"])
                qos = random.choice([0, 1, 2])
                retain = random.random() < 0.2  # 20% chance of retain
                if _publish(client, topic, payload, qos=qos, retain=retain):
                    logger.debug("[%s] IoT → %s (qos=%d retain=%s): %s", broker["name"], topic, qos, retain, payload)

                # Simple payload
                topic, payload = publish_simple(client, broker["name"])
                qos = random.choice([0, 1, 2])
                retain = random.random() < 0.2
                if _publish(client, topic, payload, qos=qos, retain=retain):
                    logger.debug("[%s] Simple → %s (qos=%d retain=%s): %s", broker["name"], topic, qos, retain, payload)

            logger.info("Round %d done — published to %d broker(s) — next in %.1fs",
                        round_num, published_to, PUBLISH_INTERVAL)
            next_slow_round = now + PUBLISH_INTERVAL

        time.sleep(DEMO_INTERVAL)

    for client, broker in clients:
        client.loop_stop()
        client.disconnect()
        logger.info("Disconnected from %s broker", broker["name"])


if __name__ == "__main__":
    main()
