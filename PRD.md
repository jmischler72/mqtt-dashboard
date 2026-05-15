# Product Requirement Document (PRD)

## Project Name: mqtt-dashboard

**Subtitle:** Self-Hosted Extensible MQTT Dashboard Engine

**Version:** 1.1

---

## 1. Executive Summary & Vision

**mqtt-dashboard** is a self-hosted, lightweight developer utility designed to monitor, interact with, and automate MQTT workflows. Moving away from purely client-side tools, mqtt-dashboard features a compiled Go backend coupled with an extensible React dashboard.

The goal is to allow IoT developers to construct personalized control centers using a draggable, resizable layout engine, define autonomous backend automation jobs (cron jobs), and review historical layout environments seamlessly from a unified, single-binary application.

---

## 2. Technical Stack & Architecture

mqtt-dashboard uses a split-development, unified-production architecture model.

| Layer | Technology | Purpose |
| --- | --- | --- |
| **Frontend Framework** | React (Vite Ecosystem) | Component modularity, rich state engine. |
| **Styling & UI Components** | Tailwind CSS + DaisyUI | Rapid utility-first styling and themeable, accessible UI controls. |
| **Grid Engine** | `react-grid-layout` | Drag-and-drop dashboard widget management. |
| **Backend Core** | Go (Golang) | Multi-threaded networking, fast compilation, zero-dependency binary generation. |
| **Database Engine** | SQLite | Embedded, file-based persistence for connection profiles and widget coordinates. |
| **Scheduling Engine** | `go-co-op/gocron` | Native backend execution of time-targeted MQTT payloads. |
| **Dev Tooling** | `air` | Hot-reloading environment for Go source files. |

```
[React App (Port: 5173 Dev)]  ───(Proxy /api & /ws)───► [Go Backend (Port: 8080)]
                                                              │
                                            ┌─────────────────┴─────────────────┐
                                            ▼                                   ▼
                                     [SQLite Database]                [Mosquitto Broker]
                                     (Layouts & Configs)               (Port: 1883 / 9001)

```

---

## 3. Functional Specifications

### 3.1. Configuration Page (MQTT Setup)

The user defines connection credentials. Because the system runs a persistent backend, configuration changes trigger connection lifecycle events directly in the Go application runtime.

* **Input Fields:**
* Broker Hostname / IP Address
* Port (e.g., `1883` for TCP, `9001` for WebSockets)
* Client ID (with custom over-ride option)
* Authentication: Username and Password toggles.


* **State Control:**
* "Save & Connect" button commits properties to the SQLite database and initializes the backend connection pool.
* Live connection status indicators: `CONNECTED`, `DISCONNECTED`, `CONNECTING`, or `ERROR` reflected in the UI header.



### 3.2. Dashboard Page & Grid System

The main workspace where panels are organized using a fluid, responsive, component-driven configuration.

* **Layout Manipulation:** Powered by `react-grid-layout`. Users can move, scale, stretch, and shrink elements.
* **Grid Lock:** A global toggle interface lets users transition between "Edit/Design Mode" (resizable/draggable) and "Live View Mode" (layout positions frozen).
* **Persistent Coordinates:** Any change to a panel's width, height, X position, or Y position dynamically sends a payload to the Go backend to update the SQLite schema instantly.

### 3.3. Core Panel Specifications

Every panel uses a structural wrapper. The header includes a **Title field**, a **Configuration Gear Icon** (which triggers a panel-specific modal setup), and a **Delete Control**.

#### A. Button Panel

* **UI:** A DaisyUI button component centered within the layout frame.
* **Configuration Modal:** Editable custom label text, target MQTT topic, and payload (String or JSON raw text).
* **Action:** Clicking the button makes an asynchronous HTTP POST request to the Go API, prompting the backend to publish the defined payload immediately.

#### B. Input Panel

* **UI:** A text box/JSON window alongside a "Publish" icon.
* **Configuration Modal:** Pre-set target destination topic and variable input validation strings.
* **Action:** The user types an ad-hoc message inside the live card and submits it, sending the target input payload downstream to the broker via the Go publisher wrapper.

#### C. Log Panel

* **UI:** A terminal-style scroll container rendering message arrays chronologically.
* **Configuration Modal:** Subscription topic string tracker (supports multi-topic parsing and wildcards like `sensors/#`). Max message limit parameter to restrict memory leaks.
* **Action:** Go handles the raw subscription background stream, pushing structured text chunks over a single WebSocket connection to populate the React view layer instantly. Features "Clear" and "Pause Stream" options.

#### D. Cron Panel

* **UI:** Display card highlighting the active job title, current rule properties, absolute countdown tracking next execution timestamp, and an Enable/Disable slider switch.
* **Configuration Modal:** Target topic, string/JSON payload payload, and an integrated **Visual Cron Builder helper** (abstracting the complex 5-field asterisk logic into standard human dropdown pickers like "Every hour", "Daily at X:XX", etc.).
* **Action:** Go intercepts the validated string, processes it through `gocron`, and schedules systemic messaging intervals completely un-reliant on active browser visibility.

---

## 4. Technical Specifications & Operations

### 4.1. Storage Schema (SQLite)

The application handles configuration data statefully using an embedded SQLite database managed by Go.

```sql
CREATE TABLE IF NOT EXISTS mqtt_configurations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    client_id TEXT,
    username TEXT,
    password TEXT,
    is_active BOOLEAN DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dashboard_layouts (
    id TEXT PRIMARY KEY, -- Unique layout/panel UUID
    title TEXT NOT NULL,
    panel_type TEXT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    w INTEGER NOT NULL,
    h INTEGER NOT NULL,
    config_json TEXT -- Serialized panel configurations (topics, custom strings, payloads)
);

```

### 4.2. Dual-Environment Strategy

```
[Development Mode]
Vite Server (:5173) ──► (Proxy /api) ──► Go Server (:8080) ──► Disk Storage

[Production Mode]
Go Server Binary (:8080) ──► Internal Embedded Files (go:embed dist/)

```

#### Development Stage

* **React Runtime:** Run through the local Vite workflow (`localhost:5173`). Vite uses its internal reverse-proxy config block to transparently forward outbound traffic paths (`/api/*` and `/ws`) down to the Go engine address. This retains Hot Module Replacement (HMR) for frontend coding.
* **Go Runtime:** Monitored via the `air` binary watcher tool. Saves to backend system logic files trigger instantaneous recompiles and restart operations on the target port (`:8080`).

#### Production Stage

* The production asset build pipeline runs `npm run build` or `vite build`, dumping assets straight to a local distribution directory (`/dist`).
* The Go engine uses native `//go:embed dist/*` code metadata. Static distribution paths convert cleanly directly inside the primary binary file structure.
* The single compiled execution file safely handles asset delivery, API data extraction, and websocket routing from a singular open network port (`:8080`).

---

## 5. DevOps & Container Configuration

mqtt-dashboard runs isolated components containerized using standard recipes. The default infrastructure couples the program package with an adjacent operational Mosquitto network stack instance.

### 5.1. Docker Compose Structure (`docker-compose.yml`)

```yaml
services:
  mqtt-dashboard-app:
    build:
      context: .
      dockerfile: Dockerfile.dev
    ports:
      - "8080:8080"
    volumes:
      - .:/app
    environment:
      - APP_ENV=development
    depends_on:
      - mosquitto

  mosquitto:
    image: eclipse-mosquitto:2
    ports:
      - "1883:1883"
      - "9001:9001"
    volumes:
      - ./mosquitto/config/mosquitto.conf:/mosquitto/config/mosquitto.conf
      - ./mosquitto/data:/mosquitto/data
      - ./mosquitto/log:/mosquitto/log

```

### 5.2. Local Broker Override Setup (`mosquitto.conf`)

To accommodate native validation targets, the bundled broker context must actively handle internal network loops securely:

```ini
listener 1883
allow_anonymous true

listener 9001
protocol websockets
allow_anonymous true

```