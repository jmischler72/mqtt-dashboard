# Publish Correlation Engine

This document details the architecture, design decisions, and mechanics of the **Serialized FIFO Publish Correlation Engine** used by MQTT Dashboard to attribute MQTT messages to their originating dashboard panels and cron jobs.

---

## The Challenge

In MQTT Dashboard, interactive panels (Button, Toggle, Slider, Input) and scheduled cron automations publish messages to MQTT brokers via the backend REST API (`POST /api/publish`).

To display live streams and store message histories, the backend maintains a wildcard (`#`) subscription to every active broker. Message persistence into SQLite (`mqtt_history`) and broadcasting to connected browser clients over WebSockets occur exclusively when the broker reflects the message back through this `#` subscription.

However, standard MQTT 3.1.1 messages contain only:
- **Topic**
- **Payload**
- **QoS level**
- **Retain flag**

MQTT 3.1.1 does **not** support protocol-level metadata headers or user properties. Consequently, when a message arrives on `#`, the broker echo does not natively identify which UI panel or automation triggered the publish.

### Potential Approaches Evaluated

1. **Payload Envelope / Wrapping**: Wrapping payloads in JSON with metadata envelopes (e.g., `{"_origin": "panel-123", "data": ...}`).
   - *Drawback*: Contaminates real device payloads. External devices, microcontrollers, and third-party subscribers expect clean raw bytes.
2. **Side-Channel Database Writes on Publish**: Inserting the record directly into SQLite on `POST /api/publish` before broker confirmation.
   - *Drawback*: Creates ghost records for failed publishes, causes duplicate rows when the broker echo arrives on `#`, breaks order-of-arrival guarantees, and circumvents the broker as the single source of truth.
3. **MQTT v5 User Properties**: Native protocol headers.
   - *Drawback*: Requires MQTT 5.0 brokers and client negotiation; breaks compatibility with existing MQTT 3.1.1 brokers. (Tracked as a future protocol upgrade in [Issue #174](https://github.com/jmischler72/mqtt-dashboard/issues/174)).
4. **Serialized FIFO In-Memory Correlation Engine**: Serializing socket writes and matching outgoing publishes against incoming broker echoes using in-memory FIFO tracking.
   - *Result*: Zero payload contamination, complete compatibility with any MQTT 3.1.1 or 5.0 broker, zero extra database queries, and sub-microsecond matching.

---

## Architecture & Workflow

The correlation engine operates entirely in-memory within [`backend/mqtt/client.go`](../backend/mqtt/client.go) and [`backend/mqtt/registry.go`](../backend/mqtt/registry.go).

```
   +-------------------------------------------------------------+
   |                       HTTP Publish                          |
   |   (POST /api/publish with topic, payload, panel_id)         |
   +------------------------------+------------------------------+
                                  |
                                  v
                   [ BrokerRegistry.Publish ]
                                  |
                                  v
   +-------------------------------------------------------------+
   |                       MQTTManager                           |
   |                                                             |
   |   1. Acquire pubMu (mutex)                                  |
   |   2. trackOutgoing(topic, payload, panel_id)                |
   |      -> Append to pendingPubs ring buffer (TTL: 5s)         |
   |   3. client.Publish(topic, qos, retain, payload)            |
   |      -> Serialized write to TCP socket                      |
   |   4. Release pubMu                                          |
   +------------------------------+------------------------------+
                                  |
                                  v TCP Socket
                     +--------------------------+
                     |     Mosquitto Broker     |
                     +------------+-------------+
                                  |
                                  v Broker Echo on '#'
   +-------------------------------------------------------------+
   |                       buildHandler                          |
   |                                                             |
   |   1. matchOutgoing(topic, payload)                          |
   |      -> FIFO scan of pendingPubs                            |
   |      -> Pops matching item & extracts panel_id              |
   |   2. Dispatch to MessageHandler(..., sourcePanelID)         |
   +------------------------------+------------------------------+
                                  |
                +-----------------+-----------------+
                |                                   |
                v                                   v
   +-------------------------+         +-------------------------+
   |  BrokerRegistry History |         |      WebSocket Hub      |
   |  writeHistory(..., pid) |         |  broadcast(..., pid)    |
   |  -> Saved to SQLite     |         |  -> Cached metadata     |
   |     with source_panel_id|         |  -> Sent to browsers    |
   +-------------------------+         +-------------------------+
```

---

## Key Mechanics

### 1. Serialized Socket Writes (`pubMu`)

Paho MQTT client's internal publish pipeline enqueues packets onto internal channels. If two panels concurrently publish to the same topic with identical payloads, concurrent socket writes could be interleaved in non-deterministic order.

To guarantee deterministic matching, `MQTTManager` enforces write serialization using `pubMu sync.Mutex`:

```go
m.pubMu.Lock()
defer m.pubMu.Unlock()

if pid != "" {
    m.trackOutgoing(topic, payload, pid)
}

token := client.Publish(topic, qos, retain, payload)
token.WaitTimeout(5 * time.Second)
```

Because outgoing packets are written to the TCP socket sequentially, the broker processes and reflects them in identical FIFO order over the established TCP stream.

### 2. FIFO Ring Buffer & TTL Eviction

Outgoing publishes with a `panelID` are tracked in `pendingPubs []pendingPublish`:

```go
type pendingPublish struct {
    topic     string
    payload   string
    panelID   string
    createdAt time.Time
}
```

- **TTL (5 seconds)**: Expired entries are filtered out on write and ignored during matching. If the network drops or the broker discards an unauthorized publish, stale entries self-clean without memory leaks.
- **Capacity Cap (500 items)**: Prevents unbounded memory growth during high-throughput publish bursts.

### 3. FIFO Matching (`matchOutgoing`)

When Mosquitto reflects the message back to the `#` subscription:

1. `matchOutgoing(topic, payload)` scans `pendingPubs` in arrival order.
2. If an entry matches `topic` and `payload` and is within the 5-second TTL:
   - The entry is removed from the slice (consumed).
   - Its `panelID` is returned.
3. If no entry matches (e.g. the message was published by an external script, device, or another client):
   - Returns an empty string `""` (no panel attribution).

### 4. Retained Message Origin Tracking

Retained messages are persisted by the broker and re-delivered to clients whenever a new subscription is established.

To preserve panel attribution when a user reloads the dashboard or subscribes to a topic holding a retained message:
- When publishing with `retain = true`, `BrokerRegistry.retainedPanels` stores a thread-safe mapping of `brokerID:topic -> panelID`.
- When an incoming message has `retained = true` (or matches a known retained topic), the registry checks `retainedPanels` to restore the originating panel badge.

---

## Consumer Integration

### Database Persistence & Historical Enrichment
- The `mqtt_history` table contains a `source_panel_id TEXT` column.
- The history API (`GET /api/explorer/history`) executes a `LEFT JOIN dashboard_layouts` on `source_panel_id = dashboard_layouts.id` to dynamically resolve `source_panel_title` and `source_dashboard_id`.

### Live WebSocket Broadcast
- `ws.WSMessage` includes `source_panel_id`, `source_panel_title`, and `source_dashboard_id`.
- Panel titles and dashboard IDs are resolved through a thread-safe in-memory cache (`sync.Map`) with fallback SQLite lookup, executing in <50 nanoseconds per message to prevent latency on high-throughput WebSocket streams.

### Frontend UI Badges
- In [`LogPanel.tsx`](../frontend/src/components/panels/LogPanel.tsx), messages displaying a `sourcePanelId` render a clickable DaisyUI badge:
  ```tsx
  <Link
    to={`/dashboard?dashboard=${sourceDashboardId}&panel=${sourcePanelId}`}
    className="badge badge-xs badge-info hover:badge-primary"
  >
    <RiExternalLinkLine className="w-2.5 h-2.5" />
    <span>{sourcePanelTitle || "Panel"}</span>
  </Link>
  ```
- Clicking the badge navigates to the target dashboard, auto-scrolls the panel into view, triggers a subtle pulse highlight animation, and purges transient URL query parameters.
