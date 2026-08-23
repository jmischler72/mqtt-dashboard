# Backend Broker Workflow

This document describes the backend architecture for broker connections, topic subscriptions, message publishing, message reception, asynchronous history capture, and retention pruning.

## Connection Model

The backend uses **one MQTT connection per enabled broker**.

- Each enabled broker is loaded at startup by `autoConnectFromDB()` in [backend/main.go](../backend/main.go).
- `BrokerRegistry.AddBroker()` creates one `MQTTManager`, connects it to the broker, and registers permanent `#` and `$SYS/#` handlers on that manager.
- The registry keeps a thread-safe map of `broker_id -> MQTTManager`.
- Creating, updating, disabling, or deleting a broker updates only that broker manager; there is no shared global MQTT connection.

## What Happens On Startup

1. **Database initialization**: SQLite is initialized in WAL mode with a single connection limit (`SetMaxOpenConns(1)`) and busy timeout to avoid concurrency lockups.
2. **Registry & History Writer initialization**: `BrokerRegistry` starts an asynchronous, queued history writer worker (`StartHistoryWriter()`) with a buffered channel (`1024` items) to serialize SQLite insertions without blocking MQTT network threads.
3. **Settings loading**: `initRegistrySettings()` applies settings such as `save_sys_topics` to the registry.
4. **Broker connections**: All enabled brokers in `mqtt_brokers` are connected via `registry.AddBroker(broker)` in sort order. The first enabled broker becomes the default broker.
5. **Cron & Scheduler**: The cron scheduler is started, loading panel cron jobs from `dashboard_layouts`, and initiates the background retention pruning job (`StartPruningJob()`).
6. **WebSocket Hub**: The WebSocket hub is initialized to route live message streams between browser clients and broker subscriptions.

## Message Publish Flow

When the frontend sends a publish request to `POST /api/publish`:

1. The handler resolves the target `broker_id` from the request or falls back to the registry default.
2. `BrokerRegistry.Publish(brokerID, topic, qos, retain, payload)` is called.
3. The registry routes the call to that broker's `MQTTManager`.
4. If `retain` is true, the registry marks the topic in its internal retained set (`markRetained`).
5. The `MQTTManager` publishes the message through its broker connection.
6. The publish handler does not write directly to `mqtt_history`. Explorer history is populated when the broker delivers the message back through the manager's `#` subscription.

## Message Receive & History Capture Flow

Incoming broker messages follow two logical paths over the same broker connection:

### 1. History capture & Stats processing

When a broker is added, the registry subscribes to `#` and `$SYS/#`:

- **Wildcard capture (`#`)**: All application messages are queued to the background history channel with `broker_id`, `topic`, `payload`, `qos`, and `retained` flags.
- **System metrics (`$SYS/#`)**: Telemetry messages are routed to `parseSysStats()` to update the live `StatsCache` (broker version, uptime, memory, sent/received message counters, and 5-minute load averages). If `save_sys_topics` is enabled in settings, these messages are also queued to `mqtt_history`.
- **Asynchronous Writer Worker**: A dedicated background goroutine processes queued records sequentially, ensuring single-writer serialization to SQLite without locking the database under high-throughput publishing.

### 2. Live panel subscriptions

Panels such as button, input, log, and cron panels subscribe to topics through the WebSocket hub:

- The hub creates MQTT subscriptions per `(broker_id, topic)` pair.
- Multiple WebSocket clients watching the same broker/topic share the same MQTT subscription.
- When the last client leaves a broker/topic, the hub unsubscribes that topic handler from the broker connection.

### Overlap handling in MQTTManager

`MQTTManager` avoids overlapping MQTT-level subscriptions when `#` and specific topics coexist on the same client:

- If `#` is active, subscribing a specific topic only adds an internal handler; it does not call broker `SUBSCRIBE` for that topic.
- If `#` is added, existing specific MQTT subscriptions are removed from the broker session.
- When processing messages from `#`, the manager dispatches to both `#` handlers and exact-topic handlers.
- If `#` is removed, remaining specific topic subscriptions are re-added on the broker session.

This prevents duplicate broker deliveries caused by overlapping wildcard and exact subscriptions on the same MQTT client session.

## Important Distinction

The backend does **not** create a new MQTT connection per panel.

It creates:

- **One MQTT connection per broker**
- Permanent `#` and `$SYS/#` handlers per broker for history capture and metrics
- Additional specific topic handlers when panels need them (multiplexed across WebSocket clients)

## Explorer Data Path

The Explorer page uses both SQLite history and live WebSocket streaming:

- `GET /api/explorer/tree?broker_id=...` returns distinct topics seen in the last 24 hours for that broker.
- `GET /api/explorer/history?broker_id=...&topic=...` returns stored history rows for that exact topic.
- `GET /api/explorer/activity?broker_id=...&topic=...` returns message counts grouped into time buckets for activity charts.
- The topic tree and log streams update in real-time over WebSocket.

## Retention Pruning

The backend runs an automated pruning job every 30 minutes and executes an immediate prune on startup:

- Reads `retention_period_hours` from `app_settings` (default: 24 hours).
- Deletes records older than that retention window from `mqtt_history`.
- Users can also trigger a manual history purge via `DELETE /api/history`.