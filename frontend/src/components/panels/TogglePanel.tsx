import { useState, useEffect, useRef } from "react";
import { MdToggleOn } from "react-icons/md";
import { RiErrorWarningLine, RiLoader4Line, RiTimeLine } from "react-icons/ri";
import { useWebSocket } from "../../hooks/useWebSocket";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import BrokerTopicSection from "./BrokerTopicSection";
import MqttOptionsSection from "./MqttOptionsSection";
import PanelModalFrame from "./PanelModalFrame";
import {
  parseToggleState,
  DEFAULT_ON_PAYLOAD,
  DEFAULT_OFF_PAYLOAD,
} from "./toggleUtils";

/** How long to wait for the state topic to confirm a flip before giving up. */
const CONFIRM_TIMEOUT_MS = 5000;

export interface ToggleConfig {
  /** Command topic — the toggle publishes here. */
  topic?: string;
  /** Optional state/telemetry topic. When empty, the command topic is used. */
  stateTopic?: string;
  onPayload?: string;
  offPayload?: string;
  /** Optional JSON key to read the state from. */
  valueKey?: string;
  qos?: number;
  retain?: boolean;
}

interface ModalProps {
  config: ToggleConfig;
  brokerId: string;
  brokerStatuses: BrokerStatus[];
  onSave: (cfg: ToggleConfig, brokerId: string) => void;
  onClose: () => void;
  onPickTopic?: (data: {
    currentTopic: string;
    selectedBrokerId: string;
    draftConfig?: ToggleConfig;
  }) => void;
  initialTopic?: string;
  initialBrokerId?: string;
}

export function ToggleConfigModal({
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
  const [separateStateTopic, setSeparateStateTopic] = useState(
    Boolean(config.stateTopic?.trim()),
  );
  const [stateTopic, setStateTopic] = useState(config.stateTopic ?? "");
  const [onPayload, setOnPayload] = useState(
    config.onPayload ?? DEFAULT_ON_PAYLOAD,
  );
  const [offPayload, setOffPayload] = useState(
    config.offPayload ?? DEFAULT_OFF_PAYLOAD,
  );
  const [valueKey, setValueKey] = useState(config.valueKey ?? "");
  const [qos, setQos] = useState(config.qos ?? 0);
  const [retain, setRetain] = useState(config.retain ?? false);
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || defaultBrokerId,
  );

  const hasWildcardWarning = topic.includes("+") || topic.includes("#");
  const effectiveStateTopic = separateStateTopic ? stateTopic.trim() : "";

  return (
    <PanelModalFrame
      title="Toggle Configuration"
      icon={MdToggleOn}
      onClose={onClose}
      onSave={() =>
        onSave(
          {
            topic,
            stateTopic: effectiveStateTopic,
            onPayload,
            offPayload,
            valueKey: valueKey.trim(),
            qos,
            retain,
          },
          selectedBrokerId,
        )
      }
      saveDisabled={
        brokerStatuses.length === 0 ||
        !topic.trim() ||
        hasWildcardWarning ||
        !onPayload.trim() ||
        !offPayload.trim()
      }
      maxWidthClass="max-w-lg"
    >
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
        topicLabel="Command topic"
        allowWildcards={false}
        allowMultiple={false}
        helpText="The topic the toggle publishes to. Also used to read the state unless a separate state topic is set below."
      />

      <fieldset className="fieldset p-0 border-0">
        <label className="flex items-center justify-between cursor-pointer p-2 rounded-lg border border-base-300 bg-base-200/40">
          <span className="text-xs font-medium text-base-content/80">
            State topic is different
          </span>
          <input
            type="checkbox"
            className="toggle toggle-xs toggle-primary"
            checked={separateStateTopic}
            onChange={(e) => setSeparateStateTopic(e.target.checked)}
          />
        </label>

        {separateStateTopic && (
          <div className="mt-2">
            <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
              State topic
            </legend>
            <input
              className={`input input-bordered input-sm w-full font-mono text-xs ${
                !stateTopic.trim() ? "input-warning" : ""
              }`}
              value={stateTopic}
              onChange={(e) => setStateTopic(e.target.value)}
              placeholder="e.g. home/lamp/state"
            />
            <p className="text-[11px] text-base-content/60 mt-1.5 leading-normal">
              The topic the device reports its actual state on. Read-only, so
              wildcards are allowed here.
            </p>
          </div>
        )}
      </fieldset>

      <fieldset className="fieldset p-0 border-0">
        <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
          Payloads
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-base-content/60">On</span>
            <input
              className={`input input-bordered input-sm w-full font-mono text-xs ${
                !onPayload.trim() ? "input-warning" : ""
              }`}
              value={onPayload}
              onChange={(e) => setOnPayload(e.target.value)}
              placeholder={DEFAULT_ON_PAYLOAD}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-base-content/60">Off</span>
            <input
              className={`input input-bordered input-sm w-full font-mono text-xs ${
                !offPayload.trim() ? "input-warning" : ""
              }`}
              value={offPayload}
              onChange={(e) => setOffPayload(e.target.value)}
              placeholder={DEFAULT_OFF_PAYLOAD}
            />
          </label>
        </div>
        <p className="text-[11px] text-base-content/60 mt-1.5 leading-normal">
          Sent when the toggle is flipped, and matched against incoming messages
          to read the state back.
        </p>
      </fieldset>

      <fieldset className="fieldset p-0 border-0">
        <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
          JSON key <span className="opacity-60 font-normal">(optional)</span>
        </legend>
        <input
          className="input input-bordered input-sm w-full font-mono text-xs"
          value={valueKey}
          onChange={(e) => setValueKey(e.target.value)}
          placeholder="e.g. state"
        />
        <p className="text-[11px] text-base-content/60 mt-1.5 leading-normal">
          Read the state from this key when the device publishes JSON, e.g.{" "}
          <code className="font-mono">{`{"state":"ON"}`}</code>.
        </p>
      </fieldset>

      <MqttOptionsSection
        qos={qos}
        retain={retain}
        onQosChange={setQos}
        onRetainChange={setRetain}
      />
    </PanelModalFrame>
  );
}

interface TogglePanelProps {
  panelId: string;
  brokerId: string;
  config: ToggleConfig;
}

interface PendingFlip {
  desired: boolean;
}

/** Same HH:MM:SS footer format the gauge panel uses. */
function formatTime(ms: number): string {
  try {
    const d = new Date(ms);
    const pad2 = (n: number) => String(n).padStart(2, "0");
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  } catch {
    return "";
  }
}

/**
 * Remounts the runtime whenever the panel is pointed at a different broker,
 * topic or payload mapping, so stale state is dropped without a reset effect.
 */
export default function TogglePanel(props: TogglePanelProps) {
  const { brokerId, config } = props;
  const identity = [
    brokerId,
    config.topic ?? "",
    config.stateTopic ?? "",
    config.onPayload ?? DEFAULT_ON_PAYLOAD,
    config.offPayload ?? DEFAULT_OFF_PAYLOAD,
    config.valueKey ?? "",
  ].join("\u0000");

  return <ToggleRuntime key={identity} {...props} />;
}

function ToggleRuntime({ panelId, brokerId, config }: TogglePanelProps) {
  const [state, setState] = useState<boolean | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingFlip | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [error, setError] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [resizing, setResizing] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<PendingFlip | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commandTopic = (config.topic ?? "").split(",")[0]?.trim() ?? "";
  const stateTopic = config.stateTopic?.trim() || commandTopic;
  const onPayload = config.onPayload ?? DEFAULT_ON_PAYLOAD;
  const offPayload = config.offPayload ?? DEFAULT_OFF_PAYLOAD;
  const valueKey = config.valueKey;
  const qos = config.qos ?? 0;
  const retain = config.retain ?? false;
  const hasWildcard = commandTopic.includes("+") || commandTopic.includes("#");

  const clearPendingTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // A message from the state topic is the source of truth: it resolves any
  // pending flip and replaces the optimistic position.
  const applyIncomingState = (payload: string, receivedAt: number) => {
    const next = parseToggleState(payload, { onPayload, offPayload, valueKey });
    setState(next);
    setUpdatedAt(receivedAt);

    const inFlight = pendingRef.current;
    if (inFlight) {
      clearPendingTimer();
      pendingRef.current = null;
      setPending(null);
      setUnconfirmed(next !== inFlight.desired);
    }
  };

  useEffect(() => clearPendingTimer, []);

  // Seed the last known state from history so a reload isn't blank
  useEffect(() => {
    if (!brokerId || !stateTopic) return;

    let cancelled = false;
    api
      .getExplorerHistory(brokerId, stateTopic)
      .then((records) => {
        if (cancelled || !records || records.length === 0) return;
        const sorted = [...records].sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
        const last = sorted[0];
        const parsed = new Date(last.timestamp).getTime();
        applyIncomingState(
          last.payload,
          Number.isNaN(parsed) ? Date.now() : parsed,
        );
      })
      .catch(() => { });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokerId, stateTopic, onPayload, offPayload, valueKey]);

  // Live updates
  const { subscribe } = useWebSocket({
    onMessage: (msgStr) => {
      try {
        const msg = JSON.parse(msgStr) as {
          topic: string;
          payload: string;
          timestamp?: string;
        };
        const parsed = msg.timestamp
          ? new Date(msg.timestamp).getTime()
          : Date.now();
        applyIncomingState(
          msg.payload,
          Number.isNaN(parsed) ? Date.now() : parsed,
        );
      } catch {
        // Ignore invalid message JSON frame
      }
    },
  });

  useEffect(() => {
    if (!stateTopic) return;
    subscribe({ panel_id: panelId, broker_id: brokerId, topics: [stateTopic] });
  }, [panelId, brokerId, stateTopic, subscribe]);

  // Scale the switch with the panel. Every animated property is derived from
  // these dimensions, so transitions are suppressed until resizing settles —
  // otherwise the knob chases each intermediate size and visibly jitters.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const apply = (w: number, h: number) => {
      setDimensions({ width: w, height: h });
      setResizing(true);
      if (resizeIdleRef.current) clearTimeout(resizeIdleRef.current);
      resizeIdleRef.current = setTimeout(() => setResizing(false), 150);
    };

    const measure = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0 && h > 0) apply(w, h);
    };

    measure();
    const timer = setTimeout(measure, 100);

    const cleanupTimers = () => {
      clearTimeout(timer);
      if (resizeIdleRef.current) clearTimeout(resizeIdleRef.current);
    };

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        cleanupTimers();
        window.removeEventListener("resize", measure);
      };
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const w = entry.contentRect.width || el.offsetWidth;
        const h = entry.contentRect.height || el.offsetHeight;
        if (w > 0 && h > 0) apply(w, h);
      }
    });

    observer.observe(el);
    window.addEventListener("resize", measure);

    return () => {
      cleanupTimers();
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const handleFlip = async (desired: boolean) => {
    if (!commandTopic || hasWildcard || pendingRef.current) return;

    setUnconfirmed(false);
    setError(false);
    const flip: PendingFlip = { desired };
    pendingRef.current = flip;
    setPending(flip);

    clearPendingTimer();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      pendingRef.current = null;
      setPending(null);
      setUnconfirmed(true);
    }, CONFIRM_TIMEOUT_MS);

    try {
      await api.post("/api/publish", {
        broker_id: brokerId,
        topic: commandTopic,
        payload: desired ? onPayload : offPayload,
        qos,
        retain,
      });
    } catch {
      clearPendingTimer();
      pendingRef.current = null;
      setPending(null);
      setError(true);
    }
  };

  // Optimistic position while a flip is in flight, real state otherwise
  const displayed = pending?.desired ?? state;
  const isOn = displayed === true;
  const disabled = !commandTopic || hasWildcard || pending !== null;

  // Dynamic sizing derived from container dimensions, like GaugePanel.
  // Height drives the switch so it never outgrows a short panel; width only
  // caps it further on narrow ones.
  const availW = Math.max(40, (dimensions.width || 240) - 16);
  const availH = Math.max(40, (dimensions.height || 200) - 34);
  const trackH = Math.round(
    Math.max(18, Math.min(availH * 0.72, availW * 0.3, 150)),
  );
  const trackW = Math.round(trackH / 0.46);
  const knobPad = Math.max(2, Math.round(trackH * 0.09));
  const knobSize = trackH - knobPad * 2;
  const stateFontSize = Math.max(9, Math.round(trackH * 0.32));
  // Width of the half of the track the knob is not covering
  const freeW = trackW - knobSize - knobPad * 2;

  // Only transform/color animate, and neither during a resize
  const motion = resizing
    ? "none"
    : "transform 200ms ease, background-color 200ms ease";

  const trackClass =
    displayed === null
      ? "bg-base-300"
      : displayed
        ? "bg-success"
        : "bg-error";
  const stateTextClass =
    displayed === null
      ? "text-base-content/50"
      : displayed
        ? "text-success-content"
        : "text-error-content";

  let status: React.ReactNode = null;
  if (!commandTopic) {
    status = <span className="text-base-content/50">No topic configured</span>;
  } else if (hasWildcard) {
    status = (
      <span className="text-warning inline-flex items-center gap-1">
        <RiErrorWarningLine className="shrink-0" />
        Wildcard topic
      </span>
    );
  } else if (pending) {
    status = (
      <span className="text-base-content/60 inline-flex items-center gap-1">
        <RiLoader4Line className="animate-spin shrink-0" />
        confirming…
      </span>
    );
  } else if (error) {
    status = (
      <span className="text-error inline-flex items-center gap-1">
        <RiErrorWarningLine className="shrink-0" />
        publish failed
      </span>
    );
  } else if (unconfirmed) {
    status = (
      <span className="text-warning inline-flex items-center gap-1">
        <RiErrorWarningLine className="shrink-0" />
        not confirmed
      </span>
    );
  } else if (updatedAt === null) {
    status = <span className="text-base-content/50">waiting for state…</span>;
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full justify-between p-2 overflow-hidden"
    >
      <div className="flex flex-1 items-center justify-center min-h-0">
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          aria-label={commandTopic || "Toggle"}
          disabled={disabled}
          onClick={() => handleFlip(!isOn)}
          title={
            hasWildcard
              ? "Cannot publish to wildcard topics (+ or #)"
              : !commandTopic
                ? "No topic configured"
                : undefined
          }
          className={`relative rounded-full shrink-0 ${trackClass} ${
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
          } ${pending ? "animate-pulse" : ""}`}
          style={{ width: trackW, height: trackH, transition: motion }}
        >
          {/* Sits in the half the knob is not covering; slides with it */}
          <span
            className={`absolute flex items-center justify-center font-bold tracking-wide select-none ${stateTextClass}`}
            style={{
              top: knobPad,
              height: knobSize,
              left: knobPad + knobSize,
              width: freeW,
              transform: `translateX(${isOn ? -knobSize : 0}px)`,
              transition: motion,
              fontSize: stateFontSize,
              lineHeight: 1,
            }}
          >
            {displayed === null ? "—" : displayed ? "ON" : "OFF"}
          </span>

          <span
            className="absolute rounded-full bg-base-100 shadow-md"
            style={{
              width: knobSize,
              height: knobSize,
              top: knobPad,
              left: knobPad,
              transform: `translateX(${isOn ? freeW : 0}px)`,
              transition: motion,
            }}
          />
        </button>
      </div>

      {/* Footer Meta */}
      <div className="flex items-center justify-between gap-2 text-[10px] text-base-content/50 pt-1.5 border-t border-base-200 shrink-0">
        <div className="flex items-center gap-1 min-w-0">
          {updatedAt !== null && (
            <>
              <RiTimeLine className="text-xs shrink-0" />
              <span className="truncate">{formatTime(updatedAt)}</span>
            </>
          )}
        </div>
        {status && <div className="truncate">{status}</div>}
      </div>
    </div>
  );
}
