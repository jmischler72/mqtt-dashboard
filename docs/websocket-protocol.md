# WebSocket Protocol Specification

This document specifies the wire protocol, message structures, connection lifecycle, and backpressure semantics of the real-time WebSocket communication layer in MQTT Dashboard.

---

## Overview

MQTT Dashboard uses a bidirectional WebSocket connection (`/ws`) to stream live MQTT messages from backend broker connections to browser clients and route interactive subscriptions.

The WebSocket architecture consists of:
- **Backend Hub (`backend/ws/hub.go`)**: Manages active client connections, broker topic subscriptions, reference-counted topic multiplexing, and message fanout.
- **WebSocket HTTP Handler (`backend/ws/handler.go`)**: Handles protocol upgrades, ping/pong health tickers, and read/write loops.
- **Frontend Connection Manager (`frontend/src/hooks/useWebSocket.ts`)**: Multiplexes subscriptions from multiple dashboard panels across a single shared browser WebSocket socket.

```
+-------------------------------------------------------------------+
|                        Browser Client                             |
|                                                                   |
|   Panel A (Gauge)       Panel B (Log)       Explorer Tree         |
|         \                     |                     /             |
|          +--------------------+--------------------+              |
|                               |                                   |
|                      WSConnectionManager                          |
|             (Single multiplexed WebSocket socket)                 |
+-------------------------------+-----------------------------------+
                                |
                   WebSocket Wire Protocol (/ws)
                                |
+-------------------------------+-----------------------------------+
|                        WebSocket Hub                              |
|                    (backend/ws/hub.go)                            |
|                                                                   |
|   - Client Registry & Heartbeats (Ping/Pong: 54s/60s)             |
|   - Reference-Counted Topic Subscriptions                         |
|   - Message Serialization & Origin Panel Attribution              |
|   - Non-blocking 64-slot channel buffer per client                |
+-------------------------------+-----------------------------------+
                                |
                                v
+-------------------------------------------------------------------+
|                        MQTT Broker(s)                             |
|                   (Paho MQTT Client Pool)                         |
+-------------------------------------------------------------------+
```

---

## Client-to-Server Protocol

Clients send JSON-encoded action frames over the WebSocket connection to subscribe to or unsubscribe from topics on specific brokers.

### 1. Subscribe Frame

Sent when a panel mounts, updates its topic filter, or changes target broker.

```json
{
  "action": "subscribe",
  "panel_id": "8c459c25-1e0e-4ab8-a144-8d4e9411d332",
  "broker_id": "mosquitto-prod",
  "topics": [
    "sensors/living_room/temperature",
    "sensors/living_room/humidity"
  ]
}
```

#### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | No | `"subscribe"` (default if omitted). |
| `panel_id` | string | **Yes** | Unique UUID of the panel requesting this subscription. |
| `broker_id` | string | No | Target broker ID. Defaults to the registry's default broker if omitted. |
| `topics` | string[] | **Yes** | Array of concrete topics or wildcard filters (`+`, `#`) to observe. |

### 2. Unsubscribe Frame

Sent when a panel unmounts or changes its configuration.

```json
{
  "action": "unsubscribe",
  "panel_id": "8c459c25-1e0e-4ab8-a144-8d4e9411d332"
}
```

#### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | **Yes** | Must be `"unsubscribe"`. |
| `panel_id` | string | **Yes** | UUID of the panel releasing its subscriptions. |

---

## Reference Counting & Topic Multiplexing

To minimize MQTT network overhead, the backend **multiplexes** subscriptions across connected clients and panels:

```
                  Panel 1 Subscribes ("home/temp")
                                 |
                                 v
               +-----------------------------------+
               |  Is (broker, "home/temp") active? |
               +-----------------+-----------------+
                                 |
                     +-----------+-----------+
                 No  |                       |  Yes
                     v                       v
         +-----------------------+   +-----------------------+
         | Call broker.Subscribe |   | Increment Ref Count   |
         | Register MQTT Handler |   | Add client to set     |
         +-----------------------+   +-----------------------+
```

1. **Composite Key**: Subscriptions are keyed by `brokerTopic{brokerID, topic}`.
2. **First Subscriber**: When the first panel requests `(broker_id, topic)`, the hub registers a single shared MQTT handler with the underlying `BrokerRegistry`.
3. **Shared Distribution**: When multiple panels or clients watch the same topic, messages received from the broker are fanned out to all listening clients in memory.
4. **Clean Tear-Down**: When a panel unsubscribes, the reference count is decremented. Only when **no active panels on any client** remain watching that `(broker_id, topic)` does the hub issue an `Unsubscribe` call to the broker connection.

---

## Server-to-Client Protocol (`WSMessage`)

Whenever an MQTT message is received that matches an active subscription, the hub serializes a `WSMessage` frame:

```json
{
  "broker_id": "mosquitto-prod",
  "topic": "sensors/living_room/temperature",
  "payload": "{\"temp\": 21.8}",
  "timestamp": "2026-09-20T16:18:00.123456789Z",
  "qos": 0,
  "retained": false,
  "panel_id": "8c459c25-1e0e-4ab8-a144-8d4e9411d332",
  "source_panel_id": "99df24b1-3c4a-4122-b5e0-8178cc738a10",
  "source_panel_title": "Thermostat Slider",
  "source_dashboard_id": "default"
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `broker_id` | string | The broker instance from which the message was received. |
| `topic` | string | The concrete MQTT topic the message arrived on. |
| `payload` | string | UTF-8 string representation of the raw payload bytes. |
| `timestamp` | string | RFC 3339 UTC timestamp with nanosecond precision. |
| `qos` | integer | MQTT QoS level (`0`, `1`, or `2`). |
| `retained` | boolean | `true` if the topic holds a retained value on the broker. |
| `panel_id` | string | Target panel ID associated with the client subscription. |
| `source_panel_id` | string | *(Optional)* Originating panel ID if attributed by the [Publish Correlation Engine](publish-correlation-engine.md). |
| `source_panel_title` | string | *(Optional)* Title of the originating panel. |
| `source_dashboard_id` | string | *(Optional)* ID of the dashboard containing the originating panel. |

> [!NOTE]
> Standard MQTT brokers only flag `retained = true` when delivering a retained message to a *new* subscriber. The MQTT Dashboard hub consults its internal registry state so the `retained` flag remains accurate for live updates as well.

---

## Connection Lifecycle & Resilience

### Heartbeats & Timeouts

The WebSocket transport uses Gorilla WebSocket with strict keep-alive deadlines:
- **Ping Period**: Server sends a ping frame every `54 seconds`.
- **Pong Wait**: Server waits up to `60 seconds` for a client pong response.
- **Write Deadline**: Outgoing frame writes time out after `10 seconds`.

### Client-Side Multiplexing & Reconnect Backoff

The frontend [`WSConnectionManager`](../frontend/src/hooks/useWebSocket.ts) manages resilience transparently:
1. **Single Socket Sharing**: Only one WebSocket connection is opened per browser tab regardless of how many panels exist on the dashboard.
2. **Exponential Reconnect Backoff**: If disconnected, reconnection attempts begin at `1,000ms`, doubling on subsequent failures up to a maximum cap of `30,000ms`.
3. **Automatic State Re-hydration**: Upon successful reconnection, the manager iterates over all active subscriptions and re-sends the complete subscription manifest to the backend.
4. **React StrictMode Debouncing**: When all listeners unsubscribe (e.g., during fast tab navigation or React component re-mounting), socket teardown is debounced to avoid closing and re-opening sockets needlessly.

---

## Backpressure & Drop Semantics

To prevent memory leaks and protect the backend event loop from slow or stalled browser clients:

```go
func (c *Client) Send(msg WSMessage) bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.closed {
        return false
    }
    msg.PanelID = c.panelID
    select {
    case c.send <- msg:
        return true
    default:
        // Channel buffer full — drop message
        return false
    }
}
```

- Each connected client maintains a buffered Go channel with **64 slots**.
- Under normal throughput, messages are written non-blockingly to `c.send`.
- If a browser client stalls (e.g. background tab suspended by the browser or high network latency) and the 64-message buffer fills up, incoming frames are **dropped immediately** (`default` branch).
- This ensures high-frequency MQTT topics (e.g. 100 Hz sensor feeds) cannot block the Go runtime or cause unbounded memory consumption.
