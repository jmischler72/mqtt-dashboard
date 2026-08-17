import { useState, useEffect, useRef } from "react";
import { useWebSocket } from "../../hooks/useWebSocket";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import BrokerTopicSection from "./BrokerTopicSection";
import { MdSpeed } from "react-icons/md";
import { RiTimeLine } from "react-icons/ri";
import { parseGaugePayload } from "./gaugeUtils";

export interface GaugeConfig {
  topic?: string;
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
  gaugeType?: "radial" | "bar" | "value";
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
  const defaultBrokerId =
    brokerStatuses.find((b) => b.is_enabled)?.id ?? brokerStatuses[0]?.id ?? "";
  const [topic, setTopic] = useState(initialTopic ?? config.topic ?? "");
  const [valueKey, setValueKey] = useState(config.valueKey ?? "");
  const [unit, setUnit] = useState(config.unit ?? "");
  const [min, setMin] = useState(config.min ?? 0);
  const [max, setMax] = useState(config.max ?? 100);
  const [gaugeType, setGaugeType] = useState<GaugeConfig["gaugeType"]>(
    config.gaugeType ?? "radial",
  );
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || defaultBrokerId,
  );

  const [detectedType, setDetectedType] = useState<"number" | "boolean" | "string" | null>(null);
  const [sampleValue, setSampleValue] = useState<string | number | boolean | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);

  useEffect(() => {
    const singleTopic = topic.split(",")[0]?.trim();
    if (!selectedBrokerId || !singleTopic) {
      const id = setTimeout(() => {
        setDetectedType(null);
        setSampleValue(null);
        setIsLoadingSample(false);
      }, 0);
      return () => clearTimeout(id);
    }

    let cancelled = false;
    const startTimer = setTimeout(() => {
      if (!cancelled) setIsLoadingSample(true);
    }, 0);

    api
      .getExplorerHistory(selectedBrokerId, singleTopic)
      .then((records) => {
        if (cancelled) return;
        if (records && records.length > 0) {
          const sorted = [...records].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          );
          const latest = sorted[0];
          if (latest?.payload) {
            const parsed = parseGaugePayload(latest.payload, valueKey);
            setDetectedType(parsed.dataType);
            setSampleValue(parsed.parsedValue);
            setIsLoadingSample(false);

            if (parsed.dataType !== "number" && (gaugeType === "radial" || gaugeType === "bar")) {
              setGaugeType("value");
            }
            return;
          }
        }
        setDetectedType(null);
        setSampleValue(null);
        setIsLoadingSample(false);
      })
      .catch(() => {
        if (!cancelled) {
          setDetectedType(null);
          setSampleValue(null);
          setIsLoadingSample(false);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
    };
  }, [selectedBrokerId, topic, valueKey, gaugeType]);

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-h-[85vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MdSpeed className="text-primary text-xl" />
            Gauge Configuration
          </div>
          {isLoadingSample && (
            <span className="loading loading-spinner loading-xs text-primary" />
          )}
        </h3>

        <div className="flex flex-col gap-4">
          <BrokerTopicSection
            selectedBrokerId={selectedBrokerId}
            onBrokerChange={setSelectedBrokerId}
            brokerStatuses={brokerStatuses}
            topic={topic}
            onTopicChange={setTopic}
            allowWildcards={true}
            allowMultiple={false}
            topicLabel="Topic"
            placeholder="e.g. sensor/temperature"
            helpText="Single topic to monitor for live data values (wildcards supported)."
            onPickTopic={
              onPickTopic
                ? () =>
                    onPickTopic({
                      currentTopic: topic,
                      selectedBrokerId,
                      draftConfig: {
                        topic,
                        valueKey,
                        unit,
                        min,
                        max,
                        gaugeType,
                      },
                    })
                : undefined
            }
          />

          {/* Payload Detection Banner */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-base-200/60 rounded-lg text-xs border border-base-300">
            <span className="font-medium text-base-content/70 shrink-0">
              Detected Type:
            </span>

            <div className="flex items-center gap-2 min-w-0">
              {sampleValue !== null && (
                <>
                  <span
                    className="font-mono text-[11px] text-base-content/80 truncate max-w-[180px] bg-base-100 px-2 py-0.5 rounded border border-base-300"
                    title={String(sampleValue)}
                  >
                    {String(sampleValue)}
                  </span>
                  <span className="text-base-content/40 font-mono text-xs font-semibold shrink-0">
                    →
                  </span>
                </>
              )}

              {detectedType === "number" && (
                <span className="badge badge-info badge-sm font-semibold shrink-0">
                  Number
                </span>
              )}
              {detectedType === "boolean" && (
                <span className="badge badge-success badge-sm font-semibold shrink-0">
                  Boolean
                </span>
              )}
              {detectedType === "string" && (
                <span className="badge badge-accent badge-sm font-semibold shrink-0">
                  String
                </span>
              )}
              {!detectedType && !isLoadingSample && (
                <span className="badge badge-ghost badge-sm text-base-content/50 shrink-0">
                  No sample data
                </span>
              )}
            </div>
          </div>

          {/* Full-width Gauge Style Selector */}
          <fieldset className="fieldset w-full">
            <legend className="fieldset-legend font-semibold">Gauge Style</legend>
            <select
              className="select select-bordered select-sm w-full font-medium"
              value={gaugeType}
              onChange={(e) =>
                setGaugeType(e.target.value as GaugeConfig["gaugeType"])
              }
            >
              <option
                value="radial"
                disabled={detectedType !== null && detectedType !== "number"}
              >
                Radial Ring Dial{" "}
                {detectedType !== null && detectedType !== "number"
                  ? "(Disabled: Requires numeric data)"
                  : ""}
              </option>
              <option
                value="bar"
                disabled={detectedType !== null && detectedType !== "number"}
              >
                Progress Bar Meter{" "}
                {detectedType !== null && detectedType !== "number"
                  ? "(Disabled: Requires numeric data)"
                  : ""}
              </option>
              <option value="value">
                Big Value Card (Compatible with Numbers, Booleans & Strings)
              </option>
            </select>
            {detectedType !== null && detectedType !== "number" && (
              <p className="text-[11px] text-warning mt-1">
                Radial and Progress Bar gauges require numeric payloads to calculate min/max percentages. "Big Value Card" has been auto-selected.
              </p>
            )}
          </fieldset>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Min Value</legend>
              <input
                className="input input-bordered input-sm w-full"
                type="number"
                value={min}
                onChange={(e) => setMin(Number(e.target.value))}
              />
            </fieldset>

            <fieldset className="fieldset">
              <legend className="fieldset-legend">Max Value</legend>
              <input
                className="input input-bordered input-sm w-full"
                type="number"
                value={max}
                onChange={(e) => setMax(Number(e.target.value))}
              />
            </fieldset>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <fieldset className="fieldset">
              <legend className="fieldset-legend font-semibold">Unit / Suffix</legend>
              <input
                className="input input-bordered input-sm w-full text-xs"
                placeholder="e.g. °C, %, V, kW"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
              <p className="text-[11px] text-base-content/60 mt-1">
                Displayed next to the value.
              </p>
            </fieldset>

            <fieldset className="fieldset">
              <legend className="fieldset-legend font-semibold">JSON Key (Optional)</legend>
              <input
                className="input input-bordered input-sm w-full font-mono text-xs"
                placeholder="e.g. temp or data.value"
                value={valueKey}
                onChange={(e) => setValueKey(e.target.value)}
              />
              <p className="text-[11px] text-base-content/60 mt-1">
                Field name if payload is JSON. Leave blank for auto-detect/raw.
              </p>
            </fieldset>
          </div>
        </div>

        <div className="modal-action">
          <button className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={brokerStatuses.length === 0}
            onClick={() => {
              const singleTopic = topic.split(",")[0]?.trim() ?? "";
              onSave(
                { topic: singleTopic, valueKey, unit, min, max, gaugeType },
                selectedBrokerId || defaultBrokerId,
              );
            }}
          >
            Save
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </dialog>
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

export default function GaugePanel({ panelId, brokerId, config }: GaugePanelProps) {
  const [data, setData] = useState<{
    parsedValue: string | number | boolean;
    dataType: "number" | "boolean" | "string";
    raw: string;
    receivedAt: string;
    isHistorical: boolean;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.offsetWidth || el.getBoundingClientRect().width;
      const h = el.offsetHeight || el.getBoundingClientRect().height;
      if (w > 0 && h > 0) {
        setDimensions({ width: w, height: h });
      }
    };

    measure();
    const timer = setTimeout(measure, 100);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const w = entry.contentRect.width || el.offsetWidth;
        const h = entry.contentRect.height || el.offsetHeight;
        if (w > 0 && h > 0) {
          setDimensions({ width: w, height: h });
        }
      }
    });

    observer.observe(el);
    window.addEventListener("resize", measure);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const topic = (config.topic ?? "").split(",")[0]?.trim() ?? "";
  const min = config.min ?? 0;
  const max = config.max ?? 100;
  const unit = config.unit ?? "";
  const gaugeType = config.gaugeType ?? "radial";
  const valueKey = config.valueKey;

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
        const res = parseGaugePayload(last.payload, valueKey);
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
  }, [brokerId, topic, valueKey]);

  // Live WebSocket updates
  const { subscribe } = useWebSocket({
    onMessage: (msgStr) => {
      try {
        const msg = JSON.parse(msgStr) as {
          topic: string;
          payload: string;
          timestamp?: string;
        };
        const res = parseGaugePayload(msg.payload, valueKey);
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

  if (!topic) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-base-content/40 p-4 text-center">
        <MdSpeed className="text-4xl opacity-50" />
        <span className="text-sm font-medium">No Topic Configured</span>
        <span className="text-xs text-base-content/50">
          Configure a topic to display live gauge data.
        </span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center">
        <div className="loading loading-spinner loading-md text-primary" />
        <span className="text-xs text-base-content/60 font-mono animate-pulse">
          Waiting for data on <span className="font-semibold text-accent">{topic}</span>…
        </span>
      </div>
    );
  }

  // Calculate numeric percentage for gauge meter
  let numericVal = 0;
  if (data.dataType === "number") {
    numericVal = typeof data.parsedValue === "number" ? data.parsedValue : Number(data.parsedValue);
  } else if (data.dataType === "boolean") {
    numericVal = data.parsedValue ? max : min;
  }

  const range = max > min ? max - min : 1;
  const pct = Math.min(Math.max(((numericVal - min) / range) * 100, 0), 100);

  // Dynamic Color Mapping based on limits
  let colorClass: string;
  let badgeClass: string;
  let progressClass: string;

  if (data.dataType === "boolean") {
    if (data.parsedValue) {
      colorClass = "text-success";
      badgeClass = "badge-success";
      progressClass = "progress-success";
    } else {
      colorClass = "text-error";
      badgeClass = "badge-error";
      progressClass = "progress-error";
    }
  } else if (data.dataType === "number") {
    if (pct < 35) {
      colorClass = "text-info";
      badgeClass = "badge-info";
      progressClass = "progress-info";
    } else if (pct < 75) {
      colorClass = "text-success";
      badgeClass = "badge-success";
      progressClass = "progress-success";
    } else if (pct < 90) {
      colorClass = "text-warning";
      badgeClass = "badge-warning";
      progressClass = "progress-warning";
    } else {
      colorClass = "text-error";
      badgeClass = "badge-error";
      progressClass = "progress-error";
    }
  } else {
    colorClass = "text-accent";
    badgeClass = "badge-accent";
    progressClass = "progress-accent";
  }

  // Format value text
  let formattedValue = String(data.parsedValue);
  if (typeof data.parsedValue === "number") {
    formattedValue = Number.isInteger(data.parsedValue)
      ? data.parsedValue.toString()
      : data.parsedValue.toFixed(1);
  } else if (typeof data.parsedValue === "boolean") {
    formattedValue = data.parsedValue ? "ON" : "OFF";
  }

  // Dynamic Sizing derived from container dimensions
  const availW = dimensions.width || 240;
  const availH = dimensions.height || 200;

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
  const strLen = Math.max(1, formattedValue.length);
  const cardValFontSize = Math.max(
    14,
    Math.min(
      availH * 0.36,
      (availW * 1.5) / strLen,
      64,
    ),
  );
  const cardBadgeFontSize = Math.max(
    15,
    Math.round(Math.min(availH * 0.24, availW * 0.15)),
  );

  return (
    <div className="flex flex-col h-full justify-between p-2">
      {/* Visual Display Container */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center min-h-0 w-full overflow-hidden p-1"
      >
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
              <span
                className={`badge ${badgeClass} font-bold font-mono shadow-xs uppercase tracking-wider rounded-xl transition-all duration-300`}
                style={{
                  fontSize: `${cardBadgeFontSize}px`,
                  padding: `${cardBadgeFontSize * 0.35}px ${cardBadgeFontSize * 0.7}px`,
                }}
              >
                {formattedValue}
              </span>
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
                    style={{ fontSize: `${Math.max(11, cardValFontSize * 0.45)}px` }}
                  >
                    {unit}
                  </span>
                )}
              </div>
            )}
            {data.dataType !== "string" &&
              data.raw &&
              data.raw !== formattedValue && (
                <span
                  className="font-mono text-base-content/60 truncate max-w-full"
                  style={{ fontSize: `${Math.max(10, cardValFontSize * 0.3)}px` }}
                >
                  {data.raw}
                </span>
              )}
          </div>
        )}
      </div>

      {/* Footer Meta */}
      <div className="flex items-center justify-between text-[10px] text-base-content/50 pt-1.5 border-t border-base-200">
        <div className="flex items-center gap-1">
          <RiTimeLine className="text-xs" />
          <span>{formatTime(data.receivedAt)}</span>
          {data.isHistorical && (
            <span className="badge badge-ghost badge-xs text-[9px] py-0 px-1 font-mono">
              history
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
