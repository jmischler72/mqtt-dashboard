# Configuration & Seeding Guide

This guide covers everything you need to know about configuring MQTT Dashboard, from host environment variables and native TOML configuration to declarative GitOps database seeding.

---

## Two Tiers of Configuration

MQTT Dashboard separates **Server Runtime Configuration** (infrastructure) from **Application Seeding** (initial database state):

| Layer | Responsibility | Mechanism | Format | Lifecycle |
|---|---|---|---|---|
| **Tier 1: Server Runtime** | Listen address, mount path, data directory, log level | Environment variables or `config.toml` | Key-value / TOML | Evaluated on every process launch. Changes take effect upon restart. |
| **Tier 2: Initial Application Seed** | Initial brokers, credentials, TLS certificates, dashboards & panels | `MQTT_DASHBOARD_SEED_FILE` or `[seed] file` in TOML | Structured JSON (`seed.json`) | Injected into SQLite on first startup or additive merge. Runtime user edits are saved directly to SQLite. |

This separation ensures that complex dashboard structures (nested grids, JSON payload configs) remain in natural JSON format, while server process parameters remain lightweight and standard across Docker and native environments.

---

## Tier 1: Server Runtime Configuration

The Go binary runs with sensible defaults out of the box (`:8080`, `/`, `./data`, `info`). For Docker deployments, environment variables are recommended. For native systemd installations, a TOML configuration file can be used.

### Precedence Order

Configuration values are resolved in the following priority:
1. **Built-in defaults** (used when nothing is specified)
2. **TOML configuration file** (specified via `MQTT_DASHBOARD_CONFIG`)
3. **Environment variables** (highest precedence, overrides TOML values)

### Configuration Reference

| Environment Variable | TOML Key (`config.toml`) | Default | Description |
|---|---|---|---|
| `MQTT_DASHBOARD_HTTP_ADDR` | `server.http_addr` | `:8080` | Listen host and port (e.g. `:8080` or `127.0.0.1:8080`) |
| `MQTT_DASHBOARD_BASE_PATH` | `server.base_path` | `/` | Application mount path (e.g. `/` or `/mqtt-dashboard/`) |
| `MQTT_DASHBOARD_DATA_DIR` | `storage.data_dir` | `./data` | Directory where SQLite database and images are stored |
| `MQTT_DASHBOARD_LOG_LEVEL` | `logging.level` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `MQTT_DASHBOARD_SEED_FILE` | `seed.file` | _None_ | Path to `seed.json` file for pre-populating data |
| `MQTT_DASHBOARD_CONFIG` | _N/A_ | _None_ | Path to an optional TOML configuration file |

> [!NOTE]
> `base_path` must start and end with `/` (e.g., `/mqtt-dashboard/`). When running behind a reverse proxy sub-path, ensure the reverse proxy preserves this path. See the [Native & Reverse-Proxy Deployment Guide](alternative-deployments.md) for complete Apache and systemd recipes.

### TOML Configuration File (`config.toml`)

An annotated example file is provided in the repository root as [`config.example.toml`](../config.example.toml):

```toml
[server]
http_addr = ":8080"
base_path = "/"

[storage]
data_dir = "./data"

[logging]
level = "info"

# Optional: seed initial brokers or dashboards on first boot
# [seed]
# file = "./seed.json"
```

To run the binary with a TOML configuration:

```bash
export MQTT_DASHBOARD_CONFIG="/path/to/config.toml"
./mqtt-dashboard
```

---

## Tier 2: Initial Application Seeding (`seed.json`)

While MQTT Dashboard allows full management of brokers, dashboards, and settings via its web UI, production and homelab deployments often require **declarative, repeatable provisioning**.

Using declarative configuration seeding:
- Pre-configured brokers, TLS certificates, and dashboard layouts can be injected automatically at startup.
- Deployments can run headlessly without manual browser interaction.
- Fleet deployments across multiple environments (staging, production, edge nodes) can be managed via GitOps repositories.

### Seed File Schema Specification

The seed file can be provided either as an **object** (defining brokers, settings, and dashboards) or as a **flat array** of brokers. It is loaded from the path specified by the `MQTT_DASHBOARD_SEED_FILE` environment variable, or via the `[seed] file` parameter in the TOML runtime configuration.

A starter template is provided in the repository root as [`seed.example.json`](../seed.example.json).

```
                    Startup Configuration Pipeline
                     (backend/config/config.go)
                                 |
                                 v
             [ MQTT_DASHBOARD_SEED_FILE / [seed] file ]
                                 |
         +-----------------------+-----------------------+
         |                       |                       |
         v                       v                       v
    [ brokers ]             [ settings ]           [ dashboards ]
         |                       |                       |
   Deduplicated by          Updated on id=1         Deduplicated by
  name / (host:port)     (retention, $SYS)           dashboard name
         |                       |                       |
         +-----------------------+-----------------------+
                                 |
                                 v
                       SQLite Database File
```

### Complete Schema Example

```json
{
  "settings": {
    "retention_period_hours": 48,
    "save_sys_topics": false
  },
  "brokers": [
    {
      "id": "mosquitto-prod",
      "name": "Production Mosquitto",
      "host": "mosquitto.internal",
      "port": 8883,
      "client_id": "mqttdash-prod",
      "is_enabled": true,
      "auth_mode": "certificate",
      "tls_enabled": true,
      "tls_skip_verify": false,
      "ca_cert_file": "/app/certs/ca.crt",
      "client_cert_file": "/app/certs/client.crt",
      "client_key_file": "/app/certs/client.key"
    },
    {
      "name": "Local Development",
      "host": "127.0.0.1",
      "port": 1883,
      "auth_mode": "password",
      "username": "iot_user",
      "password": "secret_password",
      "is_enabled": true,
      "tls_enabled": false
    }
  ],
  "dashboards": [
    {
      "name": "Main Dashboard",
      "panels": [
        {
          "title": "Living Room Temp",
          "panel_type": "gauge",
          "x": 0,
          "y": 0,
          "w": 4,
          "h": 4,
          "broker_name": "Production Mosquitto",
          "config_json": {
            "topic": "tele/living_room/sensor",
            "payloadTemplate": "{\"temp\": {value}}",
            "min": 10,
            "max": 35,
            "unit": "°C"
          }
        }
      ]
    }
  ]
}
```

---

## Schema Reference

### 1. `settings` Object

| Field | Type | Default | Description |
|---|---|---|---|
| `retention_period_hours` | integer | `24` | Hours of message history retained in SQLite before background pruning deletes them. |
| `save_sys_topics` | boolean | `false` | Whether `$SYS/#` broker telemetry messages should be stored in `mqtt_history`. |

### 2. `brokers` Array

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | string | Auto UUID | Optional unique ID. Auto-generated if omitted. |
| `name` | string | `Broker <n>` | Human-readable name displayed in the UI. |
| `host` | string | **Required** | Hostname or IP address of the MQTT broker. |
| `port` | integer | `1883` | Network port (typically `1883` for TCP, `8883` for TLS). |
| `client_id` | string | Auto UUID | MQTT client identifier passed to the broker. |
| `is_enabled` | boolean | `true` | Whether the backend connects to this broker on startup. |
| `sort_order` | integer | Index order | Display order in the UI. Lowest order becomes the default broker. |
| `auth_mode` | string | Auto | `"none"`, `"password"`, or `"certificate"`. Auto-detected if omitted based on credentials. |
| `username` | string | `""` | MQTT username for `password` auth mode. |
| `password` | string | `""` | MQTT password for `password` auth mode. |
| `tls_enabled` | boolean | `false` | Enables TLS/SSL encryption. |
| `tls_skip_verify` | boolean | `false` | Skips TLS certificate verification (insecure, useful for self-signed testing). |
| `ca_cert` / `ca_cert_file` | string | `""` | Root CA certificate. May be an inline PEM string (`-----BEGIN CERTIFICATE...`) or file path. |
| `client_cert` / `client_cert_file` | string | `""` | Client public certificate (for mutual TLS). Inline PEM or file path. |
| `client_key` / `client_key_file` | string | `""` | Client private key (for mutual TLS). Inline PEM or file path. |

> [!NOTE]
> Relative certificate paths are resolved relative to the directory containing the seed file. If an inline string begins with `-----BEGIN `, it is parsed directly as raw PEM bytes without attempting disk lookup.

### 3. `dashboards` Array

| Field | Type | Description |
|---|---|---|
| `name` | string | Name of the dashboard tab (e.g. `"Default"`, `"Sensors"`). |
| `panels` | array | Array of layout panel items. |

#### Panel Object Properties:
- **`title`** (`string`): Header title of the panel.
- **`panel_type`** (`string`): Panel type (`gauge`, `button`, `input`, `log`, `cron`, `broker_stats`, `markdown`, `separator`, `image`, `toggle`, `slider`, `graph`).
- **`x`**, **`y`**, **`w`**, **`h`** (`integer`): Grid coordinate and dimension units.
- **`broker_name`** or **`broker_id`** (`string`): Target broker binding. Resolved against seeded brokers.
- **`config_json`** (`object`): JSON configuration specific to that panel type.

---

## Seeding Lifecycle & Idempotency

Implemented in [`backend/config/config.go`](../backend/config/config.go), seeding runs on backend boot via `SeedBrokersFromConfig(db)`:

1. **Initial Boot (Fresh Database)**:
   - Brokers defined in `seed.json` are inserted into `mqtt_brokers`.
   - Settings are updated on `app_settings` (row `id = 1`).
   - Dashboards and their panel layouts are inserted into `dashboards` and `dashboard_layouts`.
2. **Subsequent Restarts (Persistent Database)**:
   - **Brokers**: Checked against existing rows using `WHERE name = ? OR (host = ? AND port = ?)`. If already present, insertion is safely skipped, preserving user-edited broker states.
   - **Settings**: Declarative settings in `seed.json` will update `app_settings` on restart.
   - **Dashboards**: Dashboards with existing names are retained. If an existing dashboard already has panels, panel re-seeding is skipped to avoid overriding user customizations made via the UI.

---

## Deployment Guidelines

### 🐳 Docker Compose (Headless Setup)

Mount a seed file and optional certificates into `/app/data/`:

```yaml
services:
  mqtt-dashboard:
    image: ghcr.io/jmischler72/mqtt-dashboard:latest
    container_name: mqtt-dashboard
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - MQTT_DASHBOARD_SEED_FILE=/app/config/seed.json
    volumes:
      - ./seed.json:/app/config/seed.json:ro
      - ./certs:/app/certs:ro
      - mqtt_dash_data:/app/data

volumes:
  mqtt_dash_data:
```

### ☸️ Kubernetes GitOps (ConfigMaps & Secrets)

In Kubernetes setups managed by ArgoCD or Flux, store seed configuration in a `ConfigMap` and TLS certificates in a `Secret`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mqtt-dashboard-seed
data:
  seed.json: |
    {
      "settings": {
        "retention_period_hours": 72
      },
      "brokers": [
        {
          "name": "Cluster Mosquitto",
          "host": "mosquitto.mqtt.svc.cluster.local",
          "port": 8883,
          "tls_enabled": true,
          "ca_cert_file": "/etc/ssl/certs/ca.crt",
          "client_cert_file": "/etc/ssl/certs/tls.crt",
          "client_key_file": "/etc/ssl/certs/tls.key"
        }
      ]
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mqtt-dashboard
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: app
          image: ghcr.io/jmischler72/mqtt-dashboard:latest
          env:
            - name: MQTT_DASHBOARD_SEED_FILE
              value: /etc/mqtt-dashboard/seed.json
          ports:
            - containerPort: 8080
          volumeMounts:
            - name: seed-volume
              mountPath: /etc/mqtt-dashboard
            - name: tls-secret-volume
              mountPath: /etc/ssl/certs
              readOnly: true
            - name: storage-volume
              mountPath: /app/data
      volumes:
        - name: seed-volume
          configMap:
            name: mqtt-dashboard-seed
        - name: tls-secret-volume
          secret:
            secretName: mosquitto-client-tls
        - name: storage-volume
          persistentVolumeClaim:
            claimName: mqtt-dashboard-pvc
```
