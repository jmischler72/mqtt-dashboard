# Model Context Protocol (MCP) & AI Dashboard Generation

MQTT Dashboard includes a built-in **Model Context Protocol (MCP)** server. This allows AI assistants and coding agents (Claude Desktop, Cursor, Antigravity, OpenHands, Cline, etc.) to connect directly to your live MQTT environment, inspect active broker telemetry, and generate or manage dashboards automatically using natural language.

---

## ⚡ Why Use MCP with MQTT Dashboard?

Setting up IoT dashboards manually is often repetitive:
1. Watching MQTT topics in an explorer to understand JSON key names.
2. Manually calculating value scales, gauge thresholds, and unit symbols.
3. Adding panels one by one, typing topic filters and payload paths.
4. Aligning and resizing cards on a grid layout.

With the built-in MCP server, an AI assistant can perform this entire workflow in seconds:

```
┌─────────────────┐       ┌──────────────────────┐       ┌────────────────────────┐
│  Explore Topics │ ────► │ Inspect Raw Payloads │ ────► │ Auto-Generate Layout   │
│ (explore_topics)│       │(sample_topic_payload)│       │   (create_dashboard)   │
└─────────────────┘       └──────────────────────┘       └────────────────────────┘
         │                           │                                │
  Discovers active            Extracts nested JSON             Computes non-overlapping
  sensor & device topics      paths and value ranges           12-column grid placement
```

---

## 🚀 Quick Setup & Enabling MCP

The MCP server is disabled by default for security, but can be enabled via any of the following methods:

### 1. Web UI (Instant Toggle)
1. Open MQTT Dashboard in your browser and go to **Settings** (`/config`).
2. Scroll to the **MCP Server** card.
3. Toggle the switch to **Enabled**.
4. Click **Copy prompt to AI** to quickly copy `Add the MQTT Dashboard MCP server to your config: <url>`, or expand **Endpoints & Client Config** to view connection URLs and `mcp_config.json`.

### 2. Environment Variable
Enable MCP on container or binary startup:
```bash
MQTT_DASHBOARD_MCP_ENABLED=true ./mqtt-dashboard
```

Or in Docker Compose:
```yaml
environment:
  - MQTT_DASHBOARD_MCP_ENABLED=true
```

### 3. TOML Configuration (`config.toml`)
```toml
[mcp]
enabled = true
```

### 4. Stdio CLI Mode
Run the standalone binary in stdio mode without launching the web server (ideal for local agent wrappers):
```bash
./mqtt-dashboard mcp
# or: ./mqtt-dashboard --mcp-stdio
```

---

## 🔌 Supported Transports & Endpoints

When enabled, the server exposes standard MCP endpoints over HTTP and stdio:

| Transport | Endpoint / Command | Description |
|---|---|---|
| **Streamable HTTP** | `http://localhost:8080/mcp` | Modern MCP Streamable HTTP transport (recommended for remote & local agents) |
| **HTTP + SSE** | `http://localhost:8080/mcp/sse` & `/mcp/messages` | Server-Sent Events transport with separate message posting endpoint |
| **Stdio** | `./mqtt-dashboard mcp` | Line-delimited JSON-RPC over `stdin`/`stdout` |

---

## 🛠️ Client Configuration Examples

### Claude Desktop / Cursor / Antigravity / Windsurf

Add the following to your MCP client configuration file (e.g. `claude_desktop_config.json`, `.cursor/mcp.json`, or Antigravity MCP settings):

#### Streamable HTTP Transport (Recommended)
```json
{
  "mcpServers": {
    "mqtt-dashboard": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

#### HTTP + SSE Transport
```json
{
  "mcpServers": {
    "mqtt-dashboard": {
      "url": "http://localhost:8080/mcp/sse"
    }
  }
}
```

#### Stdio Mode (Direct Binary Execution)
```json
{
  "mcpServers": {
    "mqtt-dashboard": {
      "command": "/usr/local/bin/mqtt-dashboard",
      "args": ["mcp"],
      "env": {
        "MQTT_DASHBOARD_DATA_DIR": "/path/to/data"
      }
    }
  }
}
```

---

## 🧰 Exposed MCP Tools Reference

The server exposes 10 specialized tools covering broker inspection, payload sampling, panel schemas, and dashboard CRUD operations:

| Tool | Purpose | Key Arguments |
|---|---|---|
| **`list_brokers`** | List configured MQTT brokers, enabled status, host/port, and live connection health. | _None_ |
| **`explore_topics`** | Scan retained and active MQTT topics captured on a broker with message counts and recent sample payloads. | `broker_id` (opt), `filter` (opt, wildcard like `sensors/#`), `limit` |
| **`sample_topic_payload`** | Fetch recent messages for a specific topic or wildcard to inspect exact JSON structure, keys, and values. | `topic` (req), `broker_id` (opt), `limit` |
| **`get_panel_schema`** | Return complete specification for all 13 panel types, `{value}` shaping syntax, and 12-column grid layout rules. | `panel_type` (opt, e.g. `'gauge'`, `'toggle'`) |
| **`list_dashboards`** | List all existing dashboards with IDs, names, creation dates, and panel counts. | _None_ |
| **`get_dashboard`** | Export a dashboard's full layout, panel configurations, and portable JSON definition. | `dashboard_id` or `name` |
| **`create_dashboard`** | Create a complete new dashboard with validated panels, automatic broker binding, and automatic 12-col grid packing. | `name` (req), `panels` (req), `auto_layout` (opt, bool), `dry_run` (opt, bool) |
| **`update_dashboard`** | Modify an existing dashboard by appending new panels at the bottom or replacing all panels. | `dashboard_id` (req), `panels` (req), `mode` (`'append'` or `'replace'`), `auto_layout` |
| **`delete_dashboard`** | Delete a dashboard and clean up associated automations. | `dashboard_id` (req) |
| **`publish_message`** | Publish an MQTT message to test panels, trigger controls, or simulate sensor telemetry. | `topic` (req), `payload` (req), `broker_id` (opt), `qos`, `retain` |

---

## 💡 Example Prompts to Try with Your AI Assistant

Once connected, you can ask your AI assistant to generate, inspect, and optimize dashboards in plain English:

### 1. Full Auto-Generation from Live Telemetry
> *"Inspect my MQTT broker topics and build a complete Climate & Air Quality dashboard for all indoor sensors."*

**What the AI does:**
1. Calls `explore_topics(filter="sensors/#")` to discover active devices.
2. Calls `sample_topic_payload` on climate topics to see JSON keys (`temperature`, `humidity`, `co2`, `pm25`).
3. Calls `get_panel_schema` to verify gauge and graph configs.
4. Calls `create_dashboard(name="Indoor Climate", auto_layout=true, panels=[...])` with radial gauges for temperature and humidity, time-series graphs, and air quality badges.

---

### 2. Smart Home & Device Control Dashboard
> *"Find all smart plugs under `zigbee2mqtt/` and generate a power-monitoring dashboard with toggle switches and total wattage gauges."*

**What the AI does:**
1. Discovers plug topics such as `zigbee2mqtt/kitchen_plug` and `zigbee2mqtt/desk_plug`.
2. Inspects payload shapes to identify `state` (`"ON"`/`"OFF"`) and `power` (in Watts).
3. Creates a dashboard pairing interactive toggle switches with live power gauges and a multi-series graph.

---

### 3. Iterative Tuning & Panel Expansion
> *"On my 'Factory Floor' dashboard, add a real-time message log panel for `alerts/#` and an automation rule that warns when pressure exceeds 100 psi."*

**What the AI does:**
1. Retrieves the dashboard with `get_dashboard(name="Factory Floor")`.
2. Appends new log and logic automation panels using `update_dashboard(mode="append", auto_layout=true)`.

---

### 4. Simulating Hardware Telemetry
> *"Publish 5 test sensor readings to `sensors/greenhouse/temp` so I can see the gauge animate."*

**What the AI does:**
Calls `publish_message` with incrementing values: `{"temperature": 22.4, "humidity": 58}`.

---

## 📐 Layout & Panel Shaping Best Practices

When building panels via MCP:
- **Auto-Layout**: Always pass `"auto_layout": true` to `create_dashboard` or `update_dashboard`. The backend will automatically compute non-overlapping `(x, y)` coordinates across the 12-column grid.
- **Value Extraction**:
  - For simple JSON paths, specify `"valueKey": "sensor.temperature"`.
  - For string stencils or exact JSON structures, use `"readTemplate": "{\"temp\": {value}}"`.
- **Dry Run Validation**: Pass `"dry_run": true` to `create_dashboard` to preview and validate the generated schema without persisting it to SQLite.
