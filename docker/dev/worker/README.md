# MQTT Worker

Test message publisher for MQTT Dashboard development and integration testing.

## Overview

The test worker is included in the development Docker Compose stack (`docker/dev/docker-compose-dev.yml`) to continuously publish realistic telemetry and test payloads to the three dev Mosquitto brokers (`mosquitto`, `mosquitto-password`, `mosquitto-tls`).

Three publishing profiles run concurrently:

- **IoT Simulator** (all brokers): Generates realistic sensor telemetry (temperature, humidity, pressure, motion, light) on `sensors/<room>/<metric>` topics with JSON payloads containing timestamps and units. One random topic per round.
- **Simple Payloads** (all brokers): Incrementing counters, random numbers, and status strings on `test/<topic>` topics (e.g. `test/topic1`, `test/counter`, `test/status`).
- **Showcase Device** (plain broker only): The `demo/` namespace behind the seeded showcase dashboards — smooth series for the graph panels, and simulated devices that **answer the commands the control panels publish**. Without it, a toggle or slider has nowhere to publish and never reads a state back.

The first two profiles randomly assign QoS levels (0, 1, 2) and Retain flags to test broker and dashboard behavior. The showcase stays on one broker on purpose: it ticks once a second, and triplicating it would fill the history database with three copies of every point.

---

## The `demo/` namespace

### Telemetry — published every `DEMO_INTERVAL`

| Topic | Payload | For |
| --- | --- | --- |
| `demo/graph/temperature` | `{"value": 21.4, "unit": "°C", "timestamp": …}` | graph, gauge |
| `demo/graph/humidity` | `{"value": 48.2, "unit": "%", "timestamp": …}` | graph, gauge |
| `demo/graph/power` | `1240` (bare number) | graph with no read shape |
| `demo/graph/mixed` | mostly numbers, ~1 in 8 is `n/a` / `error` | the graph's "nothing numeric here" path |
| `demo/thermostat/measured` | `{"value": 21.4, "unit": "°C"}` | gauge, graph |
| `demo/house/summary` | every device in one JSON document | payload-shape experiments |

Values are a bounded random walk, not an independent draw per tick — a graph of uniform noise says nothing about whether the chart works.

### Devices — command in, retained state out

The worker subscribes to each command topic, applies it to a simulated device, republishes that device's **retained** state, and echoes a line to `demo/events`.

| Command topic | Accepted payloads | State topic (retained) |
| --- | --- | --- |
| `demo/lamp/set` | `ON` / `OFF` (also `true`, `1`, `yes`…) bare, or wrapped: `{"state": "ON"}` | `demo/lamp/state` → `ON` / `OFF` |
| `demo/fan/set` | a number, bare or as `{"value": …}` / `{"speed": …}` | `demo/fan/state` → `{"speed": 40, "unit": "%"}` |
| `demo/thermostat/set` | a number, bare or as `{"setpoint": …}` | `demo/thermostat/state` → `{"setpoint": 21, "measured": 20.4, "unit": "°C"}` |
| `demo/actions/+` | anything — button, cron and retained-input targets | *(no device; logged only)* |
| `test/command` | anything — the free-text input panel | *(no device; logged only)* |
| `test/heartbeat` | anything — the cron panel | *(no device; logged only)* |

`demo/events` carries `{"topic", "payload", "result", "timestamp"}` for **every** command received, including ones that changed nothing — which is the interesting case when a control panel looks like it is doing nothing. Point a log panel at it.

The thermostat's measured temperature chases its setpoint rather than jumping, so moving the slider draws a curve on the graph.

---

## Environment Variables

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PUBLISH_INTERVAL` | `5` | Seconds between `sensors/` and `test/` rounds |
| `DEMO_INTERVAL` | `1` | Seconds between `demo/` telemetry ticks |
| `BROKER_PLAIN_HOST` | `mosquitto` | Host for anonymous plain TCP broker |
| `BROKER_PLAIN_PORT` | `1883` | Port for anonymous plain TCP broker |
| `BROKER_PASS_HOST` | `mosquitto-password` | Host for password-authenticated broker |
| `BROKER_PASS_PORT` | `1883` | Port for password broker |
| `BROKER_PASS_USER` | `testuser` | Username for password broker |
| `BROKER_PASS_PASS` | `testpass` | Password for password broker |
| `BROKER_TLS_HOST` | `mosquitto-tls` | Host for TLS/SSL broker |
| `BROKER_TLS_PORT` | `8883` | Port for TLS/SSL broker |
| `TLS_CA_CERT` | `/certs/ca.crt` | Path to CA certificate for TLS broker |

---

## Seeded dashboards

`docker/dev/config.json` seeds three dashboards covering all 12 panel types against the topics above:

- **Showcase · Monitors** — gauges (all three renderings), graphs (all three curves), stats, each group with a debug log of the exact messages it reads.
- **Showcase · Controls** — toggles, sliders, buttons, inputs and crons, all wired to the devices above, with debug logs showing commands out and the worker's replies.
- **Showcase · Layout** — text, separator and image, the panel types that never touch a broker.

Dashboards are only seeded when one of that name has **no panels**. To pick up edits to `config.json`, delete `backend/data/mqtt-dashboard.db` and restart the stack.

---

## Running Locally

To run the worker locally outside of Docker Compose:

```bash
cd docker/dev/worker
pip install -r requirements.txt

# Set local broker environment variables (pointing to localhost)
export BROKER_PLAIN_HOST=localhost
export BROKER_PASS_HOST=localhost
export BROKER_PASS_PORT=1884
export BROKER_TLS_HOST=localhost
export TLS_CA_CERT=../mosquitto/certs/ca.crt

python worker.py
```
