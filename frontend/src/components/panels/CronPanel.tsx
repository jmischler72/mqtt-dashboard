import { useState, useEffect, useMemo, useCallback } from "react";
import { RiSearchLine } from "react-icons/ri";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";

export interface CronConfig {
  cron_expr?: string;
  topic?: string;
  payload?: string;
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
                { cron_expr: cronExpr, topic, payload, enabled },
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

  const fetchStatus = useCallback(() => {
    api
      .get<{ next_run: string }>(`/api/cron/${panelId}`)
      .then((r) => {
        setNextRun(new Date(r.next_run));
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

  return (
    <div className="flex flex-col gap-3 p-2 h-full">
      <div className="flex items-center justify-between">
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
      {config.topic && (
        <div className="text-xs text-base-content/60">
          Topic: <span className="font-mono text-accent">{config.topic}</span>
        </div>
      )}
      {config.enabled && countdown && (
        <div className="text-center">
          <div className="text-xs text-base-content/50">Next run in</div>
          <div className="text-2xl font-bold font-mono">{countdown}</div>
        </div>
      )}
      {!config.cron_expr && (
        <div className="text-xs text-base-content/40 text-center mt-auto">
          Configure via gear icon
        </div>
      )}
    </div>
  );
}
