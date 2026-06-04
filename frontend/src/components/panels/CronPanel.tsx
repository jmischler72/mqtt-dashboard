import { useState, useEffect, useMemo, useCallback } from "react";
import { RiSearchLine } from "react-icons/ri";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import { CiPause1 } from "react-icons/ci";

export interface CronConfig {
  cron_expr?: string;
  topic?: string;
  payload?: string;
  qos?: number;
  retain?: boolean;
  enabled?: boolean;
}

// Visual Cron Builder maps friendly options to cron expressions
const PRESETS: { label: string; value: string }[] = [
  { label: "Every minute", value: "* * * * *" },
  { label: "Every 5 minutes", value: "*/5 * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every 30 minutes", value: "*/30 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Daily at noon", value: "0 12 * * *" },
  { label: "Weekly (Sunday midnight)", value: "0 0 * * 0" },
  { label: "Custom", value: "custom" },
];

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

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-h-[85vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-4">Cron Configuration</h3>
        <div className="flex flex-col gap-3">
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Broker</legend>
            {brokerStatuses.length === 0 ? (
              <div role="alert" className="alert alert-warning py-2">
                <span className="text-sm">
                  No brokers configured.{" "}
                  <a href="/config" className="underline">
                    Add one in the Config page.
                  </a>
                </span>
              </div>
            ) : (
              <select
                className="select select-bordered w-full"
                value={selectedBrokerId}
                onChange={(e) => setSelectedBrokerId(e.target.value)}
              >
                {brokerStatuses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Schedule</legend>
            <select
              className="select select-bordered w-full"
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
            <fieldset className="fieldset">
              <legend className="fieldset-legend">
                Cron Expression (5 fields)
              </legend>
              <input
                className="input input-bordered w-full font-mono"
                placeholder="* * * * *"
                value={customExpr}
                onChange={(e) => setCustomExpr(e.target.value)}
              />
              <p className="fieldset-label">min hour day month weekday</p>
            </fieldset>
          )}
          {!isCustom && (
            <div className="text-xs font-mono bg-base-200 rounded px-3 py-2">
              Expression: <strong>{cronExpr}</strong>
            </div>
          )}
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Topic</legend>
            <div className="flex gap-1 w-full">
              <input
                className="input input-bordered flex-1"
                placeholder="home/trigger"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
              {onPickTopic && (
                <button
                  type="button"
                  className="btn btn-outline"
                  title="Browse topics in Explorer"
                  onClick={() =>
                    onPickTopic({ currentTopic: topic, selectedBrokerId })
                  }
                >
                  <RiSearchLine />
                </button>
              )}
            </div>
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Payload</legend>
            <textarea
              className="textarea textarea-bordered w-full font-mono"
              rows={2}
              placeholder='{"ping": true}'
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
            />
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Enabled</legend>
            <label className="label cursor-pointer justify-start gap-3 px-0">
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span className="label-text">Run this schedule</span>
            </label>
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">MQTT Options</legend>
            <div className="flex gap-4 flex-wrap">
              <label className="flex items-center gap-2">
                <span className="text-sm">QoS</span>
                <select
                  className="select select-sm select-bordered"
                  value={qos}
                  onChange={(e) => setQos(Number(e.target.value))}
                >
                  <option value={0}>0 – At most once</option>
                  <option value={1}>1 – At least once</option>
                  <option value={2}>2 – Exactly once</option>
                </select>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-sm">Retain</span>
                <input
                  type="checkbox"
                  className="toggle toggle-sm toggle-primary"
                  checked={retain}
                  onChange={(e) => setRetain(e.target.checked)}
                />
              </label>
            </div>
          </fieldset>
        </div>
        <div className="modal-action">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!topic || !cronExpr || brokerStatuses.length === 0}
            onClick={() =>
              onSave(
                { cron_expr: cronExpr, topic, payload, qos, retain, enabled },
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
  const [countdown, setCountdown] = useState("");
  const [toggling, setToggling] = useState(false);
  const [cronStart, setCronStart] = useState<Date | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());

  const fetchStatus = useCallback(() => {
    api
      .get<{ next_run: string }>(`/api/cron/${panelId}`)
      .then((r) => {
        setNextRun(new Date(r.next_run));
        setCronStart(new Date());
      })
      .catch((error) => {
        void error;
      });
  }, [panelId]);

  useEffect(() => {
    if (config.cron_expr) fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [config.cron_expr, fetchStatus]);

  useEffect(() => {
    if (!nextRun) return;
    const tick = setInterval(() => {
      const diff = nextRun.getTime() - Date.now();
      if (diff <= 0) {
        setCountdown("now");
        fetchStatus();
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${m}m ${s}s`);
    }, 1000);
    return () => clearInterval(tick);
  }, [nextRun, fetchStatus]);

  useEffect(() => {
    if (!config.enabled || !nextRun || !cronStart) return;
    const clock = setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 1000);
    return () => clearInterval(clock);
  }, [config.enabled, nextRun, cronStart]);

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      await api.put(`/api/cron/${panelId}/toggle`, { enabled });
      onConfigChange({ ...config, enabled });
      if (enabled) fetchStatus();
    } catch (error) {
      void error;
    }
    setToggling(false);
  };

  const prettyPreset = config.cron_expr
    ? (PRESETS.find((p) => p.value === config.cron_expr)?.label ??
      config.cron_expr)
    : "Not configured";

  const progressPercent =
    cronStart && nextRun
      ? Math.min(
          100,
          ((currentTimeMs - cronStart.getTime()) /
            (nextRun.getTime() - cronStart.getTime())) *
            100,
        )
      : 0;

  return (
    <div className="flex flex-col gap-3 p-2 h-full">
      <div className="flex items-center justify-between flex-none">
        <span className="text-sm font-mono bg-base-200 rounded px-2 py-1">
          {prettyPreset}
        </span>
        <input
          type="checkbox"
          className="toggle toggle-primary"
          checked={config.enabled ?? false}
          disabled={toggling || !config.cron_expr}
          onChange={(e) => handleToggle(e.target.checked)}
        />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center w-80 mx-auto">
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
