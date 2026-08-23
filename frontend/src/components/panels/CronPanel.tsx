import { useState, useEffect, useMemo, useCallback } from "react";
import { CiPause1 } from "react-icons/ci";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import BrokerTopicSection from "./BrokerTopicSection";
import MqttOptionsSection from "./MqttOptionsSection";
import {
  PRESETS,
  validateCron,
  describeCron,
  getPreviousCronRun,
} from "./cronUtils";

export interface CronConfig {
  cron_expr?: string;
  topic?: string;
  payload?: string;
  qos?: number;
  retain?: boolean;
  enabled?: boolean;
}

interface Props {
  config: CronConfig;
  brokerId: string;
  brokerStatuses: BrokerStatus[];
  onSave: (cfg: CronConfig, brokerId: string) => void;
  onClose: () => void;
  onPickTopic?: (data: {
    currentTopic: string;
    selectedBrokerId: string;
  }) => void;
  initialTopic?: string;
  initialBrokerId?: string;
}

export function CronConfigModal({
  config,
  brokerId,
  brokerStatuses,
  onSave,
  onClose,
  onPickTopic,
  initialTopic,
  initialBrokerId,
}: Props) {
  const defaultBrokerId =
    brokerStatuses.find((b) => b.is_enabled)?.id ?? brokerStatuses[0]?.id ?? "";
  const initialCronState = useMemo(() => {
    if (!config.cron_expr) {
      return { preset: "* * * * *", customExpr: "" };
    }
    const found = PRESETS.find((p) => p.value === config.cron_expr);
    if (found) {
      return { preset: found.value, customExpr: config.cron_expr };
    }
    return { preset: "custom", customExpr: config.cron_expr };
  }, [config.cron_expr]);
  const [topic, setTopic] = useState(initialTopic ?? config.topic ?? "");
  const [payload, setPayload] = useState(config.payload ?? "");
  const [enabled, setEnabled] = useState(config.enabled ?? false);
  const [qos, setQos] = useState(config.qos ?? 0);
  const [retain, setRetain] = useState(config.retain ?? false);
  const [preset, setPreset] = useState(initialCronState.preset);
  const [customExpr, setCustomExpr] = useState(initialCronState.customExpr);
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || defaultBrokerId,
  );
  const isCustom = preset === "custom";
  const cronExpr = isCustom ? customExpr : preset;
  const cronError = isCustom ? validateCron(customExpr) : null;
  const cronDescription =
    isCustom && !cronError ? describeCron(customExpr) : null;

  const hasWildcardWarning = topic.includes("+") || topic.includes("#");

  return (
    <dialog className="modal modal-open backdrop-blur-xs">
      <div className="modal-box max-h-[85vh] overflow-y-auto max-w-lg p-5">
        <h3 className="font-bold text-lg mb-4">Cron Configuration</h3>
        <div className="flex flex-col gap-4">
          <BrokerTopicSection
            selectedBrokerId={selectedBrokerId}
            onBrokerChange={setSelectedBrokerId}
            brokerStatuses={brokerStatuses}
            topic={topic}
            onTopicChange={setTopic}
            onPickTopic={
              onPickTopic
                ? () => onPickTopic({ currentTopic: topic, selectedBrokerId })
                : undefined
            }
          />

          <fieldset className="fieldset p-0 border-0">
            <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
              Schedule Presets
            </legend>
            <select
              className="select select-bordered select-sm w-full font-medium"
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
            >
              {PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </fieldset>

          {isCustom && (
            <fieldset className="fieldset p-0 border-0">
              <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
                Cron Expression (5 fields)
              </legend>
              <input
                className={`input input-bordered input-sm w-full font-mono text-xs ${
                  cronError ? "input-error" : ""
                }`}
                placeholder="* * * * *"
                value={customExpr}
                onChange={(e) => setCustomExpr(e.target.value)}
              />
              {cronError ? (
                <p className="text-xs text-error mt-1">{cronError}</p>
              ) : (
                <p className="text-[11px] text-base-content/50 mt-1">min hour day month weekday</p>
              )}
              {cronDescription && (
                <div className="text-xs bg-base-200/70 border border-base-300 rounded-lg px-3 py-2 mt-2 font-mono">
                  {cronDescription}
                </div>
              )}
            </fieldset>
          )}

          {!isCustom && (
            <div className="text-xs font-mono bg-base-200/70 border border-base-300 rounded-lg px-3 py-2">
              Expression: <strong className="text-primary">{cronExpr}</strong>
            </div>
          )}

          <fieldset className="fieldset p-0 border-0">
            <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
              Payload
            </legend>
            <textarea
              className="textarea textarea-bordered textarea-sm w-full font-mono text-xs"
              rows={2}
              placeholder='{"ping": true}'
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
            />
          </fieldset>

          <fieldset className="fieldset p-0 border-0">
            <label className="flex items-center justify-between cursor-pointer p-2.5 rounded-lg border border-base-300 bg-base-200/40">
              <span className="text-xs font-medium text-base-content/80">
                Enable Schedule Execution
              </span>
              <input
                type="checkbox"
                className="toggle toggle-xs toggle-primary"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
            </label>
          </fieldset>

          <MqttOptionsSection
            qos={qos}
            retain={retain}
            onQosChange={setQos}
            onRetainChange={setRetain}
          />
        </div>

        <div className="modal-action mt-6 pt-3 border-t border-base-300">
          <button className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={
              brokerStatuses.length === 0 ||
              (isCustom && !!cronError) ||
              !topic.trim() ||
              hasWildcardWarning
            }
            onClick={() =>
              onSave(
                {
                  cron_expr: cronExpr,
                  topic,
                  payload,
                  qos,
                  retain,
                  enabled,
                },
                selectedBrokerId || defaultBrokerId,
              )
            }
          >
            Save
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </dialog>
  );
}

interface CronPanelProps {
  panelId: string;
  brokerId: string;
  config: CronConfig;
  onConfigChange: (cfg: CronConfig) => void;
}

export default function CronPanel({
  panelId,
  config,
  onConfigChange,
}: CronPanelProps) {
  const [nextRun, setNextRun] = useState<Date | null>(null);
  const [cronStart, setCronStart] = useState<Date | null>(null);
  const [toggling, setToggling] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());

  const fetchStatus = useCallback(() => {
    if (!config.enabled || !config.cron_expr) return;
    api
      .get<{ next_run: string; prev_run?: string }>(`/api/cron/${panelId}`)
      .then((r) => {
        if (!r.next_run) return;
        const targetDate = new Date(r.next_run);
        if (isNaN(targetDate.getTime()) || targetDate.getFullYear() < 2000) {
          return;
        }
        const prev = config.cron_expr
          ? getPreviousCronRun(config.cron_expr, targetDate)
          : null;
        const start = prev ?? (r.prev_run ? new Date(r.prev_run) : new Date());
        setCronStart(start);
        setNextRun(targetDate);
      })
      .catch((error) => {
        void error;
      });
  }, [panelId, config.enabled, config.cron_expr]);

  // Periodic status poll while enabled
  useEffect(() => {
    if (!config.enabled || !config.cron_expr) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [config.enabled, config.cron_expr, fetchStatus]);

  // Refetch when reaching nextRun
  useEffect(() => {
    if (!config.enabled || !nextRun) return;
    const diff = nextRun.getTime() - Date.now();
    const delay = diff <= 0 ? 500 : diff + 200;
    const timer = setTimeout(fetchStatus, delay);
    return () => clearTimeout(timer);
  }, [config.enabled, nextRun, fetchStatus]);

  // Active second-level clock while enabled
  useEffect(() => {
    if (!config.enabled || !config.cron_expr) return;
    const clock = setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 1000);
    return () => clearInterval(clock);
  }, [config.enabled, config.cron_expr]);

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      await api.put(`/api/cron/${panelId}/toggle`, { enabled });
      onConfigChange({ ...config, enabled });
    } catch (error) {
      void error;
    } finally {
      setToggling(false);
    }
  };

  const matchedPreset = config.cron_expr
    ? PRESETS.find((p) => p.value === config.cron_expr)?.label
    : undefined;
  const prettyPreset = config.cron_expr
    ? (matchedPreset ?? config.cron_expr)
    : "Not configured";
  // For raw custom expressions, surface a human description on hover.
  const presetTitle =
    config.cron_expr && !matchedPreset
      ? (describeCron(config.cron_expr) ?? undefined)
      : undefined;

  const topic = (config.topic ?? "").trim();
  const hasWildcard = topic.includes("+") || topic.includes("#");

  const countdown = useMemo(() => {
    if (!config.enabled || !nextRun) return "";
    const diff = nextRun.getTime() - currentTimeMs;
    if (diff <= 0) return "now";
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h || d) parts.push(`${h}h`);
    if (m || h || d) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(" ");
  }, [config.enabled, nextRun, currentTimeMs]);

  const progressPercent = useMemo(() => {
    if (!config.enabled || !cronStart || !nextRun) return 0;
    const total = nextRun.getTime() - cronStart.getTime();
    if (total <= 0) return 0;
    const elapsed = currentTimeMs - cronStart.getTime();
    return Math.max(0, Math.min(100, (elapsed / total) * 100));
  }, [config.enabled, cronStart, nextRun, currentTimeMs]);

  if (!topic) {
    return (
      <div className="flex items-center justify-center h-full text-base-content/40 text-xs">
        No topic configured — open settings to add topic
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-2 h-full">
      <div className="flex items-center justify-between flex-none">
        <span
          className="text-sm font-mono bg-base-200 rounded px-2 py-1"
          title={presetTitle}
        >
          {prettyPreset}
        </span>
        <input
          type="checkbox"
          className="toggle toggle-primary"
          checked={config.enabled ?? false}
          disabled={toggling || !config.cron_expr || hasWildcard}
          title={hasWildcard ? "Cannot publish to wildcard topics (+ or #)" : undefined}
          onChange={(e) => handleToggle(e.target.checked)}
        />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center w-full min-w-0">
        {config.enabled && countdown && (
          <div className="text-center w-full">
            <div className="text-xs text-base-content/50 mb-2">Next run in</div>
            <div className="text-2xl font-bold font-mono mb-3">{countdown}</div>
            <progress
              className="progress progress-primary w-full"
              value={progressPercent}
              max="100"
            />
          </div>
        )}
        {config.enabled && !countdown && (
          <div className="flex flex-col items-center justify-center gap-2 w-full py-6">
            <span className="loading loading-spinner loading-md text-primary" />
            <div className="text-xs text-base-content/50">
              Waiting for next run…
            </div>
          </div>
        )}
        {!config.enabled && config.cron_expr && (
          <div className="flex flex-col items-center justify-center gap-3 w-full py-6 bg-gradient-to-br from-warning/10 to-warning/5 rounded-lg border border-warning/20">
            <CiPause1 className="text-5xl text-warning" />
            <div className="text-lg font-semibold text-warning">Job paused</div>
            <div className="text-xs text-warning/60">
              Enable to resume scheduling
            </div>
          </div>
        )}
        {!config.cron_expr && (
          <div className="text-xs text-base-content/40 text-center">
            Configure via gear icon
          </div>
        )}
      </div>
    </div>
  );
}
