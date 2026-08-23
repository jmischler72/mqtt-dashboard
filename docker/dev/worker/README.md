# MQTT Worker

Test message publisher for MQTT Dashboard development and integration testing.

## Overview

The test worker is included in the development Docker Compose stack (`docker/dev/docker-compose-dev.yml`) to continuously publish realistic telemetry and test payloads to the three dev Mosquitto brokers (`mosquitto`, `mosquitto-password`, `mosquitto-tls`).

Two publishing profiles run concurrently:

- **IoT Simulator**: Generates realistic sensor telemetry (temperature, humidity, pressure, motion, light) on `sensors/<room>/<metric>` topics with JSON payloads containing timestamps and units.
- **Simple Payloads**: Incrementing counters, random numbers, and status strings on `test/<topic>` topics (e.g. `test/topic1`, `test/counter`, `test/status`).

Both profiles randomly assign QoS levels (0, 1, 2) and Retain flags to test broker and dashboard behavior.

---

## Environment Variables

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PUBLISH_INTERVAL` | `5` | Seconds between publish rounds |
| `BROKER_PLAIN_HOST` | `mosquitto` | Host for anonymous plain TCP broker |
| `BROKER_PLAIN_PORT` | `1883` | Port for anonymous plain TCP broker |
| `BROKER_PASS_HOST` | `mosquitto-password` | Host for password-authenticated broker |
| `BROKER_PASS_PORT` | `1883` | Port for password-authenticated broker |
| `BROKER_PASS_USER` | `testuser` | Username for password broker |
| `BROKER_PASS_PASS` | `testpass` | Password for password broker |
| `BROKER_TLS_HOST` | `mosquitto-tls` | Host for TLS/SSL broker |
| `BROKER_TLS_PORT` | `8883` | Port for TLS/SSL broker |
| `TLS_CA_CERT` | `/certs/ca.crt` | Path to CA certificate for TLS broker |

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

