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

const MAX_HIST = 3600;
const ACCENT = "#6b5de8";
const GRID_C = "#2a2b2e";
const TEXT_C = "#6b7280";

export interface BrokerStatsConfig {
  topic?: string;
  defaultRange?: TimeRange;
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
                { topic: topic.trim(), defaultRange },
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

interface TopicStat {
  count: number;
  lastSeen: number; // epoch ms
  rate: number; // msgs/sec (rolling)
}

interface Aggregates {
  secondCounter: number;
  rateHist: number[];
  total: number;
  lastMin: number;
  dataBytes: number;
  topics: Map<string, TopicStat>;
  tickCount: number;
}

function emptyAggregates(): Aggregates {
  return {
    secondCounter: 0,
    rateHist: [],
    total: 0,
    lastMin: 0,
    dataBytes: 0,
    topics: new Map(),
    tickCount: 0,
  };
}

interface Snapshot {
  rate: number;
  delta: number;
  total: number;
  lastMin: number;
  dataKb: number;
  liveTime: string;
  topics: { topic: string; count: number; rate: number; lastSeen: number }[];
  rateHist: number[];
  now: number;
}

const EMPTY_SNAPSHOT: Snapshot = {
  rate: 0,
  delta: 0,
  total: 0,
  lastMin: 0,
  dataKb: 0,
  liveTime: "—",
  topics: [],
  rateHist: [],
  now: 0,
};

function buildSnapshot(agg: Aggregates): Snapshot {
  const hist = agg.rateHist;
  const rate = hist.length > 0 ? hist[hist.length - 1] : 0;
  const prev = hist.length > 1 ? hist[hist.length - 2] : 0;
  const topics = [...agg.topics.entries()]
    .map(([topic, s]) => ({
      topic,
      count: s.count,
      rate: s.rate,
      lastSeen: s.lastSeen,
    }))
    .sort((a, b) => b.count - a.count);
  return {
    rate,
    delta: rate - prev,
    total: agg.total,
    lastMin: agg.lastMin,
    dataKb: agg.dataBytes / 1024,
    liveTime: new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    topics,
    rateHist: hist.slice(),
    now: Date.now(),
  };
}

interface BrokerStatsPanelProps {
  panelId: string;
  brokerId: string;
  config: BrokerStatsConfig;
}

function formatAge(lastSeen: number, now: number): string {
  const age = Math.max(0, Math.floor((now - lastSeen) / 1000));
  if (age < 3) return "now";
  if (age < 60) return `${age}s`;
  return `${Math.floor(age / 60)}m`;
}

export default function BrokerStatsPanel({
  panelId,
  brokerId,
  config,
}: BrokerStatsPanelProps) {
  const topicFilter = config.topic?.trim() || "#";
  const [currentRange, setCurrentRange] = useState<TimeRange>(
    config.defaultRange ?? 60,
  );
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);

  // All live aggregation happens in this ref, mutated only from the WS
  // callback and the 1s interval — never read during render.
  const aggRef = useRef<Aggregates>(emptyAggregates());
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Reset aggregates when the broker / topic filter changes. The next
  // interval tick (<1s) publishes a fresh snapshot, so no setState here.
  useEffect(() => {
    aggRef.current = emptyAggregates();
  }, [brokerId, topicFilter]);

  const { subscribe } = useWebSocket({
    onMessage: (data) => {
      try {
        const msg = JSON.parse(data) as { topic: string; payload: string };
        const agg = aggRef.current;
        agg.secondCounter += 1;
        agg.total += 1;
        agg.lastMin += 1;
        agg.dataBytes += new Blob([msg.payload ?? ""]).size;
        const existing = agg.topics.get(msg.topic);
        if (existing) {
          existing.count += 1;
          existing.lastSeen = Date.now();
        } else {
          agg.topics.set(msg.topic, {
            count: 1,
            lastSeen: Date.now(),
            rate: 0,
          });
        }
      } catch (error) {
        void error;
      }
    },
  });

  // Subscribe to the topic filter (default all topics).
  useEffect(() => {
    if (!brokerId) return;
    subscribe({
      panel_id: panelId,
      broker_id: brokerId,
      topics: [topicFilter],
    });
  }, [panelId, brokerId, topicFilter, subscribe]);

  // Seed topic breakdown / totals from history on mount.
  useEffect(() => {
    if (!brokerId) return;
    let cancelled = false;
    api
      .getExplorerHistory(brokerId, topicFilter)
      .catch(() => [])
      .then((records) => {
        if (cancelled || records.length === 0) return;
        const agg = aggRef.current;
        for (const r of records) {
          const seen = new Date(r.timestamp).getTime();
          const existing = agg.topics.get(r.topic);
          if (existing) {
            existing.count += 1;
            existing.lastSeen = Math.max(existing.lastSeen, seen);
          } else {
            agg.topics.set(r.topic, { count: 1, lastSeen: seen, rate: 0 });
          }
          agg.total += 1;
          agg.dataBytes += new Blob([r.payload ?? ""]).size;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [brokerId, topicFilter]);

  // Per-second aggregation tick: roll up counters and publish a snapshot.
  useEffect(() => {
    const id = setInterval(() => {
      const agg = aggRef.current;
      agg.tickCount += 1;
      agg.rateHist.push(agg.secondCounter);
      agg.secondCounter = 0;
      if (agg.rateHist.length > MAX_HIST) agg.rateHist.shift();

      // Distribute an overall rolling rate across topics by volume share.
      const totalC =
        [...agg.topics.values()].reduce((a, s) => a + s.count, 0) || 1;
      const recent = agg.rateHist.slice(-5);
      const avgRate = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
      const topicCount = agg.topics.size || 1;
      for (const s of agg.topics.values()) {
        s.rate = +(avgRate * (s.count / totalC) * topicCount).toFixed(2);
      }

      setSnapshot(buildSnapshot(agg));
      if (agg.tickCount % 60 === 0) agg.lastMin = 0;
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Draw the chart whenever the snapshot or range changes.
  useEffect(() => {
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

    const data = snapshot.rateHist.slice(-currentRange);
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

    // X-axis labels
    ctx.fillStyle = TEXT_C;
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    const ticks = Math.min(6, data.length);
    for (let i = 0; i < ticks; i++) {
      const idx =
        ticks > 1 ? Math.round((i * (data.length - 1)) / (ticks - 1)) : 0;
      const age = data.length - 1 - idx;
      ctx.fillText(age === 0 ? "now" : `-${age}s`, xOf(idx), H - 3);
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
  }, [snapshot, currentRange]);

  const handleReset = () => {
    aggRef.current = emptyAggregates();
    setSnapshot(EMPTY_SNAPSHOT);
  };

  const { rate, delta, total, lastMin, dataKb, liveTime, topics, now } =
    snapshot;
  const maxCount = Math.max(1, ...topics.map((t) => t.count));

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Time range bar */}
      <div className="flex items-center gap-1 px-1 pb-1.5 border-b border-base-300">
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
            className={`text-[11px] tabular-nums mt-1 min-h-[14px] ${
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
          <div className="text-[11px] tabular-nums mt-1 min-h-[14px] text-success">
            +{lastMin.toLocaleString()} last min
          </div>
        </div>
        <div className="px-2 py-2 border-r border-base-300">
          <div className="text-[10px] uppercase tracking-wide text-base-content/45">
            Active topics
          </div>
          <div className="text-xl font-semibold tabular-nums leading-none mt-1">
            {topics.length}
          </div>
          <div className="min-h-[14px] mt-1">&nbsp;</div>
        </div>
        <div className="px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-base-content/45">
            Data in
          </div>
          <div className="text-xl font-semibold tabular-nums leading-none mt-1">
            {dataKb.toFixed(1)}
            <span className="text-xs font-normal text-base-content/50">
              {" "}
              kb
            </span>
          </div>
          <div className="min-h-[14px] mt-1">&nbsp;</div>
        </div>
      </div>

      {/* Chart */}
      <div className="px-2 py-2 border-b border-base-300">
        <div className="text-[10px] uppercase tracking-wide text-base-content/45 mb-2">
          Message rate — last {RANGE_LABELS[currentRange]}
        </div>
        <canvas ref={canvasRef} className="block w-full h-[88px]" />
      </div>

      {/* Topic breakdown */}
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
            Waiting for messages…
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
                {t.rate.toFixed(1)}/s
              </div>
              <div className="w-20 h-[3px] rounded-full bg-base-300 overflow-hidden shrink-0">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${(t.count / maxCount) * 100}%` }}
                />
              </div>
              <div className="w-12 text-right text-base-content/70 tabular-nums">
                {t.count.toLocaleString()}
              </div>
              <div className="w-12 text-right text-base-content/40">
                {formatAge(t.lastSeen, now)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end px-2 py-1.5 border-t border-base-300 text-[10px] text-base-content/45">
        <button className="btn btn-ghost btn-xs" onClick={handleReset}>
          Reset counters
        </button>
      </div>
    </div>
  );
}
