# Product Requirement Document (PRD)

## Feature: MQTT Topic Explorer & History Tracking

**Module Name:** Explorer Page (`/explorer`)

**Status:** Ready for Implementation

---

## 1. Feature Overview & Objectives

While the primary Dashboard page focuses on curated, static layouts for specific user widgets, the **Explorer Page** introduces an ad-hoc, deep-dive debugging interface inspired directly by *MQTT Explorer*.

This feature turns Macchiato into a comprehensive message inspector by recursively mapping the full hierarchy of topics broadcast across the broker. Furthermore, it shifts the backend tracking from transient routing to stateful history logging, allowing developers to see what occurred on any topic over a rolling historical window (minimum 24 hours), even if their browser tab was closed.

---

## 2. Configuration Page Updates (Backend & UI)

To manage data retention without exhausting disk space on local environments, the existing **Configuration Page** must expand to accept data lifecycle parameters.

### 2.1. UI Elements (Frontend)

* **Data Retention Field:** A numerical input field combined with a unit selector dropdown (Hours, Days).
* *Validation:* Enforce a system minimum of 24 hours. Default configuration set to 24 hours.


* **Pruning Schedule Info:** Descriptive microcopy indicating that historical data exceeding this timeframe will be automatically purged by the backend.

### 2.2. Persistence (Backend Schema Update)

The SQLite database setup script must add a metadata configuration column and initialize a secondary ledger table to log incoming message streams.

```sql
-- Extend existing mqtt_configurations
ALTER TABLE mqtt_configurations ADD COLUMN retention_period_hours INTEGER DEFAULT 24;

-- New historical log ledger table
CREATE TABLE IF NOT EXISTS mqtt_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    payload TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Optimize queries matching nested hierarchy paths
CREATE INDEX IF NOT EXISTS idx_mqtt_history_topic_time ON mqtt_history(topic, timestamp);

```

---

## 3. Backend Implementation (Go & SQLite)

### 3.1. Wildcard Broker Harvesting

When the backend initializes its active broker connection, it will automatically register a permanent sub-routine subscribing to the multi-level root wildcard topic (`#`). Every single packet captured across this broad listener hooks directly into an asynchronous database append mechanism.

### 3.2. Data Retention Pruning Engine

Using the existing `gocron` instance, the Go server initializes a background ticker routine dedicated to database cleaning.

* **Interval:** Executes automatically once every 30 minutes.
* **Logic:** Reads `retention_period_hours` from configurations and runs a sequential transaction execution profile:
```sql
DELETE FROM mqtt_history WHERE timestamp < DATETIME('now', '-' || ? || ' hours');

```



### 3.3. API Endpoint Contracts

The backend exposes two new operational endpoints specifically for the Explorer subsystem:

* `GET /api/v1/explorer/history?topic={encoded_topic}`
* *Purpose:* Fetches all records from `mqtt_history` for the designated target topic within the active retention window.


* `GET /api/v1/explorer/tree`
* *Purpose:* Returns a unique flat list of all active topics captured in the last 24 hours so the frontend can build its baseline folder structures upon page load.



---

## 4. Frontend Functional Specifications (React & Tailwind)

The Explorer Page uses a master-detail split layout view. The upper (or left) section presents the nested structure, while the lower (or right) area dynamically details message traffic.

### 4.1. The Recursive Topic Tree Component

Instead of a simple flat string list, paths matching forward slashes (`/`) parse programmatically into an expandable node directory system.

* **Recursive Splitting:** A topic payload stream tracking `home/livingroom/temperature` splits structurally into nested folder nodes: `home` ➔ `livingroom` ➔ `temperature`.
* **Expand & Collapse Behaviors:** Clicking on a parent subfolder toggles the visibility state of its nested child paths, using native DaisyUI styling variants.
* **New Message Visual Flash:** When a live WebSocket message streams down from the backend for a specific topic branch, that individual node quickly transitions into a **bright blue highlight background** using a short Tailwind CSS utility fade-out duration animation (`duration-300 ease-out`).

### 4.2. Detail Workspace (Topic Interaction)

When any individual leaf or branch topic is selected by a user click, a specialized workspace renders immediately below (or alongside) the primary tree list.

```
┌────────────────────────────────────────────────────────┐
│  ▼ home                                                │
│    ▼ livingroom                                        │
│        temperature  ◄── [Clicked Topic]                │
├────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────┐ │
│ │ LOG PANEL: home/livingroom/temperature             │ │
│ │ [14:22:01] 21.5°C  (Historical Context Render)    │ │
│ │ [14:55:10] 22.0°C  (Historical Context Render)    │ │
│ │ [20:21:44] 22.3°C  ◄── New Incoming Stream Live    │ │
│ └────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────┐ │
│ │ INPUT PANEL: [ Type Payload...          ] [Send]  │ │
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘

```
The log and input panel can reuse the panel made for the dashboard 

#### A. The Contextual Log Panel

The current log panel doesnt handle the history of the mqtt topics, so it should be updated to handle them

* **Bootstrapping State:** On initial selection, the panel calls `GET /api/v1/explorer/history?topic=...`.
* **Color-Coded Timeline Rendering:**
* **Historical Data:** Records fetched from the SQLite database historical query render explicitly in a **muted grey font style** (`text-gray-400` / `text-base-content/40`).
* **Live Streamed Data:** Any fresh MQTT message frames intercepted via active WebSockets append at the bottom of the log array immediately using the standard text colors for complete legibility.



#### B. Quick Action Input Panel

* **UI Controls:** A compact DaisyUI text input form field paired with a clear, standard submit button.
* **Action Profile:** Automatically inherits the active folder string location path as its target destination. Pressing "Send" dispatches an immediate API request payload to publish downstream directly to that specific topic string without leaving the debugging interface.

---

## 5. Non-Functional & Performance Guardrails

* **Database Compaction:** Storing raw data payloads continuously on the root system wildcard (`#`) could degrade performance on high-traffic development environments. If performance metrics drop over large datasets, the Go logic should automatically discard messages mapping to known high-frequency diagnostic lines (e.g., local broker `$SYS/` system paths).
* **Virtual UI Rendering:** If the recursive configuration schema contains more than 500 individual nested topic strings, the UI tree view container should implement a virtualization wrapper component to ensure browser frame-rates remain fluid during intense flash updates.

```

```