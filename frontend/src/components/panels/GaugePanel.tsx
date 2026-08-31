import { useState, useEffect } from "react";
import { useWebSocket } from "../../hooks/useWebSocket";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import { MdSpeed } from "react-icons/md";
import { RiTimeLine } from "react-icons/ri";
import { gaugeReadTemplate, parseGaugePayload } from "./gaugeUtils";
import {
  BrokerTopicCard,
  ChoiceCards,
  ConfigCard,
  ConfigGroup,
  FieldRow,
  NumberRangeRow,
  PanelConfigModal,
  PayloadBuilder,
  brokerPresence,
  brokerRules,
  defaultBrokerId,
  rangeRules,
  topicRules,
  useConfigValidation,
} from "./config";
import { VALUE_TOKEN, readShape, templateFromValueKey } from "./payloadShape";
import { usePayloadSample } from "../../hooks/usePayloadSample";
import { usePanelSize } from "../../hooks/usePanelSize";

/** The scale a gauge falls back on when none is usable. */
const DEFAULT_MIN = 0;
const DEFAULT_MAX = 100;

export type GaugeType = "radial" | "bar" | "value";

export interface GaugeConfig {
  topic?: string;
  /** Shape of incoming messages, with `{value}` marking the part to read. */
  readTemplate?: string;
  /** Legacy dot path, kept so panels saved before shapes existed still read. */
  valueKey?: string;
  unit?: string;
  min?: number;
  max?: number;
  colorScheme?:
    | "auto"
    | "primary"
    | "secondary"
    | "accent"
    | "success"
    | "warning"
    | "error"
    | "info";
  gaugeType?: GaugeType;
}

interface ModalProps {
  config: GaugeConfig;
  brokerId: string;
  brokerStatuses: BrokerStatus[];
  onSave: (cfg: GaugeConfig, brokerId: string) => void;
  onClose: () => void;
  onPickTopic?: (data: {
    currentTopic: string;
    selectedBrokerId: string;
    draftConfig?: GaugeConfig;
  }) => void;
  initialTopic?: string;
  initialBrokerId?: string;
}

export function GaugeConfigModal({
  config,
  brokerId,
  brokerStatuses,
  onSave,
  onClose,
  onPickTopic,
  initialTopic,
  initialBrokerId,
}: ModalProps) {
  const fallbackBroker = defaultBrokerId(brokerStatuses);
  const [topic, setTopic] = useState(initialTopic ?? config.topic ?? "");
  const [readTemplate, setReadTemplate] = useState(gaugeReadTemplate(config));
  const [unit, setUnit] = useState(config.unit ?? "");
  const [min, setMin] = useState(String(config.min ?? DEFAULT_MIN));
  const [max, setMax] = useState(String(config.max ?? DEFAULT_MAX));
  const [gaugeType, setGaugeType] = useState<GaugeType>(
    config.gaugeType ?? "radial",
  );
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || fallbackBroker,
  );

  const { recent, loading } = usePayloadSample(selectedBrokerId, topic);
  const latest = recent[0]?.payload ?? null;

  // Derived from the sample rather than mirrored into state, so changing the
  // shape or the topic can never leave a stale reading on screen.
  const reading = latest ? readShape(readTemplate, latest) : null;
  const numeric = reading?.dataType === "number";
  // "Nothing published yet" and "the shape does not fit this message" are
  // different problems: neither is a reason to disable a style, but only a
  // shape that actually resolved can say the payload is not a number.
  const matched = reading?.found ?? false;

  // Radial and bar need a number to fill against. The stored pick is never
  // overwritten — only the drawn style falls back — so it returns the moment
  // the payload is numeric again.
  const numericOnly = gaugeType === "radial" || gaugeType === "bar";
  const nonNumeric = matched && !numeric;
  const effectiveType: GaugeType =
    nonNumeric && numericOnly ? "value" : gaugeType;
  const fellBack = nonNumeric && numericOnly;

  // The scale belongs to the style the user *picked*, not to the one currently
  // drawn: a radial gauge whose device happens to be publishing text right now
  // still has a scale, and hiding it would take its validation with it and let
  // an unusable Min or Max save behind the fallback.
  const scaleUsed = numericOnly;

  // A field that never passed the rules below cannot reach the wire as NaN,
  // which `JSON.stringify` would write as null.
  const asNumber = (raw: string, fallback: number) => {
    const value = Number(raw);
    return raw.trim() !== "" && Number.isFinite(value) ? value : fallback;
  };
  const minNum = asNumber(min, DEFAULT_MIN);
  const maxNum = asNumber(max, DEFAULT_MAX);

  const { fieldErrors, blockerReason } = useConfigValidation([
    ...brokerRules(brokerStatuses.length),
    ...topicRules({ topic, allowWildcards: true }),
    ...(scaleUsed
      ? rangeRules({
          field: "scale",
          low: min,
          high: max,
          lowLabel: "Min",
          highLabel: "Max",
        })
      : []),
  ]);

  const shown = reading === null ? "—" : String(reading.value);
  const withUnit = reading === null ? "—" : `${shown}${unit ? ` ${unit}` : ""}`;
  const pct =
    numeric && maxNum > minNum
      ? Math.max(
          0,
          Math.min(
            100,
            ((Number(reading?.value) - minNum) / (maxNum - minNum)) * 100,
          ),
        )
      : 0;

  return (
    <PanelConfigModal
      icon={MdSpeed}
      title="Gauge Configuration"
      brokerStatus={brokerPresence(brokerStatuses, selectedBrokerId)}
      blockerReason={blockerReason}
      onCancel={onClose}
      onSave={() =>
        onSave(
          {
            topic: topic.split(",")[0]?.trim() ?? "",
            readTemplate,
            // A stored path the shape cannot draw — an array index — opens the
            // modal as the bare chip, so saving would silently swap a working
            // gauge onto the whole payload. It survives until the shape is
            // given something of its own to say, and even then only applies
            // when the shape reads nothing.
            valueKey:
              readTemplate.trim() === VALUE_TOKEN &&
              !templateFromValueKey(config.valueKey)
                ? config.valueKey
                : undefined,
            unit,
            min: minNum,
            max: maxNum,
            gaugeType,
          },
          selectedBrokerId || fallbackBroker,
        )
      }
    >
      <ConfigGroup heading="Read">
        <BrokerTopicCard
          title="Reads from"
          brokers={brokerStatuses}
          brokerId={selectedBrokerId}
          onBrokerChange={setSelectedBrokerId}
          topic={topic}
          onTopicChange={(next) => {
            setTopic(next);
          }}
          topicPlaceholder="sensors/attic/temp"
          topicError={fieldErrors.topic}
          help="One topic to watch. Read-only, so wildcards (+ and #) are fine."
          onExplore={
            onPickTopic
              ? () =>
                  onPickTopic({
                    currentTopic: topic,
                    selectedBrokerId,
                    draftConfig: {
                      topic,
                      readTemplate,
                      unit,
                      min: minNum,
                      max: maxNum,
                      gaugeType,
                    },
                  })
              : undefined
          }
        />

        <ConfigCard
          title="Value"
          summary="the chip marks the value to pull out"
        >
          <PayloadBuilder
            mode="read"
            value={readTemplate}
            onChange={(next) => {
              setReadTemplate(next);
            }}
            history={{ messages: recent, loading }}
            brokerId={selectedBrokerId}
            topic={topic}
            allowBlankShape
            unit={unit}
            placeholder="whole payload"
          />
        </ConfigCard>
      </ConfigGroup>

      <ConfigGroup heading="Appearance">
        <ConfigCard title="Style" summary="Drawn with the value above">
          <ChoiceCards<GaugeType>
            value={gaugeType}
            effective={effectiveType}
            onChange={setGaugeType}
            options={[
              {
                id: "radial",
                label: "Radial",
                disabled: nonNumeric,
                disabledNote: "needs a number",
                preview: <RadialPreview pct={pct} text={clip(shown, 6)} />,
              },
              {
                id: "bar",
                label: "Bar",
                disabled: nonNumeric,
                disabledNote: "needs a number",
                preview: <BarPreview pct={pct} text={clip(shown, 8)} />,
              },
              {
                id: "value",
                label: "Big value",
                preview: (
                  <span className="text-xl font-semibold text-primary truncate">
                    {clip(withUnit, 9)}
                  </span>
                ),
              },
            ]}
          />
          {fellBack && (
            <span className="text-[11px] leading-relaxed text-warning">
              Radial and Bar need a number to fill against. Showing Big value
              for now — your pick comes back when the payload is numeric again.
            </span>
          )}
        </ConfigCard>

        {scaleUsed && (
          <ConfigCard
            title="Scale"
            summary="Where the fill starts and ends"
            invalid={Boolean(fieldErrors.scale)}
          >
            <NumberRangeRow
              fields={[
                {
                  label: "Min",
                  value: min,
                  placeholder: "0",
                  invalid: Boolean(fieldErrors.scale),
                  onChange: (next) => {
                    setMin(next);
                  },
                },
                {
                  label: "Max",
                  value: max,
                  placeholder: "100",
                  invalid: Boolean(fieldErrors.scale),
                  onChange: (next) => {
                    setMax(next);
                  },
                },
              ]}
            />
            {fieldErrors.scale && (
              <span className="text-[11px] text-warning">
                {fieldErrors.scale}
              </span>
            )}
          </ConfigCard>
        )}

        <ConfigCard>
          <FieldRow
            label="Unit"
            help="Shown next to the value. Display only — never sent to the broker."
          >
            <input
              className="input input-bordered w-full min-w-0 h-8 min-h-8 text-xs"
              placeholder="e.g. °C, %, V, kW"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </FieldRow>
        </ConfigCard>
      </ConfigGroup>
    </PanelConfigModal>
  );
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function RadialPreview({ pct, text }: { pct: number; text: string }) {
  return (
    <div
      className="relative w-[54px] h-[54px] rounded-full"
      style={{
        background: `conic-gradient(var(--color-primary) 0turn ${pct / 100}turn, var(--color-base-300) ${pct / 100}turn 1turn)`,
      }}
    >
      <div className="absolute inset-[6px] rounded-full bg-base-100 flex items-center justify-center text-xs font-semibold overflow-hidden">
        {text}
      </div>
    </div>
  );
}

function BarPreview({ pct, text }: { pct: number; text: string }) {
  return (
    <div className="w-full flex flex-col justify-center gap-1.5 px-1">
      <span className="text-[13px] font-semibold truncate">{text}</span>
      <div className="h-2 rounded-full bg-base-300 overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function normalizeTimestamp(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const pad2 = (n: number) => String(n).padStart(2, "0");
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  } catch {
    return "";
  }
}

interface GaugePanelProps {
  panelId: string;
  brokerId: string;
  config: GaugeConfig;
}

export default function GaugePanel({
  panelId,
  brokerId,
  config,
}: GaugePanelProps) {
  const [data, setData] = useState<{
    parsedValue: string | number | boolean;
    dataType: "number" | "boolean" | "string";
    raw: string;
    receivedAt: string;
    isHistorical: boolean;
  } | null>(null);

  const { ref: containerRef, size: dimensions } =
    usePanelSize<HTMLDivElement>();

  const topic = (config.topic ?? "").split(",")[0]?.trim() ?? "";
  const min = config.min ?? DEFAULT_MIN;
  const max = config.max ?? DEFAULT_MAX;
  const unit = config.unit ?? "";
  const gaugeType = config.gaugeType ?? "radial";
  const readTemplate = gaugeReadTemplate(config);
  const readPath = config.valueKey;

  // Clear data when topic or broker changes
  useEffect(() => {
    const id = setTimeout(() => setData(null), 0);
    return () => clearTimeout(id);
  }, [brokerId, topic]);

  // Fetch initial history
  useEffect(() => {
    if (!brokerId || !topic) return;

    let cancelled = false;
    api
      .getExplorerHistory(brokerId, topic)
      .then((records) => {
        if (cancelled || !records || records.length === 0) return;
        // Sort descending by timestamp to get the last known message
        const sorted = [...records].sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
        const last = sorted[0];
        const res = parseGaugePayload(last.payload, {
          template: readTemplate,
          path: readPath,
        });
        setData({
          ...res,
          receivedAt: normalizeTimestamp(last.timestamp),
          isHistorical: true,
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [brokerId, topic, readTemplate, readPath]);

  // Live WebSocket updates
  const { subscribe } = useWebSocket({
    onMessage: (msgStr) => {
      try {
        const msg = JSON.parse(msgStr) as {
          topic: string;
          payload: string;
          timestamp?: string;
        };
        const res = parseGaugePayload(msg.payload, {
          template: readTemplate,
          path: readPath,
        });
        setData({
          ...res,
          receivedAt: normalizeTimestamp(msg.timestamp),
          isHistorical: false,
        });
      } catch {
        // Ignore invalid message JSON frame
      }
    },
  });

  useEffect(() => {
    if (!topic) return;
    const topicList = topic
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    subscribe({ panel_id: panelId, broker_id: brokerId, topics: topicList });
  }, [panelId, brokerId, topic, subscribe]);

  let numericVal = 0;
  if (data?.dataType === "number") {
    numericVal =
      typeof data.parsedValue === "number"
        ? data.parsedValue
        : Number(data.parsedValue);
  } else if (data?.dataType === "boolean") {
    numericVal = data.parsedValue ? max : min;
  }

  const range = max > min ? max - min : 1;
  const pct = Math.min(Math.max(((numericVal - min) / range) * 100, 0), 100);

  // Dynamic Color Mapping based on limits
  let colorClass = "text-primary";
  let progressClass = "progress-primary";

  if (data?.dataType === "boolean") {
    if (data.parsedValue) {
      colorClass = "text-success";
      progressClass = "progress-success";
    } else {
      colorClass = "text-error";
      progressClass = "progress-error";
    }
  } else if (data?.dataType === "number") {
    if (pct < 35) {
      colorClass = "text-info";
      progressClass = "progress-info";
    } else if (pct < 75) {
      colorClass = "text-success";
      progressClass = "progress-success";
    } else if (pct < 90) {
      colorClass = "text-warning";
      progressClass = "progress-warning";
    } else {
      colorClass = "text-error";
      progressClass = "progress-error";
    }
  } else if (data) {
    colorClass = "text-accent";
    progressClass = "progress-accent";
  }

  // Format value text
  let formattedValue = data ? String(data.parsedValue) : "";
  if (data && typeof data.parsedValue === "number") {
    formattedValue = Number.isInteger(data.parsedValue)
      ? data.parsedValue.toString()
      : data.parsedValue.toFixed(1);
  } else if (data && typeof data.parsedValue === "boolean") {
    formattedValue = data.parsedValue ? "ON" : "OFF";
  }

  // Dynamic Sizing derived from container dimensions
  const availW = Math.max(80, (dimensions.width || 240) - 16);
  const availH = Math.max(80, (dimensions.height || 200) - 40);

  // Radial Dial Sizing: fills up to 80% of the available container bounds
  const dialSize = Math.max(65, Math.floor(Math.min(availW, availH) * 0.8));
  const radialValFontSize = Math.max(15, Math.round(dialSize * 0.21));
  const radialUnitFontSize = Math.max(10, Math.round(dialSize * 0.1));

  // Progress Bar Sizing: filling width and scaling text/bar height
  const barValFontSize = Math.max(
    18,
    Math.round(Math.min(availH * 0.25, availW * 0.13)),
  );
  const barHeight = Math.max(12, Math.round(availH * 0.14));
  const barSubFontSize = Math.max(10, Math.round(barValFontSize * 0.45));

  // Value Card / String / Boolean Sizing: hero text/badge
  const strLen = Math.max(
    1,
    formattedValue.length + (unit ? unit.length + 1 : 0),
  );
  const maxFontFromHeight = availH * 0.42;
  const maxFontFromWidth = (availW * 0.95) / Math.max(1, strLen * 0.65);
  const cardValFontSize = Math.max(
    14,
    Math.floor(Math.min(maxFontFromHeight, maxFontFromWidth)),
  );
  const cardBadgeFontSize = Math.max(
    14,
    Math.floor(Math.min(availH * 0.32, availW * 0.18)),
  );

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full justify-between p-2"
    >
      {!topic ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 text-base-content/40 p-4 text-center">
          <MdSpeed className="text-4xl opacity-50" />
          <span className="text-sm font-medium">No Topic Configured</span>
          <span className="text-xs text-base-content/50">
            Configure a topic to display live gauge data.
          </span>
        </div>
      ) : !data ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 p-4 text-center">
          <div className="loading loading-spinner loading-md text-primary" />
          <span className="text-xs text-base-content/60 font-mono animate-pulse">
            Waiting for data on{" "}
            <span className="font-semibold text-accent">{topic}</span>…
          </span>
        </div>
      ) : (
        <>
          {/* Visual Display Container */}
          <div className="flex-1 flex items-center justify-center min-h-0 w-full overflow-hidden p-1">
            {data.dataType === "number" && gaugeType === "radial" && (
              <div
                className="relative flex items-center justify-center shrink-0"
                style={{ width: `${dialSize}px`, height: `${dialSize}px` }}
                role="progressbar"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={min}
                aria-valuemax={max}
              >
                <svg
                  viewBox="0 0 100 100"
                  className="w-full h-full transform -rotate-90 overflow-visible"
                >
                  {/* Background Track Circle */}
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="8"
                    className="text-base-content/10"
                  />
                  {/* Animated Progress Fill Arc */}
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray="251.327"
                    strokeDashoffset={251.327 - (pct / 100) * 251.327}
                    className={`${colorClass} transition-[stroke-dashoffset] duration-500 ease-out`}
                  />
                </svg>
                {/* Center Value Text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center p-1 text-center leading-none pointer-events-none">
                  <span
                    className="font-bold font-mono tracking-tight text-base-content"
                    style={{ fontSize: `${radialValFontSize}px` }}
                  >
                    {formattedValue}
                  </span>
                  {unit && (
                    <span
                      className="font-semibold text-base-content/60 mt-1"
                      style={{ fontSize: `${radialUnitFontSize}px` }}
                    >
                      {unit}
                    </span>
                  )}
                </div>
              </div>
            )}

            {data.dataType === "number" && gaugeType === "bar" && (
              <div className="w-full h-full flex flex-col justify-center gap-2 px-1">
                <div className="flex justify-between items-baseline">
                  <span
                    className="font-bold font-mono text-base-content leading-none"
                    style={{ fontSize: `${barValFontSize}px` }}
                  >
                    {formattedValue}{" "}
                    {unit && (
                      <span
                        className="font-medium text-base-content/60"
                        style={{ fontSize: `${barSubFontSize}px` }}
                      >
                        {unit}
                      </span>
                    )}
                  </span>
                  <span
                    className="font-mono text-base-content/50"
                    style={{ fontSize: `${barSubFontSize}px` }}
                  >
                    {Math.round(pct)}%
                  </span>
                </div>
                <progress
                  className={`progress ${progressClass} w-full rounded-lg transition-all duration-300`}
                  style={{ height: `${barHeight}px` }}
                  value={pct}
                  max="100"
                />
                <div
                  className="flex justify-between font-mono text-base-content/50"
                  style={{ fontSize: `${Math.max(9, barSubFontSize * 0.8)}px` }}
                >
                  <span>{min}</span>
                  <span>{max}</span>
                </div>
              </div>
            )}

            {(gaugeType === "value" || data.dataType !== "number") && (
              <div className="flex flex-col items-center justify-center gap-1.5 p-1 text-center w-full h-full overflow-hidden">
                {data.dataType === "boolean" ? (
                  <div
                    className={`inline-flex items-center gap-2.5 rounded-2xl font-mono font-bold tracking-wider uppercase border shadow-sm transition-all duration-300 ${
                      data.parsedValue
                        ? "bg-success/15 text-success border-success/40 shadow-success/10"
                        : "bg-error/15 text-error border-error/40 shadow-error/10"
                    }`}
                    style={{
                      fontSize: `${cardBadgeFontSize}px`,
                      padding: `${Math.max(4, Math.round(cardBadgeFontSize * 0.25))}px ${Math.max(12, Math.round(cardBadgeFontSize * 0.6))}px`,
                    }}
                  >
                    <span
                      className={`rounded-full shrink-0 animate-pulse ${
                        data.parsedValue
                          ? "bg-success shadow-[0_0_8px_#22c55e]"
                          : "bg-error shadow-[0_0_8px_#ef4444]"
                      }`}
                      style={{
                        width: `${Math.max(6, Math.round(cardBadgeFontSize * 0.35))}px`,
                        height: `${Math.max(6, Math.round(cardBadgeFontSize * 0.35))}px`,
                      }}
                    />
                    <span>{formattedValue}</span>
                  </div>
                ) : (
                  <div className="flex items-baseline gap-1.5 justify-center flex-wrap max-w-full px-2">
                    <span
                      className="font-bold font-mono text-base-content tracking-tight leading-tight break-words text-center max-w-full"
                      style={{ fontSize: `${cardValFontSize}px` }}
                    >
                      {formattedValue}
                    </span>
                    {unit && (
                      <span
                        className="font-semibold text-base-content/70 shrink-0"
                        style={{
                          fontSize: `${Math.max(11, cardValFontSize * 0.45)}px`,
                        }}
                      >
                        {unit}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Meta */}
          <div className="flex items-center justify-between text-[10px] text-base-content/50 pt-1.5 border-t border-base-200">
            <div className="flex items-center gap-1">
              <RiTimeLine className="text-xs" />
              <span>{formatTime(data.receivedAt)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
