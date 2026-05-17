# Backend Broker Workflow

This document describes the current backend behavior for broker connections, topic subscriptions, message publishing, message reception, and explorer history capture.

## Connection Model

The backend uses **one MQTT connection per enabled broker**.

- Each enabled broker is loaded at startup by `autoConnectFromDB()` in [backend/main.go](../backend/main.go).
- `BrokerRegistry.AddBroker()` creates one `MQTTManager`, connects it, and registers the permanent `#` history handler on that same manager.
- The registry keeps one map of `broker_id -> MQTTManager`.
- Creating, updating, disabling, or deleting a broker updates only that broker manager; there is no shared global MQTT connection.

## What Happens On Startup

1. SQLite is initialized.
2. All enabled brokers are loaded from `mqtt_brokers`.
3. For each broker, the backend calls `registry.AddBroker(broker)`.
4. `AddBroker()` connects the broker client and registers `#` for history capture.
5. The first enabled broker becomes the default broker.
6. The cron scheduler is started.
7. The WebSocket hub is created and waits for panel subscriptions.

## Message Publish Flow

When the frontend sends a publish request to `POST /api/publish`:

1. The handler resolves the broker ID from the request or falls back to the registry default.
2. `BrokerRegistry.Publish(brokerID, topic, payload)` is called.
3. The registry routes the call to that broker's `MQTTManager`.
4. The `MQTTManager` publishes the message through its broker connection.
5. The publish handler does not write directly to `mqtt_history`.
6. Explorer history is populated only when the broker delivers the message back through the manager's `#` subscription.

## Message Receive Flow

Incoming broker messages follow two logical paths over the same broker connection:

### 1. Explorer / history capture

When a broker is added, the registry subscribes that broker manager to `#`.

- This is the permanent wildcard history subscription.
- It captures all broker messages except `$SYS/` topics.
- Each matching message is inserted into `mqtt_history` with `broker_id`, `topic`, `payload`, and timestamp.

### 2. Live panel subscriptions

Panels such as button, input, log, and cron panels can subscribe to specific topics through the WebSocket hub.

- The hub creates MQTT subscriptions per `(broker_id, topic)` pair.
- Multiple WebSocket clients watching the same broker/topic share the same MQTT subscription.
- When the last client leaves a broker/topic, the hub unsubscribes that topic handler from the broker connection.

### Overlap handling in MQTTManager

`MQTTManager` avoids overlapping MQTT-level subscriptions when `#` and specific topics coexist.

- If `#` is active, subscribing a specific topic only adds an internal handler; it does not call broker `SUBSCRIBE` for that topic.
- If `#` is added, existing specific MQTT subscriptions are removed from the broker session.
- When processing messages from `#`, the manager dispatches to both `#` handlers and exact-topic handlers.
- If `#` is removed, remaining specific topic subscriptions are re-added on the broker session.

This prevents duplicate broker deliveries caused by overlapping wildcard and exact subscriptions on the same MQTT client session.

## Important Distinction

The backend does **not** create a new MQTT connection per panel.

It creates:

- one MQTT connection per broker
- one permanent `#` handler per broker for history capture
- additional specific topic handlers and MQTT subscriptions when panels need them

So if three panels watch the same topic on the same broker, they still share the same broker connection and the same MQTT topic subscription.

Wildcard and exact-topic overlap is handled inside `MQTTManager`, which keeps broker-level subscriptions non-overlapping while still routing messages to all relevant handlers.

## Explorer Data Path

The Explorer page uses both history and live updates, but they serve different roles.

- `GET /api/explorer/tree?broker_id=...` returns distinct topics seen in the last 24 hours for that broker.
- `GET /api/explorer/history?broker_id=...&topic=...` returns history rows for that exact topic.
- The topic tree is also updated from a live WebSocket subscription so newly seen topics can appear without a refresh.
- The selected topic log bootstraps from history, then the normal log panel subscribes live over WebSocket for ongoing messages.

## Retention Pruning

The backend also runs a pruning job every 30 minutes.

- It reads `retention_period_hours` from `app_settings`.
- It deletes rows older than that retention window from `mqtt_history`.

## Notes

- `$SYS/` topics are excluded from history capture.
- Explorer history comes from `mqtt_history`, while live panel updates come through the WebSocket hub.
- If a broker does not echo a dashboard-originated publish back to subscribers, that publish will not appear in `mqtt_history`, because the backend no longer inserts publish requests directly.