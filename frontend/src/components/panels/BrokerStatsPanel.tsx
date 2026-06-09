import { useState, useEffect, useRef } from "react";
import { RiSearchLine } from "react-icons/ri";
import { useWebSocket } from "../../hooks/useWebSocket";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";

type TimeRange = 60 | 300 | 900 | 3600;

const RANGE_LABELS: Record<TimeRange, string> = {
  60: "60 s",
  300: "5 min",
  900: "15 min",
  3600: "1 hr",
};

const RANGE_OPTIONS: { value: TimeRange; pill: string }[] = [
  { value: 60, pill: "1m" },
  { value: 300, pill: "5m" },
  { value: 900, pill: "15m" },
  { value: 3600, pill: "1h" },
];

// How often to re-fetch the history-backed series, scaled to the range so the
// view stays live without hammering the backend on wide windows.
const REFRESH_MS: Record<TimeRange, number> = {
  60: 2000,
  300: 5000,
  900: 10000,
  3600: 30000,
};

const ACCENT = "#6b5de8";
const GRID_C = "#2a2b2e";
const TEXT_C = "#6b7280";

export interface BrokerStatsConfig {
  topic?: string;
  defaultRange?: TimeRange;
  showStatTiles?: boolean;
  showChart?: boolean;
  showTopicBreakdown?: boolean;
}

interface ModalProps {
  config: BrokerStatsConfig;
  brokerId: string;
  brokerStatuses: BrokerStatus[];
  onSave: (cfg: BrokerStatsConfig, brokerId: string) => void;
  onClose: () => void;
  onPickTopic?: (data: {
    currentTopic: string;
    selectedBrokerId: string;
    draftConfig?: BrokerStatsConfig;
  }) => void;
  initialTopic?: string;
  initialBrokerId?: string;
}

export function BrokerStatsConfigModal({
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
  const [defaultRange, setDefaultRange] = useState<TimeRange>(
    config.defaultRange ?? 60,
  );
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || defaultBrokerId,
  );
  const [showStatTiles, setShowStatTiles] = useState(
    config.showStatTiles !== false,
  );
  const [showChart, setShowChart] = useState(config.showChart !== false);
  const [showTopicBreakdown, setShowTopicBreakdown] = useState(
    config.showTopicBreakdown !== false,
  );

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-h-[85vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-4">Broker Stats Configuration</h3>
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
            <legend className="fieldset-legend">
              Topic Filter (wildcards OK, empty = all topics)
            </legend>
            <div className="join w-full">
              <input
                className="input input-bordered join-item flex-1 font-mono"
                type="text"
                placeholder="# (all topics)"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
              {onPickTopic && (
                <button
                  type="button"
                  className="btn btn-outline join-item"
                  title="Browse topics in Explorer"
                  onClick={() =>
                    onPickTopic({
                      currentTopic: "",
                      selectedBrokerId,
                      draftConfig: { topic, defaultRange },
                    })
                  }
                >
                  <RiSearchLine />
                </button>
              )}
            </div>
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Default Time Range</legend>
            <select
              className="select select-bordered w-full"
              value={defaultRange}
              onChange={(e) =>
                setDefaultRange(Number(e.target.value) as TimeRange)
              }
            >
              <option value={60}>1 minute</option>
              <option value={300}>5 minutes</option>
              <option value={900}>15 minutes</option>
              <option value={3600}>1 hour</option>
            </select>
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Visible Sections</legend>
            <div className="flex flex-col gap-2">
              {(
                [
                  [showStatTiles, setShowStatTiles, "Stat tiles"],
                  [showChart, setShowChart, "Chart"],
                  [showTopicBreakdown, setShowTopicBreakdown, "Topic breakdown"],
                ] as [boolean, (v: boolean) => void, string][]
              ).map(([value, setter, label]) => (
                <label key={label} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="toggle toggle-sm toggle-primary"
                    checked={value}
                    onChange={(e) => setter(e.target.checked)}
                  />
                  <span className="label-text">{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="modal-action">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={brokerStatuses.length === 0}
            onClick={() =>
              onSave(
                {
                  topic: topic.trim(),
                  defaultRange,
                  showStatTiles,
                  showChart,
                  showTopicBreakdown,
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

interface ActivityTopic {
  topic: string;
  count: number;
  lastSeenMs: number;
}

interface ActivityData {
  bucketSeconds: number;
  counts: number[]; // dense, oldest -> newest, length = buckets
  total: number;
  totalBytes: number;
  topics: ActivityTopic[];
}

interface LiveRate {
  rate: number; // msgs/sec over the last second
  delta: number; // change vs the previous second
  liveTime: string;
  nowMs: number;
}

interface BrokerStatsPanelProps {
  panelId: string;
  brokerId: string;
  config: BrokerStatsConfig;
}

// Parse a SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS") into epoch ms.
function parseTs(value: string): number {
  if (!value) return 0;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value)
    ? value
    : value.replace(" ", "T") + "Z";
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function formatAge(lastSeen: number, now: number): string {
  if (lastSeen === 0) return "—";
  const age = Math.max(0, Math.floor((now - lastSeen) / 1000));
  if (age < 3) return "now";
  if (age < 60) return `${age}s`;
  return `${Math.floor(age / 60)}m`;
}

function secAgoLabel(n: number): string {
  if (n <= 0) return "now";
  if (n < 60) return `-${n}s`;
  return `-${Math.round(n / 60)}m`;
}

export default function BrokerStatsPanel({
  panelId,
  brokerId,
  config,
}: BrokerStatsPanelProps) {
  const topicFilter = config.topic?.trim() || "#";
  const showStatTiles = config.showStatTiles !== false;
  const showChart = config.showChart !== false;
  const showTopicBreakdown = config.showTopicBreakdown !== false;
  const [currentRange, setCurrentRange] = useState<TimeRange>(
    config.defaultRange ?? 60,
  );
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [liveRate, setLiveRate] = useState<LiveRate>(() => ({
    rate: 0,
    delta: 0,
    liveTime: "—",
    nowMs: Date.now(),
  }));

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Live overlay accumulators — mutated only in callbacks, never read in render.
  const liveCounterRef = useRef(0); // resets every second (drives Msg/sec tile)
  const lastRateRef = useRef(0); // previous second's rate (for the delta)
  const hoverBucketRef = useRef<number | null>(null);

  // History-backed series: fetch on change, then refresh on an interval.
  useEffect(() => {
    if (!brokerId) return;
    let cancelled = false;
    const load = () => {
      api
        .getActivity(brokerId, topicFilter, currentRange)
        .then((data) => {
          if (cancelled) return;
          setActivity({
            bucketSeconds: data.bucket_seconds,
            counts: data.buckets.map((b) => b.count),
            total: data.total,
            totalBytes: data.total_bytes,
            topics: data.topics.map((t) => ({
              topic: t.topic,
              count: t.count,
              lastSeenMs: parseTs(t.last_seen),
            })),
          });
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, REFRESH_MS[currentRange]);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [brokerId, topicFilter, currentRange]);

  const { subscribe } = useWebSocket({
    onMessage: () => {
      // The hub only delivers messages matching this panel's subscription.
      liveCounterRef.current += 1;
    },
  });

  useEffect(() => {
    if (!brokerId) return;
    subscribe({
      panel_id: panelId,
      broker_id: brokerId,
      topics: [topicFilter],
    });
  }, [panelId, brokerId, topicFilter, subscribe]);

  // Per-second tick: publish the live Msg/sec rate and a clock for ages.
  useEffect(() => {
    const id = setInterval(() => {
      const rate = liveCounterRef.current;
      liveCounterRef.current = 0;
      const delta = rate - lastRateRef.current;
      lastRateRef.current = rate;
      setLiveRate({
        rate,
        delta,
        liveTime: new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        nowMs: Date.now(),
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Chart drawing kept in a ref so resize and data effects share one closure.
  const drawRef = useRef<() => void>(() => {});
  useEffect(() => {
    drawRef.current = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const r = canvas.getBoundingClientRect();
      if (r.width === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const W = r.width;
      const H = r.height;
      ctx.clearRect(0, 0, W, H);

      const bucketSeconds = activity?.bucketSeconds ?? 1;
      const data = activity
        ? activity.counts.map((c) => c / bucketSeconds)
        : [];
      // Pin the last (incomplete) bucket to the live 1s rate so the right edge
      // stays smooth — avoids the spike/dip cycle caused by delta accumulation.
      if (data.length > 0) {
        data[data.length - 1] = liveRate.rate;
      }
      if (data.length === 0) return;

      const maxV = Math.max(...data, 0.5);
      const pad = { t: 8, b: 18, l: 28, r: 6 };
      const iW = W - pad.l - pad.r;
      const iH = H - pad.t - pad.b;
      const denom = data.length > 1 ? data.length - 1 : 1;
      const xOf = (i: number) => pad.l + (i / denom) * iW;
      const yOf = (v: number) => pad.t + iH - (v / (maxV * 1.15)) * iH;

      // Gridlines + y labels
      [0.25, 0.5, 0.75, 1].forEach((f) => {
        const y = pad.t + iH - f * iH;
        ctx.beginPath();
        ctx.strokeStyle = GRID_C;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.moveTo(pad.l, y);
        ctx.lineTo(W - pad.r, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = TEXT_C;
        ctx.font = "8px monospace";
        ctx.textAlign = "right";
        ctx.fillText((maxV * 1.15 * f).toFixed(1), pad.l - 4, y + 3);
      });

      // X-axis labels (time ago, based on bucket size)
      ctx.fillStyle = TEXT_C;
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      const ticks = Math.min(6, data.length);
      for (let i = 0; i < ticks; i++) {
        const idx =
          ticks > 1 ? Math.round((i * (data.length - 1)) / (ticks - 1)) : 0;
        const secAgo = (data.length - 1 - idx) * bucketSeconds;
        ctx.fillText(secAgoLabel(secAgo), xOf(idx), H - 3);
      }

      // Area gradient
      const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + iH);
      grad.addColorStop(0, "rgba(107,93,232,0.30)");
      grad.addColorStop(0.7, "rgba(107,93,232,0.06)");
      grad.addColorStop(1, "rgba(107,93,232,0.01)");
      ctx.beginPath();
      data.forEach((v, i) =>
        i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)),
      );
      ctx.lineTo(xOf(data.length - 1), pad.t + iH);
      ctx.lineTo(xOf(0), pad.t + iH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath();
      data.forEach((v, i) =>
        i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)),
      );
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = "round";
      ctx.stroke();

      // Live cursor dot
      const ex = xOf(data.length - 1);
      const ey = yOf(data[data.length - 1]);
      ctx.beginPath();
      ctx.arc(ex, ey, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(107,93,232,0.22)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = ACCENT;
      ctx.fill();

      // Hover crosshair + tooltip
      const hi = hoverBucketRef.current;
      if (hi !== null && hi >= 0 && hi < data.length) {
        const hx = xOf(hi);
        const hy = yOf(data[hi]);

        // Vertical rule
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.moveTo(hx, pad.t);
        ctx.lineTo(hx, pad.t + iH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Dot on the line
        ctx.beginPath();
        ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(hx, hy, 2, 0, Math.PI * 2);
        ctx.fillStyle = ACCENT;
        ctx.fill();

        // Tooltip
        const secAgo = (data.length - 1 - hi) * bucketSeconds;
        const label = `${data[hi].toFixed(2)}/s  ${secAgoLabel(secAgo)}`;
        ctx.font = "bold 9px monospace";
        const tw = ctx.measureText(label).width;
        const boxW = tw + 10;
        const boxH = 16;
        const tipX = Math.min(hx + 8, W - pad.r - boxW);
        const tipY = Math.max(hy - boxH - 4, pad.t);
        ctx.fillStyle = "rgba(15,15,20,0.88)";
        ctx.beginPath();
        ctx.roundRect(tipX, tipY, boxW, boxH, 3);
        ctx.fill();
        ctx.fillStyle = "#e5e7eb";
        ctx.textAlign = "left";
        ctx.fillText(label, tipX + 5, tipY + boxH - 4);
      }
    };
  });

  // Redraw when the data or the live tick changes.
  useEffect(() => {
    drawRef.current();
  }, [activity, liveRate, currentRange]);

  // Redraw on resize.
  useEffect(() => {
    const handler = () => drawRef.current();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const { rate, delta, liveTime, nowMs } = liveRate;
  const total = activity?.total ?? 0;
  const totalKb = (activity?.totalBytes ?? 0) / 1024;
  const topics = activity?.topics ?? [];
  const maxCount = Math.max(1, ...topics.map((t) => t.count));

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Time range bar */}
      <div className="flex items-center gap-1 px-1 pb-1.5 border-b border-base-300 overflow-hidden">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            className={`btn btn-xs btn-ghost rounded-full px-2.5 ${
              currentRange === opt.value
                ? "bg-primary/20 text-primary"
                : "text-base-content/50"
            }`}
            onClick={() => setCurrentRange(opt.value)}
          >
            {opt.pill}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-base-content/50 tabular-nums">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          {liveTime}
        </div>
      </div>

      {/* Stat tiles */}
      {showStatTiles && (
        <div className="grid grid-cols-4 border-b border-base-300">
          <div className="px-2 py-2 border-r border-base-300">
            <div className="text-[10px] uppercase tracking-wide text-base-content/45">
              Msg / sec
            </div>
            <div className="text-xl font-semibold tabular-nums leading-none mt-1">
              {rate.toFixed(1)}
              <span className="text-xs font-normal text-base-content/50">/s</span>
            </div>
            <div
              className={`text-[11px] tabular-nums mt-1 min-h-3.5 ${
                Math.abs(delta) < 0.05
                  ? "text-base-content/50"
                  : delta > 0
                    ? "text-success"
                    : "text-error"
              }`}
            >
              {Math.abs(delta) < 0.05
                ? "—"
                : delta > 0
                  ? `▲ ${delta.toFixed(1)}/s`
                  : `▼ ${Math.abs(delta).toFixed(1)}/s`}
            </div>
          </div>
          <div className="px-2 py-2 border-r border-base-300">
            <div className="text-[10px] uppercase tracking-wide text-base-content/45">
              Total msgs
            </div>
            <div className="text-xl font-semibold tabular-nums leading-none mt-1">
              {total.toLocaleString()}
            </div>
            <div className="text-[11px] tabular-nums mt-1 min-h-3.5 text-base-content/50">
              in {RANGE_LABELS[currentRange]}
            </div>
          </div>
          <div className="px-2 py-2 border-r border-base-300">
            <div className="text-[10px] uppercase tracking-wide text-base-content/45">
              Active topics
            </div>
            <div className="text-xl font-semibold tabular-nums leading-none mt-1">
              {topics.length}
            </div>
            <div className="min-h-3.5 mt-1">&nbsp;</div>
          </div>
          <div className="px-2 py-2">
            <div className="text-[10px] uppercase tracking-wide text-base-content/45">
              Data in
            </div>
            <div className="text-xl font-semibold tabular-nums leading-none mt-1">
              {totalKb.toFixed(1)}
              <span className="text-xs font-normal text-base-content/50">
                {" "}
                kb
              </span>
            </div>
            <div className="min-h-3.5 mt-1">&nbsp;</div>
          </div>
        </div>
      )}

      {/* Chart */}
      {showChart && (
        <div
          className={`px-2 py-2 border-b border-base-300 ${!showTopicBreakdown ? "flex-1 flex flex-col" : ""}`}
        >
          <div className="text-[10px] uppercase tracking-wide text-base-content/45 mb-2">
            Message rate — last {RANGE_LABELS[currentRange]}
          </div>
          <canvas
            ref={canvasRef}
            className={`block w-full ${!showTopicBreakdown ? "flex-1 min-h-22" : "h-22"}`}
            onMouseMove={(e) => {
              const canvas = canvasRef.current;
              if (!canvas || !activity) return;
              const rect = canvas.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const n = activity.counts.length;
              const iW = rect.width - 28 - 6;
              const idx = Math.round(((x - 28) / iW) * (n - 1));
              hoverBucketRef.current = Math.max(0, Math.min(n - 1, idx));
              drawRef.current();
            }}
            onMouseLeave={() => {
              hoverBucketRef.current = null;
              drawRef.current();
            }}
          />
        </div>
      )}

      {/* Topic breakdown */}
      {showTopicBreakdown && (
        <>
          <div className="flex items-center px-2 py-1.5 border-b border-base-300">
            <div className="flex-1 text-[10px] uppercase tracking-wide text-base-content/45">
              Topic breakdown
            </div>
            <div className="w-12 text-right text-[10px] uppercase text-base-content/45">
              rate
            </div>
            <div className="w-20" />
            <div className="w-12 text-right text-[10px] uppercase text-base-content/45">
              msgs
            </div>
            <div className="w-12 text-right text-[10px] uppercase text-base-content/45">
              last
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {topics.length === 0 ? (
              <div className="px-2 py-4 text-center text-base-content/40">
                No messages in this range
              </div>
            ) : (
              topics.map((t) => (
                <div
                  key={t.topic}
                  className="flex items-center gap-2 px-2 py-1.5 border-b border-base-200 hover:bg-base-content/5"
                >
                  <div className="flex-1 min-w-0 font-mono text-accent truncate">
                    {t.topic}
                  </div>
                  <div className="w-10 text-right text-base-content/50 tabular-nums">
                    {(t.count / currentRange).toFixed(1)}/s
                  </div>
                  <div className="w-20 h-0.75 rounded-full bg-base-300 overflow-hidden shrink-0">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: `${(t.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <div className="w-12 text-right text-base-content/70 tabular-nums">
                    {t.count.toLocaleString()}
                  </div>
                  <div className="w-12 text-right text-base-content/40">
                    {formatAge(t.lastSeenMs, nowMs)}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
