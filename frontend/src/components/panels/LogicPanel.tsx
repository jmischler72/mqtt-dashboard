import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { RiAddLine, RiCloseLine, RiTimeLine } from "react-icons/ri";
import { MdAutoMode } from "react-icons/md";
import { api } from "../../api/client";
import { useWebSocket } from "../../hooks/useWebSocket";
import type { BrokerStatus } from "../../hooks/useBrokers";
import { usePanelSize } from "../../hooks/usePanelSize";
import {
  BrokerTopicCard,
  ChoiceCards,
  ConfigCard,
  ConfigGroup,
  DisclosureCard,
  FieldRow,
  PanelConfigModal,
  PayloadBuilder,
  PayloadSummary,
  PublishOptionsCard,
  SwitchRow,
  brokerPresence,
  brokerRules,
  defaultBrokerId,
  useConfigValidation,
  type Choice,
} from "./config";
import {
  OPERATORS,
  formatConditionSummary,
  formatTimeAgo,
  mqttTopicMatches,
  extractTrackedValue,
  evaluateClientCondition,
  evaluateAllConditions,
  type Condition,
  type LogicMode,
  type LogicOperator,
  type RuleStatus,
} from "./logicUtils";
import { VALUE_TOKEN, deriveReadPath } from "./payloadShape";

const MODE_CHOICES: Choice<LogicMode>[] = [
  {
    id: "on_change",
    label: "On Change",
    preview: (
      <div className="flex flex-col items-center justify-center gap-1 text-[11px] font-mono text-center">
        <span className="text-base-content/50">false → true</span>
        <span className="badge badge-xs badge-primary">fire once</span>
      </div>
    ),
  },
  {
    id: "every",
    label: "Every Match",
    preview: (
      <div className="flex flex-col items-center justify-center gap-1 text-[11px] font-mono text-center">
        <span className="text-base-content/50">each msg</span>
        <span className="badge badge-xs badge-info">fire all</span>
      </div>
    ),
  },
  {
    id: "count",
    label: "Count Hits",
    preview: (
      <div className="flex flex-col items-center justify-center gap-1 text-[11px] font-mono text-center">
        <span className="text-base-content/50">N in window</span>
        <span className="badge badge-xs badge-accent">burst</span>
      </div>
    ),
  },
  {
    id: "sustained",
    label: "Sustained",
    preview: (
      <div className="flex flex-col items-center justify-center gap-1 text-[11px] font-mono text-center">
        <span className="text-base-content/50">true for Xs</span>
        <span className="badge badge-xs badge-warning">delay</span>
      </div>
    ),
  },
];

export interface LogicConfig {
  source_topic?: string;
  source_broker_id?: string;
  match?: "all" | "any";
  conditions?: Condition[];
  mode?: LogicMode;
  count?: number;
  window_sec?: number;
  sustained_sec?: number;
  target_topic?: string;
  target_broker_id?: string;
  payload?: string;
  qos?: number;
  retain?: boolean;
  cooldown_sec?: number;
  self_guard?: boolean;
  enabled?: boolean;
  _picking?: string; // transient picker routing marker
}

interface LogicConfigModalProps {
  config: LogicConfig;
  brokerId: string;
  brokerStatuses: BrokerStatus[];
  onSave: (cfg: LogicConfig, brokerId: string) => void;
  onClose: () => void;
  onPickTopic?: (options: {
    currentTopic: string;
    selectedBrokerId: string;
    draftConfig?: unknown;
  }) => void;
  initialTopic?: string;
  initialBrokerId?: string;
}

export function LogicConfigModal({
  config,
  brokerId,
  brokerStatuses,
  onSave,
  onClose,
  onPickTopic,
  initialTopic,
  initialBrokerId,
}: LogicConfigModalProps) {
  const fallbackBroker = defaultBrokerId(brokerStatuses);

  // Stashed topic picker routing target
  const pickingTarget = config._picking;

  const [sourceBrokerId, setSourceBrokerId] = useState(
    brokerId || config.source_broker_id || fallbackBroker,
  );

  const match = config.match ?? "all";

  const [conditions, setConditions] = useState<Condition[]>(() => {
    let list = config.conditions ? [...config.conditions] : [];
    if (list.length === 0) {
      list = [
        {
          operator: "gt",
          value: "30",
          json_path: "",
          read_template: "",
          topic: config.source_topic ?? "",
          broker_id: config.source_broker_id ?? "",
        },
      ];
    } else if (!list[0].topic && config.source_topic) {
      list[0] = {
        ...list[0],
        topic: config.source_topic,
        broker_id: list[0].broker_id || config.source_broker_id || "",
      };
    }

    if (pickingTarget?.startsWith("cond:") && initialTopic !== undefined) {
      const idx = parseInt(pickingTarget.replace("cond:", ""), 10);
      if (!isNaN(idx) && list[idx]) {
        list[idx] = {
          ...list[idx],
          topic: initialTopic,
          broker_id: initialBrokerId || list[idx].broker_id,
        };
      }
    } else if (pickingTarget === "source" && initialTopic !== undefined) {
      if (list[0]) {
        list[0] = {
          ...list[0],
          topic: initialTopic,
          broker_id: initialBrokerId || list[0].broker_id,
        };
      }
    }
    return list;
  });

  const [mode, setMode] = useState<LogicMode>(config.mode ?? "on_change");
  const [count, setCount] = useState<number>(config.count ?? 5);
  const [windowSec, setWindowSec] = useState<number>(config.window_sec ?? 60);
  const [sustainedSec, setSustainedSec] = useState<number>(
    config.sustained_sec ?? 10,
  );

  const [targetTopic, setTargetTopic] = useState(
    pickingTarget === "target"
      ? (initialTopic ?? config.target_topic ?? "")
      : (config.target_topic ?? ""),
  );
  const [targetBrokerId, setTargetBrokerId] = useState(
    pickingTarget === "target"
      ? initialBrokerId || config.target_broker_id || sourceBrokerId
      : config.target_broker_id || "",
  );

  const [payload, setPayload] = useState(() =>
    (config.payload ?? "").replace(/\{\{value\}\}/g, VALUE_TOKEN),
  );
  const [qos, setQos] = useState(config.qos ?? 0);
  const [retain, setRetain] = useState(config.retain ?? false);
  const [cooldownSec, setCooldownSec] = useState(config.cooldown_sec ?? 0);
  const [enabled, setEnabled] = useState(config.enabled ?? false);

  const primaryTopic = conditions[0]?.topic?.trim() || "";
  const primaryBrokerId =
    conditions[0]?.broker_id || sourceBrokerId || fallbackBroker;

  // Helper to construct draft for topic picker navigation
  const draft = (picking: string): LogicConfig => ({
    source_topic: primaryTopic,
    source_broker_id: primaryBrokerId,
    match,
    conditions,
    mode,
    count,
    window_sec: windowSec,
    sustained_sec: sustainedSec,
    target_topic: targetTopic,
    target_broker_id: targetBrokerId,
    payload,
    qos,
    retain,
    cooldown_sec: cooldownSec,
    enabled,
    _picking: picking,
  });

  // Validation rules
  const trimmedTarget = targetTopic.trim();
  const targetHasWildcards =
    trimmedTarget.includes("+") || trimmedTarget.includes("#");

  const effectiveTargetBroker = targetBrokerId || primaryBrokerId;
  const loopConflict = conditions.some((c) => {
    const cTopic = c.topic?.trim() || primaryTopic;
    const cBroker = c.broker_id || primaryBrokerId;
    if (
      effectiveTargetBroker === cBroker &&
      cTopic &&
      trimmedTarget &&
      trimmedTarget.split(",").some((t) => mqttTopicMatches(cTopic, t.trim()))
    ) {
      return true;
    }
    return false;
  });

  const invalidNumericCondition = conditions.find((c) => {
    if (["gt", "lt", "gte", "lte"].includes(c.operator)) {
      return isNaN(Number(c.value?.trim()));
    }
    return false;
  });

  const { fieldErrors, blockerReason } = useConfigValidation([
    ...brokerRules(brokerStatuses.length),
    {
      field: "conditions",
      when: !primaryTopic,
      message: "Condition 1 requires a topic",
    },
    {
      field: "target_topic",
      when: !trimmedTarget,
      message: "Target topic is required",
    },
    {
      field: "target_topic",
      when: targetHasWildcards,
      message: "Cannot publish to wildcard topics (+ or #)",
    },
    {
      field: "target_topic",
      when: Boolean(loopConflict),
      message: "Target topic cannot match condition topic (infinite loop)",
    },
    {
      field: "conditions",
      when: Boolean(invalidNumericCondition),
      message: "Numeric operators require a numeric value",
    },
  ]);

  const handleAddCondition = () => {
    setConditions((prev) => [
      ...prev,
      {
        operator: "gt",
        value: "30",
        json_path: "",
        read_template: "",
        topic: "",
        broker_id: "",
        join: prev.length > 0 ? "and" : undefined,
      },
    ]);
  };

  const handleRemoveCondition = (index: number) => {
    setConditions((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== index);
      if (next.length > 0 && next[0].join !== undefined) {
        next[0] = { ...next[0], join: undefined };
      }
      return next;
    });
  };

  const handleConditionChange = (index: number, patch: Partial<Condition>) => {
    setConditions((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  };

  const handleSave = () => {
    if (blockerReason) return;
    const finalConfig: LogicConfig = {
      source_topic: primaryTopic,
      source_broker_id: primaryBrokerId,
      match,
      conditions,
      mode,
      count: mode === "count" ? Number(count) : undefined,
      window_sec: mode === "count" ? Number(windowSec) : undefined,
      sustained_sec: mode === "sustained" ? Number(sustainedSec) : undefined,
      target_topic: trimmedTarget,
      target_broker_id: targetBrokerId || undefined,
      payload,
      qos,
      retain,
      cooldown_sec: Number(cooldownSec),
      enabled,
    };
    onSave(finalConfig, primaryBrokerId);
    onClose();
  };

  return (
    <PanelConfigModal
      icon={MdAutoMode}
      title="Configure Logic Rule"
      brokerStatus={brokerPresence(brokerStatuses, primaryBrokerId)}
      onSave={handleSave}
      onCancel={onClose}
      blockerReason={blockerReason}
    >
      <ConfigGroup heading="Read">
        <ConfigCard title="Conditions" summary="Evaluated in order">
          {conditions.length === 0 ? (
            <div className="text-xs text-base-content/50 italic py-2">
              No conditions set — triggers on every message.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {conditions.map((cond, idx) => (
                <div key={idx} className="flex flex-col gap-2">
                  {idx > 0 && (
                    <div className="flex items-center justify-center my-0.5">
                      <div className="join border border-base-300 dark:border-base-100 rounded-md bg-base-100 shadow-xs">
                        <button
                          type="button"
                          className={`btn btn-xs join-item px-3 h-6 min-h-6 text-[10px] font-bold tracking-wider ${
                            (cond.join ?? "and") === "and"
                              ? "btn-primary text-primary-content"
                              : "btn-ghost text-base-content/50 hover:text-base-content"
                          }`}
                          onClick={() =>
                            handleConditionChange(idx, { join: "and" })
                          }
                        >
                          AND
                        </button>
                        <button
                          type="button"
                          className={`btn btn-xs join-item px-3 h-6 min-h-6 text-[10px] font-bold tracking-wider ${
                            cond.join === "or"
                              ? "btn-secondary text-secondary-content"
                              : "btn-ghost text-base-content/50 hover:text-base-content"
                          }`}
                          onClick={() =>
                            handleConditionChange(idx, { join: "or" })
                          }
                        >
                          OR
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-base-300 dark:border-base-100 p-3 bg-base-200/40 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-mono text-base-content/70 font-semibold">
                          Condition #{idx + 1}
                        </span>
                      </div>
                      {conditions.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-circle text-error"
                          onClick={() => handleRemoveCondition(idx)}
                          title="Remove condition"
                        >
                          <RiCloseLine size={14} />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 items-end">
                      <div className="form-control">
                        <label className="label py-0.5">
                          <span className="label-text text-[10.5px]">
                            Operator
                          </span>
                        </label>
                        <select
                          value={cond.operator}
                          onChange={(e) =>
                            handleConditionChange(idx, {
                              operator: e.target.value as LogicOperator,
                            })
                          }
                          className="select select-xs select-bordered text-[11px] w-full"
                        >
                          {OPERATORS.map((op) => (
                            <option key={op.value} value={op.value}>
                              {op.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {cond.operator !== "exists" && cond.operator !== "any" ? (
                        <div className="form-control">
                          <label className="label py-0.5">
                            <span className="label-text text-[10.5px]">
                              Value
                            </span>
                          </label>
                          <input
                            type="text"
                            placeholder="expected value"
                            value={cond.value ?? ""}
                            onChange={(e) =>
                              handleConditionChange(idx, {
                                value: e.target.value,
                              })
                            }
                            className="input input-xs input-bordered font-mono text-[11px] w-full"
                          />
                        </div>
                      ) : (
                        <div className="text-[11px] text-base-content/40 self-center pb-1">
                          {cond.operator === "exists"
                            ? "Matches when field exists"
                            : "Always matches"}
                        </div>
                      )}
                    </div>

                    <BrokerTopicCard
                      key={`broker-topic-${idx}`}
                      brokers={brokerStatuses}
                      brokerId={cond.broker_id || primaryBrokerId}
                      onBrokerChange={(b) => {
                        handleConditionChange(idx, {
                          broker_id:
                            idx === 0 ? b : b === primaryBrokerId ? "" : b,
                        });
                        if (idx === 0) {
                          setSourceBrokerId(b);
                        }
                      }}
                      topic={cond.topic ?? ""}
                      onTopicChange={(t) =>
                        handleConditionChange(idx, {
                          topic: t,
                        })
                      }
                      topicPlaceholder={
                        idx === 0
                          ? "e.g. home/living-room/temperature"
                          : `Same as condition 1 (${conditions[0]?.topic || "topic"})`
                      }
                      topicError={
                        idx === 0 &&
                        !cond.topic?.trim() &&
                        fieldErrors.conditions
                          ? "Topic is required"
                          : undefined
                      }
                      help={
                        idx === 0
                          ? "Wildcards (+, #) supported. Evaluates rule on incoming messages."
                          : "Leave empty to use condition 1's topic."
                      }
                      onExplore={
                        onPickTopic
                          ? () =>
                              onPickTopic({
                                currentTopic:
                                  cond.topic ??
                                  (idx === 0
                                    ? ""
                                    : (conditions[0]?.topic ?? "")),
                                selectedBrokerId:
                                  cond.broker_id || primaryBrokerId,
                                draftConfig: draft(`cond:${idx}`),
                              })
                          : undefined
                      }
                    />

                    <DisclosureCard
                      title="Value"
                      summary={
                        <PayloadSummary
                          value={cond.read_template || cond.json_path || ""}
                          empty="whole payload"
                        />
                      }
                      defaultOpen={false}
                    >
                      <PayloadBuilder
                        mode="read"
                        value={cond.read_template || cond.json_path || ""}
                        onChange={(next) => {
                          const derived = deriveReadPath(next);
                          handleConditionChange(idx, {
                            read_template: next,
                            json_path:
                              derived ??
                              (next.startsWith("{") || next.startsWith("[")
                                ? ""
                                : next),
                          });
                        }}
                        brokerId={cond.broker_id || primaryBrokerId}
                        topic={cond.topic || primaryTopic}
                        allowBlankShape
                        placeholder={`whole payload, or {"temp":${VALUE_TOKEN}}`}
                      />
                    </DisclosureCard>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2.5">
            <button
              type="button"
              className="btn btn-outline btn-xs gap-1"
              onClick={handleAddCondition}
            >
              <RiAddLine size={13} /> Add condition
            </button>
          </div>
        </ConfigCard>

        {/* Trigger Mode */}
        <ConfigCard title="Trigger Mode">
          <ChoiceCards
            options={MODE_CHOICES}
            value={mode}
            onChange={(m) => setMode(m)}
          />

          {mode === "count" && (
            <div className="grid grid-cols-2 gap-3 mt-3 pt-2 border-t border-base-300 dark:border-base-100">
              <FieldRow label="Required Matches" help="Hits needed to fire">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="input input-xs input-bordered w-20 text-center font-mono"
                />
              </FieldRow>
              <FieldRow label="Time Window (sec)" help="Window duration">
                <input
                  type="number"
                  min={1}
                  max={86400}
                  value={windowSec}
                  onChange={(e) => setWindowSec(Number(e.target.value))}
                  className="input input-xs input-bordered w-20 text-center font-mono"
                />
              </FieldRow>
            </div>
          )}

          {mode === "sustained" && (
            <div className="mt-3 pt-2 border-t border-base-300 dark:border-base-100">
              <FieldRow
                label="Sustained Duration (sec)"
                help="Condition must remain true for this long before firing"
              >
                <input
                  type="number"
                  min={1}
                  max={86400}
                  value={sustainedSec}
                  onChange={(e) => setSustainedSec(Number(e.target.value))}
                  className="input input-xs input-bordered w-24 text-center font-mono"
                />
              </FieldRow>
            </div>
          )}
        </ConfigCard>
      </ConfigGroup>

      {/* 3. THEN (Action to publish) */}
      <ConfigGroup heading="Publish">
        <BrokerTopicCard
          topic={targetTopic}
          onTopicChange={setTargetTopic}
          brokerId={targetBrokerId || sourceBrokerId}
          onBrokerChange={setTargetBrokerId}
          brokers={brokerStatuses}
          topicError={fieldErrors.target_topic}
          help="Target topic cannot contain wildcards or match the trigger topic."
          onExplore={
            onPickTopic
              ? () =>
                  onPickTopic({
                    currentTopic: targetTopic,
                    selectedBrokerId: targetBrokerId || sourceBrokerId,
                    draftConfig: draft("target"),
                  })
              : undefined
          }
        />

        <DisclosureCard
          title="Message"
          summary={<PayloadSummary value={payload} />}
          defaultOpen={payload.trim() === ""}
        >
          <PayloadBuilder
            mode="write"
            value={payload}
            onChange={setPayload}
            brokerId={targetBrokerId || sourceBrokerId}
            topic={targetTopic}
            previewValue={conditions[0]?.value || "ON"}
            placeholder={`{"state":${VALUE_TOKEN}}`}
          />
        </DisclosureCard>

        <PublishOptionsCard
          qos={qos}
          onQosChange={setQos}
          retain={retain}
          onRetainChange={setRetain}
        />

        <ConfigCard title="Safety & State">
          <FieldRow
            label="Cooldown (seconds)"
            help="Minimum quiet time between fires"
          >
            <input
              type="number"
              min={0}
              max={86400}
              value={cooldownSec}
              onChange={(e) => setCooldownSec(Number(e.target.value))}
              className="input input-xs input-bordered w-20 text-center font-mono"
            />
          </FieldRow>

          <SwitchRow
            name="Rule Enabled"
            note="Run this automation rule actively. The configuration is kept either way."
            on={enabled}
            onToggle={setEnabled}
          />
        </ConfigCard>
      </ConfigGroup>
    </PanelConfigModal>
  );
}

function renderPayloadPreview(payload?: string) {
  if (!payload || payload.trim() === "") {
    return <span className="text-base-content/40 italic">(no payload)</span>;
  }
  // Matches {value}, {{value}}, {val}, {{val}}
  const tokenRegex = /(?:\{\{|\{)(?:value|val)(?:\}\}|\})/g;
  const parts = payload.split(tokenRegex);

  return (
    <span className="font-mono text-xs truncate">
      {parts.map((part, idx) => (
        <span key={idx}>
          {idx > 0 && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-full border border-primary/40 bg-primary/20 text-primary font-mono text-[10.5px] font-semibold leading-none align-middle select-none"
              title="Value from trigger condition"
            >
              value
            </span>
          )}
          {part}
        </span>
      ))}
    </span>
  );
}

interface LogicPanelProps {
  panelId: string;
  brokerId?: string;
  config: LogicConfig;
  onConfigChange?: (cfg: Partial<LogicConfig>) => void;
}

export default function LogicPanel({
  panelId,
  brokerId,
  config,
  onConfigChange,
}: LogicPanelProps) {
  const { ref: containerRef, size } = usePanelSize<HTMLDivElement>();
  const [status, setStatus] = useState<RuleStatus | null>(null);
  const [toggling, setToggling] = useState(false);
  const [payloadCache, setPayloadCache] = useState<Record<string, string>>({});
  const [pulse, setPulse] = useState(false);

  const conditions = useMemo(
    () => config.conditions ?? [],
    [config.conditions],
  );
  const firstCond = conditions[0];
  const primaryTopic =
    firstCond?.topic?.trim() || config.source_topic?.trim() || "";
  const primaryBroker =
    firstCond?.broker_id || config.source_broker_id || brokerId || "";

  const fetchStatus = useCallback(() => {
    api
      .get<RuleStatus>(`/api/logic/${panelId}`)
      .then((res) => {
        if (res) setStatus(res);
      })
      .catch(() => {});
  }, [panelId]);

  // Periodic poll while enabled
  useEffect(() => {
    fetchStatus();
    if (!config.enabled) return;
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [config.enabled, fetchStatus]);

  // Fetch initial messages from explorer history for all condition topics
  useEffect(() => {
    const condList =
      conditions.length > 0
        ? conditions
        : [{ topic: config.source_topic, broker_id: config.source_broker_id }];

    let cancelled = false;

    for (const c of condList) {
      const top = c.topic?.trim() || primaryTopic;
      const bId = c.broker_id || primaryBroker;
      if (!top || !bId) continue;
      const key = `${bId}:${top}`;

      api
        .getExplorerHistory(bId, top)
        .then((records) => {
          if (cancelled || !records || records.length === 0) return;
          const sorted = [...records].sort(
            (a, b) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          );
          const last = sorted[0];
          if (last) {
            setPayloadCache((prev) => {
              if (prev[key] !== undefined) return prev;
              return { ...prev, [key]: last.payload };
            });
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [
    conditions,
    config.source_topic,
    config.source_broker_id,
    primaryTopic,
    primaryBroker,
  ]);

  // Live WebSocket updates across all condition topics
  const { subscribe } = useWebSocket({
    onMessage: (msgStr) => {
      try {
        const msg = JSON.parse(msgStr) as {
          topic: string;
          payload: string;
        };
        const condList =
          conditions.length > 0
            ? conditions
            : [
                {
                  topic: config.source_topic,
                  broker_id: config.source_broker_id,
                },
              ];

        let matched = false;
        for (const c of condList) {
          const top = c.topic?.trim() || primaryTopic;
          const bId = c.broker_id || primaryBroker;
          if (top && mqttTopicMatches(top, msg.topic)) {
            matched = true;
            const key = `${bId}:${top}`;
            setPayloadCache((prev) => ({ ...prev, [key]: msg.payload }));
          }
        }

        if (matched && config.enabled) {
          setTimeout(fetchStatus, 300);
        }
      } catch {
        // ignore malformed frame
      }
    },
  });

  useEffect(() => {
    const condList =
      conditions.length > 0
        ? conditions
        : [{ topic: config.source_topic, broker_id: config.source_broker_id }];

    const brokerTopics = new Map<string, Set<string>>();
    for (const c of condList) {
      const top = c.topic?.trim() || primaryTopic;
      const bId = c.broker_id || primaryBroker;
      if (top && bId) {
        if (!brokerTopics.has(bId)) brokerTopics.set(bId, new Set());
        brokerTopics.get(bId)!.add(top);
      }
    }

    for (const [bId, topicsSet] of brokerTopics.entries()) {
      subscribe({
        panel_id: panelId,
        broker_id: bId,
        topics: Array.from(topicsSet),
      });
    }
  }, [
    panelId,
    conditions,
    config.source_topic,
    config.source_broker_id,
    primaryTopic,
    primaryBroker,
    subscribe,
  ]);

  // Pulse effect when last_fired changes
  const lastFiredRef = useRef<string | undefined>(status?.last_fired);
  useEffect(() => {
    if (status?.last_fired && status.last_fired !== lastFiredRef.current) {
      lastFiredRef.current = status.last_fired;
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [status?.last_fired]);

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      await api.put(`/api/logic/${panelId}/toggle`, { enabled });
      onConfigChange?.({ ...config, enabled });
      fetchStatus();
    } catch {
      // ignore
    } finally {
      setToggling(false);
    }
  };

  const isConfigured = Boolean(primaryTopic && config.target_topic?.trim());

  if (!isConfigured) {
    return (
      <div className="flex items-center justify-center h-full text-base-content/40 text-xs p-2 text-center">
        No rule configured — open settings to configure logic
      </div>
    );
  }

  // Sizing & responsive toggle
  const availW = Math.max(80, (size.width || 260) - 16);
  const availH = Math.max(80, (size.height || 200) - 16);
  const toggleClass =
    availW < 180 || availH < 130
      ? "toggle-xs"
      : availW < 300 && availH < 220
        ? "toggle-sm"
        : "toggle-md";

  // Conditions & Live evaluation
  const c1Payload = payloadCache[`${primaryBroker}:${primaryTopic}`] ?? null;

  const guardLookup = (bId: string, top: string) => {
    return payloadCache[`${bId}:${top}`];
  };

  const isMatch = evaluateAllConditions(
    c1Payload,
    conditions,
    config.match ?? "all",
    guardLookup,
    primaryBroker,
    primaryTopic,
  );

  const isTripped = status?.current_state === "tripped";
  const isCoolingDown = Boolean(
    status?.current_state?.toLowerCase().startsWith("cooling down"),
  );

  const modeLabel =
    config.mode === "sustained"
      ? `held ${config.sustained_sec ?? 5}s`
      : config.mode === "count"
        ? `${config.count ?? 1}x / ${config.window_sec ?? 60}s`
        : config.mode === "every"
          ? "every match"
          : "on change";

  // Condition 0 info for display
  const c0 = conditions[0];
  const c0Topic = c0?.topic || primaryTopic;
  const c0Broker = c0?.broker_id || primaryBroker;
  const c0Payload = payloadCache[`${c0Broker}:${c0Topic}`] ?? null;
  const { displayValue: c0Value } = extractTrackedValue(
    c0Payload,
    c0?.json_path,
    c0?.read_template,
  );
  const firstCondSummary = c0
    ? formatConditionSummary(c0)
    : "any incoming message";

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full justify-between p-2 overflow-hidden select-none"
    >
      {/* 1. Top Header: Mode badge + status alerts on left, Toggle switch on right */}
      <div className="flex items-center justify-between gap-2 flex-none min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="badge badge-sm badge-neutral font-mono gap-1 shrink-0"
            title={`Mode: ${modeLabel}`}
          >
            <MdAutoMode className="text-xs" />
            <span>{modeLabel}</span>
          </span>

          {isTripped ? (
            <span className="badge badge-sm badge-error font-mono font-medium shrink-0 animate-pulse">
              Tripped
            </span>
          ) : isCoolingDown ? (
            <span className="badge badge-sm badge-warning font-mono font-medium shrink-0">
              Cooldown
            </span>
          ) : null}
        </div>

        <input
          type="checkbox"
          className={`toggle toggle-primary shrink-0 ${toggleClass}`}
          checked={config.enabled ?? false}
          disabled={toggling || isTripped}
          title={
            isTripped
              ? "Rule tripped — re-save in settings to reset"
              : config.enabled
                ? "Click to pause rule"
                : "Click to enable rule"
          }
          onChange={(e) => handleToggle(e.target.checked)}
        />
      </div>

      {/* 2. Center Content: IF card and THEN card */}
      <div
        className={`flex flex-col flex-1 justify-center gap-2 min-h-0 my-auto ${
          !config.enabled ? "opacity-60" : ""
        }`}
      >
        {/* IF Condition Card */}
        <div className="flex flex-col rounded-lg border border-base-300 dark:border-base-content/15 bg-base-200/50 p-2 gap-1.5 min-w-0">
          {conditions.length <= 1 ? (
            <>
              <div className="flex items-center justify-between gap-1.5 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="badge badge-sm badge-warning font-bold font-mono shrink-0">
                    IF
                  </span>
                  <span
                    className="text-xs font-mono font-semibold text-base-content/90 truncate"
                    title={firstCondSummary}
                  >
                    {firstCondSummary}
                  </span>
                </div>

                {c0Payload === null ? (
                  <span className="badge badge-sm badge-ghost font-mono text-base-content/40 shrink-0">
                    waiting
                  </span>
                ) : isMatch ? (
                  <span className="badge badge-sm badge-success font-mono font-medium shrink-0">
                    ✓ Match
                  </span>
                ) : (
                  <span className="badge badge-sm badge-ghost font-mono text-base-content/50 shrink-0">
                    No match
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between gap-1.5 text-xs font-mono min-w-0 pt-0.5">
                <span
                  className="truncate text-base-content/50 flex-1 min-w-0"
                  title={c0Topic || primaryTopic}
                >
                  {c0Topic || primaryTopic}
                </span>
                {c0Payload !== null && (
                  <span
                    className="font-bold text-sm text-base-content truncate max-w-[45%] text-right shrink-0 ml-1.5"
                    title={c0Value}
                  >
                    {c0Value}
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Header row: IF badge on left, overall match on right */}
              <div className="flex items-center justify-between gap-1.5 min-w-0">
                <span className="badge badge-sm badge-warning font-bold font-mono shrink-0">
                  IF
                </span>

                {c1Payload === null ? (
                  <span className="badge badge-sm badge-ghost font-mono text-base-content/40 shrink-0">
                    waiting
                  </span>
                ) : isMatch ? (
                  <span className="badge badge-sm badge-success font-mono font-medium shrink-0">
                    ✓ Match
                  </span>
                ) : (
                  <span className="badge badge-sm badge-ghost font-mono text-base-content/50 shrink-0">
                    No match
                  </span>
                )}
              </div>

              {/* Stacked conditions */}
              <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[140px] pr-0.5">
                {conditions.map((c, i) => {
                  const cTopic = c.topic || primaryTopic;
                  const cBroker = c.broker_id || primaryBroker;
                  const cPayload = payloadCache[`${cBroker}:${cTopic}`] ?? null;
                  const { displayValue: cVal, rawValue: cRaw } =
                    extractTrackedValue(cPayload, c.json_path, c.read_template);
                  const condMatch =
                    cPayload !== null &&
                    evaluateClientCondition(cRaw, c.operator, c.value);
                  const condSummary = formatConditionSummary(c);
                  const joinLabel = c.join
                    ? c.join.toUpperCase()
                    : config.match === "any"
                      ? "OR"
                      : "AND";

                  return (
                    <div key={i} className="flex flex-col gap-1">
                      {i > 0 && (
                        <div className="flex items-center gap-1.5 my-0.5">
                          <div className="h-px flex-1 bg-base-300 dark:bg-base-content/10" />
                          <span className="text-[10px] font-mono font-bold text-base-content/40 uppercase tracking-wider px-1">
                            {joinLabel}
                          </span>
                          <div className="h-px flex-1 bg-base-300 dark:bg-base-content/10" />
                        </div>
                      )}

                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center justify-between gap-1.5 min-w-0">
                          <span
                            className="text-xs font-mono font-semibold text-base-content/90 truncate flex-1 min-w-0"
                            title={condSummary}
                          >
                            {condSummary}
                          </span>
                          {cPayload !== null && (
                            <span
                              className="font-bold text-sm text-base-content truncate max-w-[45%] text-right shrink-0 ml-1.5"
                              title={cVal}
                            >
                              {cVal}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-1.5 text-xs font-mono min-w-0 text-base-content/50">
                          <span
                            className="truncate flex-1 min-w-0"
                            title={cTopic}
                          >
                            {cTopic}
                          </span>
                          {cPayload === null ? (
                            <span className="text-base-content/40 text-xs shrink-0 ml-1">
                              waiting
                            </span>
                          ) : condMatch ? (
                            <span className="text-success text-xs font-semibold shrink-0 ml-1">
                              ✓ match
                            </span>
                          ) : (
                            <span className="text-base-content/40 text-xs shrink-0 ml-1">
                              no match
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* THEN Action Card */}
        <div
          className={`flex flex-col rounded-lg border p-2 gap-1.5 min-w-0 transition-colors duration-300 ${
            isTripped
              ? "bg-error/10 border-error/40 text-error"
              : pulse
                ? "bg-success/15 border-success text-success shadow-sm"
                : "bg-base-200/50 border-base-300 dark:border-base-content/15"
          }`}
        >
          <div className="flex items-center justify-between gap-1.5 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="badge badge-sm badge-success font-bold font-mono shrink-0">
                THEN
              </span>
              <span className="text-xs font-mono text-base-content/50 shrink-0">
                publish →
              </span>
              <span
                className="text-xs font-mono font-semibold text-base-content/90 truncate flex-1 min-w-0"
                title={config.target_topic}
              >
                {config.target_topic || "—"}
              </span>
            </div>
            {pulse && (
              <span className="badge badge-sm badge-success font-mono font-bold shrink-0 animate-pulse">
                Fired
              </span>
            )}
          </div>

          <div
            className="flex items-center min-w-0 px-2.5 py-1.5 rounded-md bg-base-100 dark:bg-base-300/40 border border-base-300/70 dark:border-base-content/10 font-mono text-xs text-base-content/90 truncate shadow-inner"
            title={config.payload}
          >
            {renderPayloadPreview(config.payload)}
          </div>
        </div>
      </div>

      {/* 3. Bottom Footer Meta */}
      <div className="flex items-center justify-between gap-2 text-xs text-base-content/50 font-mono pt-1.5 border-t border-base-200 dark:border-base-content/10 shrink-0">
        <div className="flex items-center gap-1 min-w-0">
          <RiTimeLine className="text-xs shrink-0" />
          <span className="truncate">
            {status?.last_fired
              ? `Fired ${formatTimeAgo(status.last_fired)}`
              : "Never fired"}
          </span>
        </div>

        <div className="truncate shrink-0">
          {status?.fire_count ?? 0}{" "}
          {(status?.fire_count ?? 0) === 1 ? "fire" : "fires"}
        </div>
      </div>
    </div>
  );
}
