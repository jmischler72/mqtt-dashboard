import { useState, useEffect, useRef } from "react";
import { useWebSocket } from "../../hooks/useWebSocket";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";

interface LogMessage {
  timestamp: string;
  topic: string;
  payload: string;
  historical?: boolean;
}

interface LogConfig {
  topics?: string;
  maxMessages?: number;
  dateFormat?: "time" | "full";
}

interface ModalProps {
  config: LogConfig;
  brokerId: string;
  brokerStatuses: BrokerStatus[];
  onSave: (cfg: LogConfig, brokerId: string) => void;
  onClose: () => void;
}

export function LogConfigModal({
  config,
  brokerId,
  brokerStatuses,
  onSave,
  onClose,
}: ModalProps) {
  const defaultBrokerId =
    brokerStatuses.find((b) => b.is_enabled)?.id ?? brokerStatuses[0]?.id ?? "";
  const [topics, setTopics] = useState(config.topics ?? "");
  const [maxMessages, setMaxMessages] = useState(config.maxMessages ?? 200);
  const [dateFormat, setDateFormat] = useState<"time" | "full">(
    config.dateFormat ?? "time",
  );
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    brokerId || defaultBrokerId,
  );

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-h-[85vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-4">Log Configuration</h3>
        <div className="flex flex-col gap-3">
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Broker</legend>
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
        </div>
        <div className="modal-action">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() =>
              onSave(
                { topics, maxMessages, dateFormat },
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
  if (format === "full") {
    return date.toLocaleString(undefined, {
      dateStyle: "full",
      timeStyle: "medium",
    });
  }
  return date.toLocaleTimeString();
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
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const { subscribe } = useWebSocket({
    onMessage: (data) => {
      if (pausedRef.current) return;
      try {
        const msg = JSON.parse(data) as { topic: string; payload: string };
        const entry: LogMessage = {
          timestamp: formatTimestamp(new Date(), dateFormat),
          topic: msg.topic,
          payload: msg.payload,
        };
        setMessages((prev) => {
          const next = [...prev, entry];
          return next.length > maxMessages
            ? next.slice(next.length - maxMessages)
            : next;
        });
      } catch {}
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
        api.getExplorerHistory(brokerId, topic).catch(() => []),
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
          timestamp: formatTimestamp(new Date(r.timestamp), dateFormat),
          topic: r.topic,
          payload: r.payload,
          historical: true,
        }));
      setMessages(hist);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokerId, config.topics]);

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
            className={`leading-tight ${m.historical ? "opacity-40" : ""}`}
          >
            <span className="text-base-content/40">[{m.timestamp}]</span>{" "}
            <span className="text-accent">{m.topic}</span>{" "}
            <span>{m.payload}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
