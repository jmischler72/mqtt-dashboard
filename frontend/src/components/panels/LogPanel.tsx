import { useState, useEffect, useRef } from "react";
import { RiSearchLine } from "react-icons/ri";
import { useWebSocket } from "../../hooks/useWebSocket";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";

interface LogMessage {
  receivedAt: string;
  topic: string;
  payload: string;
  qos?: number;
  retained?: boolean;
  historical?: boolean;
}

export interface LogConfig {
  topics?: string;
  maxMessages?: number;
  dateFormat?: "time" | "full";
  showQos?: boolean;
  showRetained?: boolean;
}

interface ModalProps {
  config: LogConfig;
  brokerId: string;
  brokerStatuses: BrokerStatus[];
  onSave: (cfg: LogConfig, brokerId: string) => void;
  onClose: () => void;
  onPickTopic?: (data: {
    currentTopic: string;
    selectedBrokerId: string;
    draftConfig?: LogConfig;
  }) => void;
  initialTopic?: string;
  initialBrokerId?: string;
}

export function LogConfigModal({
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
  const [topics, setTopics] = useState(initialTopic ?? config.topics ?? "");
  const [maxMessages, setMaxMessages] = useState(config.maxMessages ?? 200);
  const [dateFormat, setDateFormat] = useState<"time" | "full">(
    config.dateFormat ?? "time",
  );
  const [showQos, setShowQos] = useState(config.showQos ?? false);
  const [showRetained, setShowRetained] = useState(
    config.showRetained ?? false,
  );
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || defaultBrokerId,
  );

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-h-[85vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-4">Log Configuration</h3>
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
              Subscription Topics (comma-separated, wildcards OK)
            </legend>
            <textarea
              className="textarea textarea-bordered w-full font-mono"
              rows={3}
              placeholder="sensors/#, home/+/status"
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
            />
            {onPickTopic && (
              <button
                type="button"
                className="btn btn-outline mt-1 self-end aspect-square"
                title="Browse topics in Explorer"
                onClick={() =>
                  onPickTopic({
                    currentTopic: "",
                    selectedBrokerId,
                    draftConfig: {
                      topics,
                      maxMessages,
                      dateFormat,
                      showQos,
                      showRetained,
                    },
                  })
                }
              >
                <RiSearchLine />
              </button>
            )}
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Max Messages</legend>
            <input
              className="input input-bordered w-full"
              type="number"
              min={1}
              max={1000}
              value={maxMessages}
              onChange={(e) => setMaxMessages(Number(e.target.value))}
            />
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Timestamp Format</legend>
            <select
              className="select select-bordered w-full"
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value as "time" | "full")}
            >
              <option value="time">Time only (current)</option>
              <option value="full">Full date and time</option>
            </select>
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Display</legend>
            <div className="flex flex-col gap-2">
              {(
                [
                  [showQos, setShowQos, "Show QoS level"],
                  [showRetained, setShowRetained, "Show retain flag"],
                ] as [boolean, (v: boolean) => void, string][]
              ).map(([value, setter, label]) => (
                <label
                  key={label}
                  className="flex items-center gap-3 cursor-pointer"
                >
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
                { topics, maxMessages, dateFormat, showQos, showRetained },
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

function formatTimestamp(date: Date, format: "time" | "full") {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  if (format === "full") {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }
  return date.toLocaleTimeString();
}

function normalizeTimestamp(value: string | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

interface LogPanelProps {
  panelId: string;
  brokerId: string;
  config: LogConfig;
}

export default function LogPanel({ panelId, brokerId, config }: LogPanelProps) {
  const [messages, setMessages] = useState<LogMessage[]>([]);
  const [paused, setPaused] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);
  const shouldAutoScrollRef = useRef(true);
  const maxMessages = config.maxMessages ?? 200;
  const dateFormat = config.dateFormat ?? "time";
  const showQos = config.showQos ?? false;
  const showRetained = config.showRetained ?? false;
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    // Clear buffer when switching topic/broker to avoid stale lines.
    prevLengthRef.current = 0;
    shouldAutoScrollRef.current = true;
    const id = setTimeout(() => setMessages([]), 0);
    return () => clearTimeout(id);
  }, [brokerId, config.topics]);

  const { subscribe } = useWebSocket({
    onMessage: (data) => {
      if (pausedRef.current) return;
      try {
        const msg = JSON.parse(data) as {
          topic: string;
          payload: string;
          timestamp?: string;
          qos?: number;
          retained?: boolean;
        };
        const entry: LogMessage = {
          receivedAt: normalizeTimestamp(msg.timestamp),
          topic: msg.topic,
          payload: msg.payload,
          qos: msg.qos,
          retained: msg.retained,
        };
        setMessages((prev) => {
          // Overlapping subscription filters (e.g. "foo/bar" and "foo/#") can
          // deliver the same physical message twice. Drop a live message when an
          // identical topic+payload arrived within a short window. Each backend
          // delivery is timestamped separately, so compare by window, not equality.
          const DEDUPE_WINDOW_MS = 75;
          const entryTime = new Date(entry.receivedAt).getTime();
          const isDuplicate = prev
            .slice(-10)
            .some(
              (m) =>
                !m.historical &&
                m.topic === entry.topic &&
                m.payload === entry.payload &&
                Math.abs(new Date(m.receivedAt).getTime() - entryTime) <=
                  DEDUPE_WINDOW_MS,
            );
          if (isDuplicate) return prev;
          const next = [...prev, entry];
          return next.length > maxMessages
            ? next.slice(next.length - maxMessages)
            : next;
        });
      } catch (error) {
        void error;
      }
    },
  });

  useEffect(() => {
    if (!brokerId || !config.topics) return;
    const topics = config.topics
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (topics.length === 0) return;

    let cancelled = false;
    Promise.all(
      topics.map((topic) =>
        api.getExplorerHistory(brokerId, topic).catch((error) => {
          void error;
          return [];
        }),
      ),
    ).then((results) => {
      if (cancelled) return;
      const hist: LogMessage[] = results
        .flat()
        .sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        )
        .map((r) => ({
          receivedAt: normalizeTimestamp(r.timestamp),
          topic: r.topic,
          payload: r.payload,
          qos: r.qos,
          retained: r.retained,
          historical: true,
        }));
      // Merge history with already-received live messages to prevent flicker.
      setMessages((prev) => {
        const live = prev.filter((m) => !m.historical);
        const next = [...hist, ...live];
        return next.length > maxMessages
          ? next.slice(next.length - maxMessages)
          : next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [brokerId, config.topics, maxMessages]);

  useEffect(() => {
    if (!config.topics) return;
    const topicList = config.topics
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    subscribe({ panel_id: panelId, broker_id: brokerId, topics: topicList });
  }, [panelId, brokerId, config.topics, subscribe]);

  useEffect(() => {
    const el = logContainerRef.current;
    if (!el) return;

    const wasAppended = messages.length > prevLengthRef.current;
    prevLengthRef.current = messages.length;

    if (!wasAppended || paused || !shouldAutoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, paused]);

  const handleLogScroll = () => {
    const el = logContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceToBottom <= 24;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 px-1 pb-1">
        <button className="btn btn-xs" onClick={() => setMessages([])}>
          Clear
        </button>
        <button
          className={`btn btn-xs ${paused ? "btn-warning" : ""}`}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <span className="text-xs text-base-content/50 ml-auto self-center">
          {messages.length} msgs
        </span>
      </div>
      <div
        ref={logContainerRef}
        onScroll={handleLogScroll}
        className="flex-1 overflow-y-auto bg-neutral text-neutral-content rounded font-mono text-xs p-2 space-y-0.5"
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={`leading-tight ${m.historical ? "opacity-50" : ""}`}
          >
            <span className="text-neutral-content/70">
              [{formatTimestamp(new Date(m.receivedAt), dateFormat)}]
            </span>{" "}
            <span className="text-accent">{m.topic}</span>
            {showQos && m.qos !== undefined && (
              <span className="badge badge-xs badge-ghost ml-1">Q{m.qos}</span>
            )}
            {showRetained && m.retained && (
              <span className="badge badge-xs badge-warning ml-1">R</span>
            )}{" "}
            <span>{m.payload}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
