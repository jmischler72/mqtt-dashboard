<p align="center">
  <img src="frontend/public/logo.svg" width="100" alt="MQTT Dashboard Logo" />
</p>

<h1 align="center">MQTT Dashboard</h1>

<p align="center">
  <em>A self-hostable MQTT dashboard/explorer for IoT developers.</em>
</p>

<p align="center">
  <a href="https://github.com/jmischler72/mqtt-dashboard/releases"><img src="https://img.shields.io/github/v/release/jmischler72/mqtt-dashboard?style=flat-square" alt="GitHub Release"></a>
  <a href="https://github.com/jmischler72/mqtt-dashboard/pkgs/container/mqtt-dashboard"><img src="https://img.shields.io/badge/docker-ghcr.io-blue?style=flat-square&logo=docker" alt="Docker Image"></a>
  <a href="https://github.com/jmischler72/mqtt-dashboard/blob/main/LICENSE.txt"><img src="https://img.shields.io/github/license/jmischler72/mqtt-dashboard?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <img src="assets/dashboard-page.png" alt="MQTT Dashboard Screenshot" width="49%" />
  <img src="assets/explorer-page.png" alt="MQTT Explorer Screenshot" width="49%" />
</p>

---

## ⭐ Features

- **Drag & Drop Dashboard** — Build your own control center with resizable, draggable panels using a responsive grid layout engine
- **Multi-Dashboard Support** — Create multiple dashboard tabs, rename, delete, and import/export dashboards as JSON files with starter templates
- **Functional & Visual Panels** — Button (with confirmation option), Input, Log, Cron, Broker Stats, Image (URL or upload), Separator, and Markdown Text panels
- **Topic Explorer + Wildcards** — Browse collapsible MQTT topic trees, inspect message history, navigate with breadcrumbs, and subscribe with `+` and `#` patterns
- **Message History & Retention** — Persistent history in SQLite with configurable retention periods, manual cleanup controls, and automated background pruning
- **Multi-Broker Management** — Connect to multiple MQTT brokers concurrently, reorder priority, and monitor live telemetry & `$SYS` metrics
- **TLS & Authentication** — Supports plain TCP, TLS/SSL (with CA cert upload or skip-verify), username/password, and mutual TLS (client certificate & key)
- **Real-Time Updates** — WebSocket-powered live streaming for message history, explorer updates, and dashboard panels
- **Single Binary & Docker Ready** — Go backend with embedded React frontend, zero runtime external dependencies, and ready-to-use Docker images

---

## 🔧 How to Install

### 🐳 Option 1: Docker Compose Standalone (Recommended)

If you already have an MQTT broker running on your network (or want to configure brokers via the web UI), this requires **no extra configuration files**:

```yaml
services:
  mqtt-dashboard:
    image: ghcr.io/jmischler72/mqtt-dashboard:latest
    container_name: mqtt-dashboard
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - data_volume:/app/data

volumes:
  data_volume:
```

```bash
docker compose -f docker/doc/docker-compose.yml up -d
# or save as docker-compose.yml and run: docker compose up -d
```

MQTT Dashboard is now running at [http://localhost:8080](http://localhost:8080).

---

### 🐳 Option 2: Docker Compose with Integrated Broker (All-in-One)

If you do not have an MQTT broker and want an all-in-one stack with a pre-configured **Eclipse Mosquitto** broker:

#### ⚡ Quick Start (from cloned repository)

The [`docker/doc/`](docker/doc/) directory contains all required files (`docker-compose.with-broker.yml`, `config.json`, `mosquitto.conf`):

```bash
git clone https://github.com/jmischler72/mqtt-dashboard.git
cd mqtt-dashboard
docker compose -f docker/doc/docker-compose.with-broker.yml up -d
```

- **MQTT Dashboard**: [http://localhost:8080](http://localhost:8080) (pre-configured with `Local Mosquitto`)
- **MQTT Broker**: `localhost:1883` (from host) or `mosquitto:1883` (within Docker network)

### 🐳 Docker Command

```bash
docker run -d \
  --restart=always \
  -p 8080:8080 \
  -v mqtt-dashboard-data:/app/data \
  --name mqtt-dashboard \
  ghcr.io/jmischler72/mqtt-dashboard:latest
```

### 💪 Build from Source

Requirements: Go 1.26+, Node.js 22+

```bash
git clone https://github.com/jmischler72/mqtt-dashboard.git
cd mqtt-dashboard

# Build frontend
cd frontend && npm ci && npm run build && cd ..

# Build backend (embeds frontend)
cd backend
cp -r ../frontend/dist ./dist
go build -o mqtt-dashboard .
./mqtt-dashboard
```

---

## 🖼️ Panel Types

### Functional panels

| Panel | Description |
| ----- | ----------- |
| **Gauge** | Real-time telemetry gauge (radial, bar, value) for numeric, boolean, or string data, with nested JSON path extraction |
| **Button** | One-click publish a preset payload to a topic with QoS, Retain, and optional confirmation modal |
| **Input** | Type and send ad-hoc messages to any topic with configurable QoS and Retain flags |
| **Toggle** | Switch a device on/off and reflect its real state from a command or separate telemetry topic, with configurable on/off payloads |
| **Log** | Real-time message stream with persistent history, wildcards, QoS/Retain badges, and date formatting |
| **Cron** | Scheduled automatic publishing with visual cron builder helper, next-run countdown, and toggle switch |
| **Stats** | Live broker statistics and message activity charts ($SYS telemetry, memory, client counts) |

### Visual panels

| Panel | Description |
| ----- | ----------- |
| **Image** | Display images from a URL or upload custom images/presets directly to the dashboard |
| **Separator** | Horizontal or vertical separator to visually structure your dashboard grid |
| **Text** | Rich Markdown text panel for documentation, notes, or section titles |

---

## 🔐 MQTT Security & Protocol Support

MQTT Dashboard supports comprehensive MQTT protocol and security features:

- **TLS/SSL** encryption for broker communication
- **Username & Password** authentication
- **Client Certificate** authentication (mTLS) with custom CA, client cert, and private key
- **QoS (0, 1, 2)** Quality of Service levels for publishing and subscriptions
- **Retain flag** to ensure latest state is preserved for new subscribers
- **$SYS Topics** monitoring and optional retention recording
- **Initial Configuration Seeding** via `CONFIG_FILE` or `config.json`

For detailed security setup and dev broker configurations, see [docs/auth-and-tls.md](docs/auth-and-tls.md).

---

## 🏗️ Architecture

```
┌──────────────────────────┐         ┌──────────────────────┐
│   React Frontend (SPA)   │◄──WS──► │    Go Backend        │
│   Vite + Tailwind +      │◄──API─► │    Single Binary     │
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

In production, the Go binary serves the embedded React build directly, routing API calls, WebSocket streams, and MQTT client connections from a single port (`:8080`).

---

## 💡 Motivation

Existing MQTT tools are either purely client-side, lack persistence, or don't support building custom control interfaces. MQTT Dashboard combines the best of monitoring tools like MQTT Explorer with the flexibility of a customizable panel-based dashboard — all self-hosted in a single binary.

Inspired by [MQTT-Explorer](https://github.com/thomasnordquist/MQTT-Explorer).

If you find this project useful, please consider giving it a ⭐!

---

## 🗺️ Roadmap

- [ ] Allow users to create custom panels and share them
- [ ] More customisable options in base panels

See [TODO.md](TODO.md) and [docs/PRD/](docs/PRD/) for full details.

---

## 🛠️ Tech Stack

| Layer | Technology |
| ----- | ---------- |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4, DaisyUI v5 |
| Grid Engine | react-grid-layout, @dnd-kit |
| Backend | Go (Golang 1.26) |
| Router | go-chi/chi v5 |
| MQTT lib | Eclipse paho.mqtt.golang |
| Database | SQLite (embedded via modernc.org/sqlite, pure Go) |
| Scheduling | gocron v2 |
| Realtime | Gorilla WebSocket |
| Container | Docker (Alpine) |

---

## 📄 License

[GPL-3.0](LICENSE.txt)
