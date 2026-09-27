# Panel Architecture & Developer Guide

This guide describes the panel architecture in MQTT Dashboard and provides a complete, step-by-step tutorial for building, styling, and registering a new panel type.

---

## Architecture Overview

Panels in MQTT Dashboard are modular, pluggable components. Every panel encapsulates:
1. **Runtime Visualization (`Component`)**: Renders live telemetry or interactive controls within the dashboard grid.
2. **Configuration Modal (`ConfigModal`)**: Provides the editing interface for broker bindings, topic paths, payload shapes, and display preferences.
3. **Definition (`PanelDefinition<TConfig>`)**: Declares sizing defaults, category, layout constraints, validation rules, and lifecycle hooks.

```
                    Panel Registration
              (frontend/src/components/panels/)
                            |
         +------------------+------------------+
         |                                     |
         v                                     v
+------------------+                 +-------------------+
|  definitions.tsx |                 |    registry.ts    |
| (Panel manifests)|                 | (Panel registry)  |
+------------------+                 +-------------------+
         |
         | provides
         v
+--------------------------------------------------------+
|                 PanelDefinition<TConfig>               |
|                                                        |
|  - type, label, category, icon                         |
|  - defaultSize, getMinMaxConstraints                   |
|  - validateConfig, isEmpty, getHeaderMeta              |
|  - Component: ComponentType<PanelRenderProps<TConfig>> |
|  - ConfigModal: ComponentType<PanelConfigModalProps>   |
+--------------------------------------------------------+
```

---

## The `PanelDefinition<TConfig>` Interface

Defined in [`frontend/src/components/panels/types.ts`](../frontend/src/components/panels/types.ts):

```typescript
export interface PanelDefinition<TConfig = any> {
  type: string;                    // Unique identifier (e.g. "gauge", "button", "custom_status")
  label: string;                   // Display title in panel picker
  category: "monitor" | "control" | "visual";
  icon: ComponentType<{ size?: number; className?: string }>;

  // Sizing & Grid Constraints
  defaultSize?: { w: number; h: number };
  getMinMaxConstraints?: (config: TConfig) => {
    minW?: number; minH?: number;
    maxW?: number; maxH?: number;
  };
  adjustSizeForConfig?: (config: TConfig, size: { w: number; h: number }) => { w: number; h: number } | null;

  // Validation & Health
  isVisual?: boolean;              // True for non-MQTT panels (Markdown, Separator)
  validateConfig?: (config: TConfig) => ValidationResult;
  isEmpty?: (config: TConfig) => boolean | string | EmptyStateInfo | null;

  // Header & Meta
  getHeaderMeta?: (config: TConfig) => Partial<PanelHeaderMeta>;
  resolvePickedTopic?: (existingTopic?: string, pickedTopic?: string) => string | undefined;

  // Lifecycle
  onSaveConfig?: (panelId: string, config: TConfig, brokerId: string) => Promise<void> | void;

  // React Components
  Component: ComponentType<PanelRenderProps<TConfig>>;
  ConfigModal: ComponentType<PanelConfigModalProps<TConfig>>;
}
```

### Component Props (`PanelRenderProps<TConfig>`)

The panel runtime receives:
- **`panelId`** (`string`): Unique UUID for the panel instance in `dashboard_layouts`.
- **`brokerId`** (`string`): Configured broker ID for this panel.
- **`config`** (`TConfig`): Typed configuration JSON stored for this panel.
- **`onConfigChange`** (`(newConfig: Partial<TConfig>) => void`): Optional callback to persist runtime UI state (e.g., collapsed view).

### Config Modal Props (`PanelConfigModalProps<TConfig>`)

The modal receives:
- **`config`** (`TConfig`): Current panel configuration.
- **`brokerId`** (`string`): Currently selected broker.
- **`brokerStatuses`** (`BrokerStatus[]`): Live status of all available brokers.
- **`onSave`** (`(config: TConfig, brokerId: string) => void`): Persists changes and closes the modal.
- **`onClose`** (`() => void`): Closes modal without saving.
- **`onPickTopic`**: Callback opening the topic tree explorer to auto-fill topic fields.

---

## Standard Configuration Components

All panel configuration modals share standardized UI primitives located in [`frontend/src/components/panels/config/`](../frontend/src/components/panels/config/):

| Component | Purpose |
|---|---|
| [`PanelConfigModal`](../frontend/src/components/panels/config/PanelConfigModal.tsx) | Base modal shell with header, live message preview, and Save/Cancel footer actions. |
| [`BrokerTopicCard`](../frontend/src/components/panels/config/BrokerTopicCard.tsx) | Combined broker selector and topic input with integrated topic explorer picker. |
| [`ConfigCard`](../frontend/src/components/panels/config/ConfigCard.tsx) | Card container with title and optional icon for grouping related fields. |
| [`FieldRow`](../frontend/src/components/panels/config/FieldRow.tsx) | Labeled form row with tooltip (`data-tip`) and flexible layout. |
| [`SwitchRow`](../frontend/src/components/panels/config/SwitchRow.tsx) | DaisyUI toggle switch with title and subtitle description. |
| [`PayloadBuilder`](../frontend/src/components/panels/config/PayloadBuilder.tsx) | Interactive write/read payload template editor with token insertion chips. |
| [`ChoiceCards`](../frontend/src/components/panels/config/ChoiceCards.tsx) | Grid of selectable visual cards for enumerated settings (e.g. orientations, styles). |
| [`DisclosureCard`](../frontend/src/components/panels/config/DisclosureCard.tsx) | Collapsible section for optional or advanced settings. |

---

## Validation Engine (`useConfigValidation`)

Panel validation ensures users do not save broken configurations (e.g., publishing commands to wildcard topics or leaving required topics empty).

The [`useConfigValidation`](../frontend/src/components/panels/config/useConfigValidation.ts) hook provides out-of-the-box rule builders:

```typescript
import { useConfigValidation, topicRules, payloadRules, brokerRules } from "./config/useConfigValidation";

const validation = useConfigValidation(
  [
    brokerRules.required(brokerId, brokerStatuses),
    topicRules.required(topic),
    topicRules.noWildcards(topic, "Command topic"),
    payloadRules.hasTokenIfAccepts(payloadTemplate, true),
  ],
  [brokerId, topic, payloadTemplate],
);

// validation.isValid -> disables Save button if false
// validation.firstError -> displays warning in modal header
```

---

## Design Principles & Best Practices

When building panels, adhere to the architectural rules defined in [`AGENTS.md`](../AGENTS.md):

1. **Avoid Cascading `useEffect` Renders**:
   - Never call `setState` synchronously inside `useEffect` to duplicate or synchronize state.
   - Compute derived state inline during render:
     ```typescript
     // GOOD: Derived state
     const numericValue = typeof rawValue === "number" ? rawValue : parseFloat(rawValue) || 0;

     // BAD: Duplicated state inside effect
     const [numericValue, setNumericValue] = useState(0);
     useEffect(() => { setNumericValue(parseFloat(rawValue)); }, [rawValue]);
     ```

2. **Icon-Driven, Compact Aesthetic**:
   - Use compact tables, monospace snippets for topics/payloads, and subtle badges.
   - Rely on intuitive icons and DaisyUI `tooltip` (`data-tip`) instead of explanatory text walls.
   - Consistent icons: Brokers (`RiServerLine`), Topics (`RiHashtag`), Automations (`MdAutoMode`), Timing (`MdSchedule`).

3. **Color & Theme Tokens**:
   - Always use DaisyUI semantic color tokens (`primary`, `accent`, `neutral`, `base-100`, `base-200`, `base-300`, `success`, `warning`, `error`).
   - Never hardcode hex colors or arbitrary Tailwind RGB values.

---

## Step-by-Step Tutorial: Building a New Panel

In this tutorial, we will build a **Status Indicator Panel** (`status_indicator`) that listens to an MQTT topic and displays a green/yellow/red status dot with a label.

### Step 1: Define Config Interface & Defaults

Create `frontend/src/components/panels/StatusIndicatorPanel.tsx`:

```tsx
import React, { useState } from "react";
import type { PanelRenderProps, PanelConfigModalProps } from "./types";
import { useWebSocket } from "../../hooks/useWebSocket";
import { readValue } from "./payloadShape";
import {
  PanelConfigModal,
  ConfigCard,
  BrokerTopicCard,
  FieldRow,
  useConfigValidation,
  topicRules,
} from "./config";

export interface StatusIndicatorConfig {
  topic?: string;
  payloadTemplate?: string;
  okValue?: string;
  warnValue?: string;
  label?: string;
}

export const DEFAULT_STATUS_CONFIG: StatusIndicatorConfig = {
  topic: "",
  payloadTemplate: "{value}",
  okValue: "OK",
  warnValue: "WARN",
  label: "System Status",
};
```

### Step 2: Implement the Runtime Component

```tsx
export default function StatusIndicatorPanel({
  brokerId,
  config,
}: PanelRenderProps<StatusIndicatorConfig>) {
  const [currentVal, setCurrentVal] = useState<string>("WAITING");

  useWebSocket({
    onMessage: (rawMessage) => {
      try {
        const parsed = JSON.parse(rawMessage);
        if (parsed.broker_id === brokerId && parsed.topic === config.topic) {
          const extracted = readValue(config.payloadTemplate, parsed.payload);
          setCurrentVal(String(extracted.value));
        }
      } catch {
        // Ignore malformed frames
      }
    },
  });

  // Derived status color
  const statusColor =
    currentVal === (config.okValue ?? "OK")
      ? "bg-success"
      : currentVal === (config.warnValue ?? "WARN")
      ? "bg-warning"
      : "bg-error";

  return (
    <div className="flex flex-col items-center justify-center h-full p-4 gap-2">
      <div className={`w-6 h-6 rounded-full shadow-md animate-pulse ${statusColor}`} />
      <span className="text-xs font-semibold text-base-content/70 uppercase tracking-wide">
        {config.label || "Status"}
      </span>
      <span className="font-mono text-sm font-bold">{currentVal}</span>
    </div>
  );
}
```

### Step 3: Implement the Configuration Modal

```tsx
export function StatusIndicatorConfigModal({
  config: initialConfig,
  brokerId: initialBrokerId,
  brokerStatuses,
  onSave,
  onClose,
  onPickTopic,
}: PanelConfigModalProps<StatusIndicatorConfig>) {
  const [brokerId, setBrokerId] = useState(initialBrokerId);
  const [config, setConfig] = useState<StatusIndicatorConfig>({
    ...DEFAULT_STATUS_CONFIG,
    ...initialConfig,
  });

  const validation = useConfigValidation(
    [topicRules.required(config.topic)],
    [config.topic],
  );

  return (
    <PanelConfigModal
      title="Configure Status Indicator"
      isValid={validation.isValid}
      onSave={() => onSave(config, brokerId)}
      onClose={onClose}
    >
      <BrokerTopicCard
        brokerId={brokerId}
        brokerStatuses={brokerStatuses}
        topic={config.topic ?? ""}
        onBrokerChange={setBrokerId}
        onTopicChange={(t) => setConfig((prev) => ({ ...prev, topic: t }))}
        onPickTopic={() =>
          onPickTopic?.({
            currentTopic: config.topic ?? "",
            selectedBrokerId: brokerId,
          })
        }
      />

      <ConfigCard title="Status Mapping">
        <FieldRow label="Label" tooltip="Text displayed beneath the indicator">
          <input
            type="text"
            className="input input-sm input-bordered w-full"
            value={config.label ?? ""}
            onChange={(e) => setConfig((prev) => ({ ...prev, label: e.target.value }))}
          />
        </FieldRow>
        <FieldRow label="OK Value" tooltip="Incoming payload that indicates Healthy state">
          <input
            type="text"
            className="input input-sm input-bordered font-mono w-full"
            value={config.okValue ?? ""}
            onChange={(e) => setConfig((prev) => ({ ...prev, okValue: e.target.value }))}
          />
        </FieldRow>
      </ConfigCard>
    </PanelConfigModal>
  );
}
```

### Step 4: Register Panel in `definitions.tsx`

Open [`frontend/src/components/panels/definitions.tsx`](../frontend/src/components/panels/definitions.tsx) and register the new panel definition:

```tsx
import { MdCheckCircle } from "react-icons/md";
import StatusIndicatorPanel, {
  StatusIndicatorConfigModal,
  type StatusIndicatorConfig,
} from "./StatusIndicatorPanel";

export const statusIndicatorPanelDef: PanelDefinition<StatusIndicatorConfig> = {
  type: "status_indicator",
  label: "Status Indicator",
  category: "monitor",
  icon: MdCheckCircle,
  defaultSize: { w: 3, h: 3 },
  getMinMaxConstraints: () => ({ minW: 2, minH: 2 }),
  validateConfig: (config) => ({
    isValid: Boolean(config.topic?.trim()),
    warning: !config.topic?.trim() ? "No topic configured" : null,
  }),
  Component: StatusIndicatorPanel,
  ConfigModal: StatusIndicatorConfigModal,
};

// Register into the global catalog
registerPanel(statusIndicatorPanelDef);
```

The new panel is now automatically available in the Add Panel modal, grid layout serializer, and export/import engine!
