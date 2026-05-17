# Backend Broker Workflow

This document describes the current backend behavior for broker connections, topic subscriptions, message publishing, message reception, and explorer history capture.

## Connection Model

The backend uses **one MQTT connection per broker**.

- Each enabled broker is loaded at startup by `autoConnectFromDB()` in [backend/main.go](../backend/main.go).
- `BrokerRegistry.AddBroker()` creates a new `MQTTManager` for that broker and connects it.
- The registry keeps a map of `broker_id -> MQTTManager`.
- Creating, updating, disabling, or deleting a broker updates that broker's manager only; it does not create a shared global MQTT connection.

## What Happens On Startup

1. SQLite is initialized.
2. All enabled brokers are loaded from `mqtt_brokers`.
3. For each broker, the backend calls `registry.AddBroker(broker)`.
4. The first enabled broker becomes the default broker.
5. The cron scheduler is started.
6. The WebSocket hub is created and waits for panel subscriptions.

## Message Publish Flow

When the frontend sends a publish request to `POST /api/publish`:

1. The handler resolves the broker ID from the request or falls back to the registry default.
2. `BrokerRegistry.Publish(brokerID, topic, payload)` is called.
3. The registry routes the call to that broker's `MQTTManager`.
4. The `MQTTManager` publishes the message through the broker connection.
5. After a successful publish, the backend also writes the message to `mqtt_history` as a best-effort fallback so dashboard-originated publishes appear in Explorer history.

## Message Receive Flow

Incoming broker messages follow two paths:

### 1. Explorer / history capture

When a broker connects, the registry also subscribes that broker's MQTT client to `#`.

- This is the permanent wildcard history subscription.
- It captures all broker messages except `$SYS/` topics.
- Each matching message is inserted into `mqtt_history` with `broker_id`, `topic`, `payload`, and timestamp.

### 2. Live panel subscriptions

Panels such as button, input, log, and cron panels can subscribe to specific topics through the WebSocket hub.

- The hub creates MQTT subscriptions per `(broker_id, topic)` pair.
- Multiple WebSocket clients watching the same broker/topic share the same MQTT subscription.
- When the last client leaves a broker/topic, the hub unsubscribes that topic handler from the broker connection.

## Important Distinction

The backend does **not** create a new MQTT connection per panel.

It creates:

- one MQTT connection per broker
- one permanent `#` subscription per broker for history capture
- additional topic subscriptions only when a panel or explorer view needs them

So if three panels watch the same topic on the same broker, they still share the same broker connection and the same topic subscription.

## Explorer Data Path

The Explorer page uses the history table rather than reading directly from the live websocket stream.

- `GET /api/explorer/tree?broker_id=...` returns distinct topics seen in the last 24 hours for that broker.
- `GET /api/explorer/history?broker_id=...&topic=...` returns history rows for that exact topic.
- The frontend then renders the topic tree and the log view from those records.

## Retention Pruning

The backend also runs a pruning job every 30 minutes.

- It reads `retention_period_hours` from `app_settings`.
- It deletes rows older than that retention window from `mqtt_history`.

## Notes

- `$SYS/` topics are excluded from history capture.
- Explorer history is currently based on the `mqtt_history` table, not on live panel subscriptions.
- If a broker does not echo a dashboard-originated publish back through its subscribed wildcard path, the publish handler still inserts a row into `mqtt_history` directly.