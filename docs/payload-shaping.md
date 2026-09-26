# Payload Shaping & Template Guide

This document explains how MQTT Dashboard extracts values from incoming MQTT telemetry and shapes outgoing command payloads for interactive panels (Buttons, Toggles, Sliders, Gauges, Inputs, and Graphs).

---

## Overview

In IoT architectures, devices rarely share a unified payload format. Some publish raw numbers (`21.5`), others publish human-readable text (`ON`, `OFF`), and many communicate via structured JSON objects:

```json
{"temperature": 21.5, "humidity": 45.2, "battery": 98}
```

Furthermore, many devices exhibit **asymmetric read/write patterns**:
- **Commands (Write)**: Sent to `zigbee2mqtt/living_room/set` with `{"state": "ON"}`.
- **Telemetry (Read)**: Received from `zigbee2mqtt/living_room` with `{"state": "ON", "brightness": 255, "linkquality": 84}`.

MQTT Dashboard unifies payload processing through a bidirectional **payload shaping engine** implemented in [`frontend/src/components/panels/payloadShape.ts`](../frontend/src/components/panels/payloadShape.ts).

```
 Incoming MQTT Message                           Interactive Panel
+----------------------+                     +-----------------------+
| {"temp": 22.4, ...}  | ----[ Read ]------> | Gauge / Graph / Log   |
+----------------------+   extractValue()    | (Displays 22.4)       |
                                             +-----------------------+
 Outgoing MQTT Publish                                   |
+----------------------+                     +-----------------------+
| {"target": 22.4}     | <---[ Write ]------ | Slider / Toggle       |
+----------------------+   renderPayload()   | (User changes value)  |
                                             +-----------------------+
```

---

## Token Interpolation Syntax (`{value}`)

When a panel publishes a message, it uses a **write template** containing a single value placeholder token:

```
VALUE_TOKEN = "{value}"
```

In the panel configuration modal, this token is rendered as an interactive **`value` chip**.

### Quoted vs. Unquoted Tokens

The syntax around `{value}` dictates the data type serialized into the published message:

| Template | Runtime Value | Published Payload | Type |
|---|---|---|---|
| `"{value}"` | `ON` | `"ON"` | JSON String |
| `{"state":"{value}"}` | `OFF` | `{"state":"OFF"}` | JSON Object with String property |
| `{value}` | `42` | `42` | Raw / JSON Number |
| `{"brightness":{value}}` | `180` | `{"brightness":180}` | JSON Object with Numeric property |
| `prefix/{value}/suffix` | `abc` | `prefix/abc/suffix` | Custom string / URI segment |

> [!TIP]
> A payload that contains only the bare `{value}` token publishes the panel's runtime value directly as raw bytes without any surrounding wrappers (ideal for simple microcontrollers like Arduino or ESPHome listening for raw numbers or strings).

### Single-Token Guarantee

Only one `{value}` token is allowed per template. Functions such as [`keepOneToken()`](../frontend/src/components/panels/payloadShape.ts) and [`placeToken()`](../frontend/src/components/panels/payloadShape.ts) ensure that inserting a new token moves or replaces existing tokens rather than creating duplicate substitutions.

---

## Reading Incoming Values

When an MQTT message arrives on a panel's subscribed topic, [`readValue()`](../frontend/src/components/panels/payloadShape.ts) extracts the target value using a multi-stage resolution pipeline:

```
                Incoming Message
                       |
                       v
         +----------------------------+
         |  1. Stencil Pattern Match  |  --> Hit? --> Return Coerced Value
         |      (matchTemplate)       |
         +----------------------------+
                       | Miss
                       v
         +----------------------------+
         |   2. Loose JSON Parsing    |  --> Invalid JSON? --> Return Raw String
         |      (parseLooseJson)      |
         +----------------------------+
                       | Valid JSON
                       v
         +----------------------------+
         | 3. JSON Dot-Path Resolving |  --> Found? --> Return Coerced Value
         |       (resolvePath)        |
         +----------------------------+
                       | Not found
                       v
               Fallback Raw Payload
```

### 1. Stencil Pattern Matching (`matchTemplate`)

Before attempting JSON parsing, the engine evaluates whether the template can act as a **textual stencil** using [`matchTemplate()`](../frontend/src/components/panels/payloadShape.ts).

The text preceding `{value}` acts as a prefix anchor (head), while text following it acts as a suffix anchor (tail):

* **Example Template**: `<sensor>temperature</sensor><val>{value}</val>`
* **Incoming Message**: `<sensor>temperature</sensor><val>23.8</val>`
* **Extracted Value**: `23.8`

This allows panels to extract values from XML, custom key-value pairs (`temp=21.4;status=ok`), or non-standard protocols without requiring complex regex configuration from the user.

### 2. Forgiving / Loose JSON Parsing (`parseLooseJson`)

Embedded device firmware often produces JSON-like text with minor syntax defects. [`parseLooseJson()`](../frontend/src/components/panels/payloadShape.ts) first attempts strict `JSON.parse`. If parsing fails, it relaxes syntax constraints by:
1. Quoting unquoted object keys (e.g., `{temperature: 24}` $\rightarrow$ `{"temperature": 24}`)
2. Replacing single quotes with standard double quotes (e.g., `{'status': 'ok'}` $\rightarrow$ `{"status": "ok"}`)
3. Stripping trailing commas (e.g., `{"val": 12,}` $\rightarrow$ `{"val": 12}`)

### 3. Nested JSON Path Extraction (`resolvePath`)

For structured JSON payloads, [`resolvePath()`](../frontend/src/components/panels/payloadShape.ts) walks dot-delimited property paths and array indices.

#### Dot Paths
```json
{
  "sensor": {
    "telemetry": {
      "temperature": 22.4
    }
  }
}
```
* **Path**: `sensor.telemetry.temperature`
* **Resolved**: `22.4`

#### Array Indexing
```json
{
  "readings": [
    { "type": "humidity", "val": 45 },
    { "type": "temperature", "val": 21.8 }
  ]
}
```
* **Path**: `readings.1.val`
* **Resolved**: `21.8`

### 4. Automatic Value Coercion (`coerceValue`)

Extracted values are coerced into typed primitives (`number`, `boolean`, or `string`) based on content:

* **Booleans**: Case-insensitive matches for `"true"`, `"on"`, `"yes"`, `"online"` coerce to `true`. Matches for `"false"`, `"off"`, `"no"`, `"offline"` coerce to `false`.
* **Numbers**: Strings that parse cleanly to valid floating-point numbers without trailing units coerce to `number`.
* **Objects/Arrays**: Complex structures that cannot be rendered directly as a scalar are serialized as JSON strings to avoid rendering `[object Object]`.

---

## Read vs. Write Shape Separation

Many IoT devices use separate topics and payload structures for commands versus status reporting:

```
[ Dashboard Panel ]
        |
        |  1. Publish Command (writeTemplate)
        v  Topic: "shellies/shellyswitch25-ABC/relay/0/command"
[ Mosquitto Broker ]
        |  Payload: "on"
        v
[ Shelly 2.5 Relay ]
        |
        |  2. Broadcast Telemetry (readTemplate)
        v  Topic: "shellies/shellyswitch25-ABC/relay/0"
[ Dashboard Panel ]
           Payload: {"ison": true, "has_timer": false}
```

### Configuration Model

Panels support enabling separate read and write shapes:
- **`payloadTemplate`**: Defines what the panel publishes (and defaults to the read template if separate read is disabled).
- **`separateRead`** (`boolean`): Toggles asymmetric payload definitions.
- **`readTemplate`**: Defines how the panel extracts state from incoming messages when `separateRead` is `true`.

When `separateRead` is `false`, the system uses [`deriveReadPath()`](../frontend/src/components/panels/payloadShape.ts) to automatically extract the read path from the write template's `{value}` position. For example, configuring `{"power":{"state":"{value}"}}` automatically configures the read path to `power.state`.

---

## Real-World Device Examples

### 1. Zigbee2MQTT (Smart Plug / Bulb)

* **Publish Topic**: `zigbee2mqtt/kitchen_light/set`
* **Subscribe Topic**: `zigbee2mqtt/kitchen_light`
* **Separate Read**: Enabled

**Toggle Panel**:
* **Write Template**: `{"state": "{value}"}`
* **On/Off Values**: `ON` / `OFF`
* **Read Template**: `{"state": "{value}"}`

**Slider Panel (Brightness)**:
* **Write Template**: `{"brightness": {value}}`
* **Range**: `0` to `254`
* **Read Template**: `{"brightness": {value}}`

---

### 2. Tasmota (Sonoff Switch)

* **Publish Topic**: `cmnd/tasmota_livingroom/POWER`
* **Subscribe Topic**: `stat/tasmota_livingroom/POWER`
* **Separate Read**: Enabled

**Toggle Panel**:
* **Write Template**: `{value}` (bare token)
* **On/Off Values**: `ON` / `OFF`
* **Read Template**: `{value}` (or empty for whole payload)

**Energy Monitoring Telemetry**:
* **Subscribe Topic**: `tele/tasmota_livingroom/SENSOR`
* **Incoming Payload**:
  ```json
  {
    "Time": "2026-09-20T12:00:00",
    "ENERGY": {
      "Total": 14.52,
      "Yesterday": 1.23,
      "Today": 0.45,
      "Power": 125,
      "Voltage": 230
    }
  }
  ```
* **Gauge Panel (Current Power)**:
  * **Read Template**: `{"ENERGY": {"Power": {value}}}` (or dot path `ENERGY.Power`)

---

### 3. Shelly (Gen 1 & Gen 2)

#### Shelly Gen 1 (e.g., Shelly 1 / 2.5 Relay)
* **Command Topic**: `shellies/shelly1-A1B2C3/relay/0/command`
* **Command Payload**: `on` or `off` (bare token `{value}`)
* **Status Topic**: `shellies/shelly1-A1B2C3/relay/0`
* **Status Payload**: `on` or `off`

#### Shelly Gen 2+ (RPC over MQTT)
* **Command Topic**: `shellyplus1-a1b2c3/rpc`
* **Command Payload**:
  ```json
  {"id": 1, "src": "mqtt-dash", "method": "Switch.Set", "params": {"id": 0, "on": {value}}}
  ```
* **Status Topic**: `shellyplus1-a1b2c3/status/switch:0`
* **Status Payload**:
  ```json
  {"id": 0, "output": true, "source": "MQTT"}
  ```
* **Read Template**: `{"output": {value}}` (or dot path `output`)

---

## Troubleshooting & Verification

The [`PanelConfigModal`](../frontend/src/components/panels/config/PanelConfigModal.tsx) provides a live **Preview Box** displaying:
1. **Raw Message**: The last received message from the broker on the chosen topic.
2. **Extracted Value**: The coerced value produced by applying the current template.
3. **Match Status**:
   - `Found`: The stencil or dot path successfully resolved to a scalar value.
   - `Did not match`: The message structure does not match the configured template.
