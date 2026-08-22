# Docker Deployment Configurations

This directory contains ready-to-use Docker Compose setups for **MQTT Dashboard**.

## Available Configurations

### 1. All-in-One with Integrated Mosquitto Broker (`docker-compose.with-broker.yml`)

Starts **MQTT Dashboard** and an **Eclipse Mosquitto (v2)** broker together. Pre-configures the connection automatically via `config.json`.

```bash
docker compose -f docker/doc/docker-compose.with-broker.yml up -d
```

- **MQTT Dashboard**: [http://localhost:8080](http://localhost:8080)
- **MQTT Broker**: `localhost:1883` (from host) or `mosquitto:1883` (within container network)
- **WebSocket MQTT**: `localhost:9001`

### 2. Standalone Dashboard (`docker-compose.yml`)

Starts **MQTT Dashboard** on its own, allowing you to connect to an existing broker already running on your network.

```bash
docker compose -f docker/doc/docker-compose.yml up -d
```

- **MQTT Dashboard**: [http://localhost:8080](http://localhost:8080)
