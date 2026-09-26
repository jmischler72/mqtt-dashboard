<p align="center">
  <img src="frontend/public/logo.svg" width="90" alt="MQTT Dashboard Logo" />
</p>

<h1 align="center">MQTT Dashboard</h1>

<p align="center">
  <strong>The lightweight, self-hosted MQTT dashboard & topic explorer for IoT developers.</strong><br>
  Single binary • Embedded SQLite • Zero external dependencies
</p>

<p align="center">
  <a href="https://mqtt-dashboard.apps.joff.sh" target="_blank" rel="noopener noreferrer">
    <img src="https://img.shields.io/badge/🚀_Live_Demo-mqtt--dashboard.apps.joff.sh-00b4d8?style=for-the-badge" alt="Live Demo" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/jmischler72/mqtt-dashboard/stargazers"><img src="https://img.shields.io/github/stars/jmischler72/mqtt-dashboard?style=flat-square&logo=github&color=gold" alt="GitHub Stars"></a>
  <a href="https://github.com/jmischler72/mqtt-dashboard/releases"><img src="https://img.shields.io/github/v/release/jmischler72/mqtt-dashboard?style=flat-square" alt="GitHub Release"></a>
  <a href="https://github.com/jmischler72/mqtt-dashboard/pkgs/container/mqtt-dashboard"><img src="https://img.shields.io/badge/docker-ghcr.io-blue?style=flat-square&logo=docker" alt="Docker Image"></a>
  <a href="https://github.com/jmischler72/mqtt-dashboard/blob/main/LICENSE.txt"><img src="https://img.shields.io/github/license/jmischler72/mqtt-dashboard?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <img src="assets/dashboard-page.png" alt="MQTT Dashboard Screenshot" width="49%" />
  <img src="assets/explorer-page.png" alt="MQTT Explorer Screenshot" width="49%" />
</p>

---

## ⚡ Why MQTT Dashboard?

Existing tools are either **purely ephemeral topic viewers** (where configurations vanish between sessions) or **heavyweight platforms** (Grafana, Home Assistant) requiring separate databases and complex setups.

**MQTT Dashboard** combines the best of both worlds:

- 🌲 **Explore & Inspect**: Collapsible MQTT topic trees, wildcard subscriptions (`+`, `#`), live numeric graphs, and searchable SQLite history.
- 🎛️ **Monitor & Control**: Drag-and-drop customizable dashboards with Gauges, Toggles, Sliders, Real-time Logs, Inputs, and Buttons.
- 🔄 **Bidirectional Payload Shaping**: Automatically extract nested JSON fields (`telemetry.temp`), match textual stencils (`temp={value}`), or publish formatted templates with `{value}` chips.
- ⏰ **Automated Cron Jobs**: Schedule recurring publishes or sensor polling routines directly from dashboard panels.
- 🔒 **Production Security**: Connect to multiple brokers concurrently over plain TCP, TLS/SSL, or mutual TLS (client certificate & key).
- 📦 **Zero-Config Deployment**: Single self-contained Go binary with embedded SQLite and React UI. No external database or Redis needed.

> 🚀 **[Try the Live Demo without installing](https://mqtt-dashboard.apps.joff.sh)**

---

## 🚀 Quick Start

### Option A: Already have an MQTT broker? (Standalone)

Run the lightweight container and connect to your broker via the web UI:

```bash
docker run -d \
  --name mqtt-dashboard \
  --restart unless-stopped \
  -p 8080:8080 \
  -v mqtt_data:/app/data \
  ghcr.io/jmischler72/mqtt-dashboard:latest
```

*(Or run `docker compose -f docker/doc/docker-compose.yml up -d`)*

Open **[http://localhost:8080](http://localhost:8080)** and start building!

---

### Option B: Need an all-in-one test stack? (Dashboard + Mosquitto)

If you don't have a broker running locally, launch the complete stack with an integrated **Eclipse Mosquitto** broker in one command:

```bash
git clone https://github.com/jmischler72/mqtt-dashboard.git
cd mqtt-dashboard
docker compose -f docker/doc/docker-compose.with-broker.yml up -d
```

- **Dashboard UI**: [http://localhost:8080](http://localhost:8080) (pre-configured)
- **Mosquitto Broker**: `localhost:1883`

<details>
<summary><strong>💪 Option: Build from Source</strong></summary>

Requirements: Go 1.26+, Node.js 22+

```bash
git clone https://github.com/jmischler72/mqtt-dashboard.git
cd mqtt-dashboard

# Build frontend
cd frontend && npm ci && npm run build && cd ..

# Build backend (embeds frontend into a single standalone binary)
cd backend
cp -r ../frontend/dist ./dist
go build -o mqtt-dashboard .
./mqtt-dashboard
```
</details>

### Runtime configuration

The server defaults to `:8080`, serves from `/`, and stores its data in
`./data`. These defaults preserve the Docker and standalone behaviour above.

For a native deployment, set `MQTT_DASHBOARD_CONFIG` to a TOML file. Values
are resolved in this order: built-in defaults, TOML, then environment
variables.

```toml
# /etc/mqtt-dashboard/config.toml
[server]
http_addr = "127.0.0.1:8080"
base_path = "/mqtt-dashboard/"

[storage]
data_dir = "/var/lib/mqtt-dashboard"

[logging]
level = "info"

[seed]
config_file = "/etc/mqtt-dashboard/config.json"
```

The supported environment overrides are:

| Variable | Description |
| --- | --- |
| `MQTT_DASHBOARD_CONFIG` | Optional TOML runtime configuration file |
| `MQTT_DASHBOARD_HTTP_ADDR` | HTTP listen address, for example `127.0.0.1:8080` |
| `MQTT_DASHBOARD_BASE_PATH` | Mount path, `/` or a path such as `/mqtt-dashboard/` |
| `MQTT_DASHBOARD_DATA_DIR` | Directory containing the SQLite database and uploaded images |
| `MQTT_DASHBOARD_CONFIG_FILE` | JSON file used to seed brokers, settings, and dashboards |
| `MQTT_DASHBOARD_LOG_LEVEL` | Go `slog` log level |

`CONFIG_FILE` and `LOG_LEVEL` remain supported as aliases for existing
deployments. The legacy `CONFIG_FILE` JSON is for initial application data;
changes made in the UI are persisted to SQLite rather than written back to the
JSON file.

When using a sub-path behind a reverse proxy, preserve that path while
forwarding requests:

```apache
ProxyPass        /mqtt-dashboard/ http://127.0.0.1:8080/mqtt-dashboard/
ProxyPassReverse /mqtt-dashboard/ http://127.0.0.1:8080/mqtt-dashboard/
```

The frontend uses relative asset URLs and receives its document base from the
server, so the same binary can serve either `/` or a configured base path.

---

## 🎛️ Dashboard Panels

| Panel | Type | Description |
|---|---|---|
| **Gauge** | Monitor | Radial, bar, or numeric display with nested JSON path extraction (`data.temp`) |
| **Graph** | Monitor | Live time-series charts plotted from message history with wildcard multi-series |
| **Log** | Monitor | Live streaming message feed with persistent history, QoS badges, and date formatting |
| **Broker Stats** | Monitor | Live broker telemetry, memory usage, client counts, and `$SYS` metrics |
| **Toggle** | Control | On/off switch with separate read/write shapes (Zigbee2MQTT, Tasmota, Shelly) |
| **Slider** | Control | Range slider for brightness, setpoints, or volume with value interpolation |
| **Button** | Control | One-click message publish with optional confirmation modal |
| **Input** | Control | Interactive text input to publish ad-hoc payloads to any topic |
| **Cron** | Automation | Scheduled recurring publisher with visual schedule builder and countdown |
| **Image / Markdown / Separator** | Visual | Static assets, rich documentation cards, and layout organization dividers |

---

## 🏗️ Architecture

```
┌──────────────────────────┐         ┌──────────────────────┐
│   React Frontend (SPA)   │◄──WS──► │    Go Backend        │
│   Vite + Tailwind CSS +  │◄──API─► │    Single Binary     │
│   DaisyUI                │         │    (Chi Router)      │
└──────────────────────────┘         └──────────┬───────────┘
                                                │
                                     ┌──────────┴───────────┐
                                     │                      │
                              ┌──────▼──────┐    ┌──────────▼──────────┐
                              │   SQLite    │    │  MQTT Brokers (N)   │
                              │  (layouts,  │    │  TCP / TLS / Auth   │
                              │   configs,  │    └─────────────────────┘
                              │   history)  │
                              └─────────────┘
```

The Go binary serves the embedded React build directly, routing REST API calls, WebSocket streams, and MQTT client connections from a single port (`:8080`).

---

## 📚 Documentation

Deep-dive architecture and development guides are available in the [`docs/`](docs/) directory:

- 📘 **[Payload Shaping & Template Guide](docs/payload-shaping.md)** — Dynamic value extraction, loose JSON parsing, and device examples (Zigbee2MQTT, Tasmota, Shelly).
- 🛠️ **[Panel Architecture & Developer Guide](docs/panel-development-guide.md)** — Anatomy of `PanelDefinition`, UI primitives, validation rules, and step-by-step panel creation tutorial.
- ⚙️ **[Configuration Seeding & GitOps](docs/configuration-seeding.md)** — Declarative `config.json` schema, broker auto-provisioning, TLS certificates, and Kubernetes GitOps setups.
- ⏰ **[Automations & Cron Engine](docs/automations-and-scheduler.md)** — In-memory scheduling with `gocron v2`, origin attribution, toggle APIs, and retention pruning.
- 🔌 **[WebSocket Protocol Specification](docs/websocket-protocol.md)** — Wire protocol frames, topic subscription multiplexing, and client backpressure.
- 🔐 **[Authentication & TLS Guide](docs/auth-and-tls.md)** — Plain TCP, TLS/SSL, mutual TLS (mTLS), and local test broker matrices.
- 🏗️ **[Backend Broker Workflow](docs/backend-broker-workflow.md)** & **[Publish Correlation Engine](docs/publish-correlation-engine.md)** — Concurrency and message origin attribution.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, DaisyUI v5, react-grid-layout
- **Backend**: Go 1.26, Chi Router, Eclipse Paho MQTT
- **Database**: SQLite (pure Go via `modernc.org/sqlite`, WAL mode)
- **Scheduling & Realtime**: `gocron v2`, Gorilla WebSocket
- **Deployment**: Single binary, Alpine Docker container (`ghcr.io/jmischler72/mqtt-dashboard`)

---

## 📄 License

Distributed under the [GPL-3.0 License](LICENSE.txt).

If you find MQTT Dashboard useful, **please consider giving it a ⭐ on GitHub!**
