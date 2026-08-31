import { useState, useEffect, useRef } from "react";
import { MdListAlt } from "react-icons/md";
import { useWebSocket } from "../../hooks/useWebSocket";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import {
  BrokerTopicCard,
  ChoiceCards,
  ConfigCard,
  ConfigGroup,
  FieldRow,
  PanelConfigModal,
  SwitchRow,
  brokerPresence,
  brokerRules,
  defaultBrokerId,
  topicRules,
  useConfigValidation,
} from "./config";

interface LogMessage {
  receivedAt: string;
  topic: string;
  payload: string;
  qos?: number;
  retained?: boolean;
  historical?: boolean;
}

export type LogDateFormat = "time" | "full";

export interface LogConfig {
  topics?: string;
  maxMessages?: number;
  dateFormat?: LogDateFormat;
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
  const fallbackBroker = defaultBrokerId(brokerStatuses);
  const [topics, setTopics] = useState(initialTopic ?? config.topics ?? "");
  const [maxMessages, setMaxMessages] = useState(
    String(config.maxMessages ?? 200),
  );
  const [dateFormat, setDateFormat] = useState<LogDateFormat>(
    config.dateFormat ?? "full",
  );
  const [showQos, setShowQos] = useState(config.showQos ?? true);
  const [showRetained, setShowRetained] = useState(config.showRetained ?? true);
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || fallbackBroker,
  );

  const rowsNum = Number(maxMessages);

  const { fieldErrors, blockerReason } = useConfigValidation([
    ...brokerRules(brokerStatuses.length),
    ...topicRules({ field: "topic", topic: topics, allowWildcards: true }),
    {
      field: "rows",
      when: !Number.isFinite(rowsNum) || rowsNum < 1 || rowsNum > 1000,
      message: "Rows must be a number between 1 and 1000.",
    },
  ]);

  const draft = (): LogConfig => ({
    topics,
    maxMessages: rowsNum,
    dateFormat,
    showQos,
    showRetained,
  });

  return (
    <PanelConfigModal
      icon={MdListAlt}
      title="Log Configuration"
      brokerStatus={brokerPresence(brokerStatuses, selectedBrokerId)}
      blockerReason={blockerReason}
      onCancel={onClose}
      onSave={() => onSave(draft(), selectedBrokerId || fallbackBroker)}
    >
      <ConfigGroup heading="Read">
        <BrokerTopicCard
          title="Reads from"
          brokers={brokerStatuses}
          brokerId={selectedBrokerId}
          onBrokerChange={setSelectedBrokerId}
          topic={topics}
          onTopicChange={(next) => {
            setTopics(next);
          }}
          topicPlaceholder="sensors/#, home/+/status"
          topicError={fieldErrors.topic}
          help="Comma-separate several topics. Read-only, so wildcards (+ and #) are fine."
          onExplore={
            onPickTopic
              ? () =>
                  onPickTopic({
                    currentTopic: "",
                    selectedBrokerId,
                    draftConfig: draft(),
                  })
              : undefined
          }
        />
      </ConfigGroup>

      <ConfigGroup heading="Appearance">
        <ConfigCard title="Line style" summary="Drawn with your settings">
          <ChoiceCards<LogDateFormat>
            value={dateFormat}
            onChange={setDateFormat}
            options={[
              {
                id: "time",
                label: "Time only",
                preview: (
                  <LinePreview
                    stamp="14:32:07"
                    showQos={showQos}
                    showRetained={showRetained}
                  />
                ),
              },
              {
                id: "full",
                label: "Full date",
                preview: (
                  <LinePreview
                    stamp="2026-08-31 14:32:07"
                    showQos={showQos}
                    showRetained={showRetained}
                  />
                ),
              },
            ]}
          />
          <SwitchRow
            name="QoS badge"
            note="Prints the delivery level on each line"
            on={showQos}
            onToggle={setShowQos}
          />
          <SwitchRow
            name="Retain badge"
            note="Marks messages the broker had kept"
            on={showRetained}
            onToggle={setShowRetained}
          />
        </ConfigCard>

        <ConfigCard>
          <FieldRow
            label="Rows"
            invalid={Boolean(fieldErrors.rows)}
            help={
              fieldErrors.rows ??
              "How many lines the panel keeps before dropping the oldest."
            }
          >
            <input
              className={`input input-bordered w-full min-w-0 h-8 min-h-8 font-mono text-xs ${
                fieldErrors.rows ? "input-warning" : ""
              }`}
              inputMode="numeric"
              value={maxMessages}
              onChange={(e) => {
                setMaxMessages(e.target.value);
              }}
            />
          </FieldRow>
        </ConfigCard>
      </ConfigGroup>
    </PanelConfigModal>
  );
}

/** A log line drawn with the badges and stamp the user has actually picked. */
function LinePreview({
  stamp,
  showQos,
  showRetained,
}: {
  stamp: string;
  showQos: boolean;
  showRetained: boolean;
}) {
  return (
    <div className="w-full px-1 font-mono text-[9px] leading-relaxed text-left truncate">
      <span className="opacity-60">[{stamp}]</span>{" "}
      <span className="text-accent">attic/temp</span>
      {showQos && <span className="opacity-60"> Q0</span>}
      {showRetained && <span className="text-warning"> R</span>} 21.4
    </div>
  );
}

/**
 * What the panel prints for a message: the marked part of the payload, or the
 * whole payload when nothing is marked.
 */
function formatTimestamp(date: Date, format: LogDateFormat) {
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

  if (!config.topics?.trim()) {
    return (
      <div className="flex items-center justify-center h-full text-base-content/40 text-xs">
        No topic configured — open settings to add topic
      </div>
    );
  }

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
