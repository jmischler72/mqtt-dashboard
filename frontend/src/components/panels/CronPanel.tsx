import { useState, useEffect, useMemo, useCallback } from "react";
import { CiPause1 } from "react-icons/ci";
import { MdSchedule } from "react-icons/md";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import {
  BrokerTopicCard,
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
  payloadRules,
  topicRules,
  useConfigValidation,
} from "./config";
import { usePanelSize } from "../../hooks/usePanelSize";
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
  const fallbackBroker = defaultBrokerId(brokerStatuses);
  const initialCronState = useMemo(() => {
    if (!config.cron_expr) return { preset: "* * * * *", customExpr: "" };
    const found = PRESETS.find((p) => p.value === config.cron_expr);
    if (found) return { preset: found.value, customExpr: config.cron_expr };
    return { preset: "custom", customExpr: config.cron_expr };
  }, [config.cron_expr]);

  const [topic, setTopic] = useState(initialTopic ?? config.topic ?? "");
  // Not run through `migrateTemplate`: a schedule publishes a literal, so a
  // `\u25c6` in it is a character the device asked for, not an old chip.
  const [payload, setPayload] = useState(config.payload ?? "");
  const [enabled, setEnabled] = useState(config.enabled ?? false);
  const [qos, setQos] = useState(config.qos ?? 0);
  const [retain, setRetain] = useState(config.retain ?? false);
  const [preset, setPreset] = useState(initialCronState.preset);
  const [customExpr, setCustomExpr] = useState(initialCronState.customExpr);
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || fallbackBroker,
  );
  const [touched, setTouched] = useState(Boolean(config.topic));

  const isCustom = preset === "custom";
  const cronExpr = isCustom ? customExpr : preset;
  const cronError = isCustom ? validateCron(customExpr) : null;
  const cronDescription =
    isCustom && !cronError ? describeCron(customExpr) : null;
  const presetLabel =
    PRESETS.find((p) => p.value === preset)?.label ?? "Custom";

  const { fieldErrors, blockerReason } = useConfigValidation(
    [
      ...brokerRules(brokerStatuses.length),
      {
        field: "schedule",
        when: Boolean(cronError),
        message: cronError ?? "",
      },
      ...topicRules({ topic }),
      // The schedule supplies the moment, not a value, so the message is fixed
      // bytes and a chip would publish an empty hole.
      ...payloadRules({
        value: payload,
        mode: "write",
        acceptsChip: false,
        allowEmpty: true,
        subject: "a schedule has",
      }),
    ],
    { touched },
  );

  const topicCount = topic.split(",").filter((t) => t.trim()).length;

  return (
    <PanelConfigModal
      icon={MdSchedule}
      title="Cron Configuration"
      brokerStatus={brokerPresence(brokerStatuses, selectedBrokerId)}
      blockerReason={blockerReason}
      onCancel={onClose}
      onSave={() =>
        onSave(
          { cron_expr: cronExpr, topic, payload, qos, retain, enabled },
          selectedBrokerId || fallbackBroker,
        )
      }
    >
      {/* The schedule decides when the bytes go out, so it belongs to Publish
          rather than to a group of its own. */}
      <ConfigGroup heading="Publish">
        <ConfigCard
          title="Schedule"
          summary={isCustom ? (cronDescription ?? customExpr) : presetLabel}
          invalid={Boolean(fieldErrors.schedule)}
        >
          <FieldRow label="Runs">
            <select
              className="select select-bordered w-full min-w-0 h-8 min-h-8 text-xs"
              aria-label="Schedule preset"
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value);
                setTouched(true);
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </FieldRow>

          {isCustom && (
            <FieldRow
              label="Cron"
              invalid={Boolean(fieldErrors.schedule)}
              help={fieldErrors.schedule ?? cronDescription ?? undefined}
            >
              <input
                className={`input input-bordered w-full min-w-0 h-8 min-h-8 font-mono text-xs ${
                  fieldErrors.schedule ? "input-warning" : ""
                }`}
                aria-label="Cron expression"
                spellCheck={false}
                placeholder="* * * * *"
                value={customExpr}
                onChange={(e) => {
                  setCustomExpr(e.target.value);
                  setTouched(true);
                }}
              />
            </FieldRow>
          )}

          <SwitchRow
            name="Run this schedule"
            note="Publishes on the schedule above. The schedule is kept either way."
            on={enabled}
            onToggle={setEnabled}
          />
        </ConfigCard>

        <BrokerTopicCard
          title="Publishes to"
          summary={topicCount > 1 ? `${topicCount} topics` : undefined}
          brokers={brokerStatuses}
          brokerId={selectedBrokerId}
          onBrokerChange={setSelectedBrokerId}
          topic={topic}
          onTopicChange={(next) => {
            setTopic(next);
            setTouched(true);
          }}
          topicPlaceholder="devices/hub/cmd"
          topicError={fieldErrors.topic}
          help="Comma-separate to publish to several topics."
          onExplore={
            onPickTopic
              ? () => onPickTopic({ currentTopic: topic, selectedBrokerId })
              : undefined
          }
        />

        <DisclosureCard
          title="Message"
          summary={<PayloadSummary value={payload} empty="empty message" />}
          defaultOpen={payload.trim() === ""}
          invalid={Boolean(fieldErrors.payload)}
        >
          <PayloadBuilder
            mode="write"
            value={payload}
            onChange={setPayload}
            acceptsChip={false}
            brokerId={selectedBrokerId}
            topic={topic}
            placeholder='{"ping":true}'
          />
          {fieldErrors.payload && (
            <span className="text-[11px] text-warning">
              {fieldErrors.payload}
            </span>
          )}
        </DisclosureCard>

        <PublishOptionsCard
          qos={qos}
          onQosChange={setQos}
          retain={retain}
          onRetainChange={setRetain}
        />
      </ConfigGroup>
    </PanelConfigModal>
  );
}

// Countdown is the panel's hero text, but it should not dwarf a large panel.
const MAX_COUNTDOWN_FONT_SIZE = 34;

interface CronPanelProps {
  panelId: string;
  brokerId?: string;
  config: CronConfig;
  onConfigChange?: (cfg: Partial<CronConfig>) => void;
}

export default function CronPanel({
  panelId,
  config,
  onConfigChange,
}: CronPanelProps) {
  const { ref: containerRef, size: dimensions } =
    usePanelSize<HTMLDivElement>();
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
      onConfigChange?.({ ...config, enabled });
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

  // Dynamic Sizing derived from container dimensions
  const availW = Math.max(80, (dimensions.width || 260) - 16);
  const availH = Math.max(80, (dimensions.height || 200) - 16);

  // Header: schedule chip + enable toggle
  const headerFontSize = Math.max(
    10,
    Math.min(Math.round(Math.min(availH * 0.09, availW * 0.05)), 16),
  );
  const toggleClass =
    availW < 180 || availH < 130
      ? "toggle-xs"
      : availW < 300 && availH < 220
        ? "toggle-sm"
        : availW > 460 && availH > 320
          ? "toggle-lg"
          : "toggle-md";

  // Countdown block: hero text scales on both axes so long values still fit.
  const countdownLen = Math.max(1, countdown.length);
  const countdownFontSize = Math.max(
    16,
    Math.floor(
      Math.min(
        availH * 0.28,
        availW / (countdownLen * 0.62),
        MAX_COUNTDOWN_FONT_SIZE,
      ),
    ),
  );
  const captionFontSize = Math.max(
    9,
    Math.round(Math.min(countdownFontSize * 0.4, availH * 0.09)),
  );
  const progressHeight = Math.max(5, Math.min(Math.round(availH * 0.09), 22));

  // Paused / waiting states
  const stateIconSize = Math.max(
    22,
    Math.floor(Math.min(availH * 0.28, availW * 0.24, 56)),
  );
  const stateTitleFontSize = Math.max(
    12,
    Math.floor(Math.min(availH * 0.12, availW * 0.08, 20)),
  );
  const stateHintFontSize = Math.max(9, Math.round(stateTitleFontSize * 0.6));

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-2 p-2 h-full overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 flex-none min-w-0">
        <span
          className="font-mono bg-base-200 rounded px-2 py-1 truncate leading-tight"
          style={{ fontSize: `${headerFontSize}px` }}
          title={presetTitle ?? prettyPreset}
        >
          {prettyPreset}
        </span>
        <input
          type="checkbox"
          className={`toggle toggle-primary shrink-0 ${toggleClass}`}
          checked={config.enabled ?? false}
          disabled={toggling || !config.cron_expr || hasWildcard}
          title={
            hasWildcard
              ? "Cannot publish to wildcard topics (+ or #)"
              : undefined
          }
          onChange={(e) => handleToggle(e.target.checked)}
        />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center w-full min-w-0 min-h-0 overflow-hidden">
        {config.enabled && countdown && (
          <div className="text-center w-full px-1">
            <div
              className="text-base-content/50 mb-1"
              style={{ fontSize: `${captionFontSize}px` }}
            >
              Next run in
            </div>
            <div
              className="font-bold font-mono mb-2 leading-none truncate"
              style={{ fontSize: `${countdownFontSize}px` }}
            >
              {countdown}
            </div>
            <progress
              className="progress progress-primary w-full rounded-lg"
              style={{ height: `${progressHeight}px` }}
              value={progressPercent}
              max="100"
            />
          </div>
        )}
        {config.enabled && !countdown && (
          <div className="flex flex-col items-center justify-center gap-2 w-full">
            <span
              className="loading loading-spinner text-primary"
              style={{
                width: `${Math.max(16, Math.round(stateIconSize * 0.5))}px`,
                height: `${Math.max(16, Math.round(stateIconSize * 0.5))}px`,
              }}
            />
            <div
              className="text-base-content/50 text-center"
              style={{ fontSize: `${stateHintFontSize}px` }}
            >
              Waiting for next run…
            </div>
          </div>
        )}
        {!config.enabled && config.cron_expr && (
          <div className="flex flex-col items-center justify-center gap-1.5 w-full h-full bg-gradient-to-br from-warning/10 to-warning/5 rounded-lg border border-warning/20 overflow-hidden px-2 text-center">
            <CiPause1
              className="text-warning shrink-0"
              style={{ fontSize: `${stateIconSize}px` }}
            />
            <div
              className="font-semibold text-warning leading-tight"
              style={{ fontSize: `${stateTitleFontSize}px` }}
            >
              Job paused
            </div>
            <div
              className="text-warning/60 leading-tight"
              style={{ fontSize: `${stateHintFontSize}px` }}
            >
              Enable to resume scheduling
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
