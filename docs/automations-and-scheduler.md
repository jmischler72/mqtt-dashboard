# Automations & Cron Engine

This document details the architecture, execution mechanics, and API interfaces of the automated background task scheduler and cron engine in MQTT Dashboard.

---

## Overview

MQTT Dashboard includes an in-memory background cron engine that allows users to schedule recurring MQTT publishes directly from dashboard panels.

Common use cases include:
- Polling legacy sensors or microcontrollers by sending periodic ping/poll requests.
- Triggering scheduled automations (e.g., turning off smart lights every night at 23:00).
- Simulating IoT device telemetry for testing and dashboard prototyping.
- Periodically pruning aged database history.

The scheduler is implemented in [`backend/cron/scheduler.go`](../backend/cron/scheduler.go) using [`gocron v2`](https://github.com/go-co-op/gocron) and [`robfig/cron/v3`](https://github.com/robfig/cron).

```
 +-------------------------------------------------------------------+
 |                         Dashboard Layout                          |
 |                (SQLite: dashboard_layouts table)                  |
 +---------------------------------+---------------------------------+
                                   | Loaded on startup
                                   v
 +-------------------------------------------------------------------+
 |                           gocron Engine                           |
 |               (In-memory scheduler tagged by panelId)             |
 |                                                                   |
 |  Job A: "*/5 * * * *"  --> Execute Task goroutine                 |
 |  Job B: "0 8 * * *"    --> Execute Task goroutine                 |
 |  Job Pruning: "*/30 *" --> SQLite History cleanup                 |
 +---------------------------------+---------------------------------+
                                   | Triggered by timer
                                   v
 +-------------------------------------------------------------------+
 |                      sc.registry.Publish                          |
 |              (Attributed with originating panelID)                |
 +---------------------------------+---------------------------------+
                                   | Outgoing message
                                   v
 +-------------------------------------------------------------------+
 |                    Publish Correlation Engine                     |
 |        (Matches broker echo back to panel for live metrics)       |
 +-------------------------------------------------------------------+
```

---

## Scheduling Architecture & Mechanics

### Cron Expression Format

The scheduler parses standard 5-field cron expressions:

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of the month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of the week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
* * * * *
```

Standard descriptors (`@hourly`, `@daily`, `@weekly`) are also supported. Cron expressions are strictly validated before state mutation using `cronv3.NewParser`:
- Wildcard topics (`+` or `#`) are rejected because cron jobs only publish messages and cannot publish to topic filters.

### Job Registration & Tagging

Each cron job is associated with a specific dashboard panel ID. When a job is added via `AddJob`:
1. Existing jobs tagged with the same `panelID` are removed via `sc.s.RemoveByTags(panelID)`.
2. A new `gocron.Job` is registered and tagged with the `panelID`.
3. In-memory metadata (`JobInfo`) tracks the expression, topic, payload, QoS, retain flag, enabled status, and calculated `NextRun` timestamp.

### Multi-Topic Publishing & Origin Attribution

When a scheduled job fires, its task function executes:

```go
for _, t := range strings.Split(topic, ",") {
    t = strings.TrimSpace(t)
    if t != "" {
        sc.registry.Publish(bID, t, qos, retain, []byte(payload), panelID)
    }
}
```

Key execution traits:
1. **Multi-Topic Dispatch**: Comma-separated topics (`home/lights, garden/lights`) are split and published in sequence.
2. **Origin Attribution**: The originating `panelID` is supplied directly to [`BrokerRegistry.Publish`](../backend/mqtt/registry.go).
3. **Correlation Tracking**: The outgoing message is tracked by the [Publish Correlation Engine](publish-correlation-engine.md), ensuring that when the broker echoes the message back on `#`, the live WebSocket stream attributes the publish to the scheduled panel.

---

## State Machine & Toggle API

Cron configurations persist inside `dashboard_layouts.config_json`.

### Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/cron` | Lists all cron panels across all dashboards, with resolved broker names and `next_run` / `prev_run` timings. |
| `GET` | `/api/cron/{panelId}` | Returns the live scheduling status of a single cron panel. |
| `PUT` | `/api/cron/{panelId}` | Upserts a cron job in both memory and database layout. |
| `PUT` | `/api/cron/{panelId}/toggle` | Enables or disables an existing cron job without modifying its schedule. |
| `DELETE` | `/api/cron/{panelId}` | Unschedules and removes the cron job. |

### Toggle Behavior (`PUT /api/cron/{panelId}/toggle`)

```json
{
  "enabled": false
}
```

The toggle handler in [`backend/handlers/cron.go`](../backend/handlers/cron.go) implements graceful state recovery:
1. It attempts to toggle the job in the live `gocron` instance.
2. **Cold Start Recovery**: If the job is not currently loaded in memory (e.g. after dynamic layout import or manual database edit), the handler queries `dashboard_layouts` for the panel's stored `config_json` and initializes it into the scheduler dynamically.
3. The `enabled` flag inside `dashboard_layouts.config_json` is updated in SQLite while preserving any other existing configuration fields.

---

## Next-Run & Previous-Run Calculations

When querying `/api/cron`, the scheduler computes execution timings directly from the active `gocron` worker:

```json
{
  "panel_id": "8c459c25-1e0e-4ab8-a144-8d4e9411d332",
  "panel_title": "Nightly Reset",
  "dashboard_name": "Main",
  "broker_name": "Local Mosquitto",
  "cron_expr": "0 23 * * *",
  "topic": "system/reset",
  "payload": "{\"cmd\": \"nightly_reboot\"}",
  "qos": 1,
  "retain": false,
  "enabled": true,
  "next_run": "2026-09-20T23:00:00Z",
  "prev_run": "2026-09-19T23:00:00Z"
}
```

- If a job is disabled, `next_run` is omitted.
- If a job has not yet executed since application boot, `prev_run` is omitted.
- All timestamps are evaluated in system local time and serialized in RFC 3339 UTC format.

---

## Background Retention Pruning Job

In addition to user-defined panel automations, the scheduler runs an internal background maintenance task:

```go
func (sc *Scheduler) StartPruningJob(db *sql.DB) error {
    _, err := sc.s.NewJob(
        gocron.CronJob("*/30 * * * *", false),
        gocron.NewTask(func() {
            // Deletes history older than configured retention period
            db.Exec(`DELETE FROM mqtt_history WHERE timestamp < DATETIME('now', '-' || ? || ' hours')`, retentionHours)
        }),
        gocron.JobOption(gocron.WithStartImmediately()),
        gocron.WithTags("pruning"),
    )
    return err
}
```

* **Schedule**: Runs every 30 minutes (`*/30 * * * *`).
* **Immediate Run**: Executes once immediately on startup (`WithStartImmediately`).
* **Configurable Window**: Reads `retention_period_hours` from `app_settings` (defaults to 24 hours).
* **Tag**: Tagged as `"pruning"` to isolate it from panel jobs.
