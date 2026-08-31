import { useState, useEffect, useRef } from "react";
import { MdToggleOn } from "react-icons/md";
import { RiErrorWarningLine, RiLoader4Line, RiTimeLine } from "react-icons/ri";
import { useWebSocket } from "../../hooks/useWebSocket";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import { usePayloadSample } from "../../hooks/usePayloadSample";
import {
  BrokerTopicCard,
  ConfigCard,
  ConfigGroup,
  FieldRow,
  MessageHistory,
  PanelConfigModal,
  PayloadBuilder,
  PublishOptionsCard,
  ReadBackSwitch,
  brokerPresence,
  brokerRules,
  defaultBrokerId,
  payloadRules,
  topicRules,
  useConfigValidation,
} from "./config";
import { migrateTemplate } from "./payloadShape";
import {
  parseToggleState,
  toggleWritePayloads,
  DEFAULT_ON_PAYLOAD,
  DEFAULT_OFF_PAYLOAD,
} from "./toggleUtils";

/** How long to wait for the state topic to confirm a flip before giving up. */
const CONFIRM_TIMEOUT_MS = 5000;

export interface ToggleConfig {
  /** Command topic — the toggle publishes here. */
  topic?: string;
  /** Reads back from its own broker/topic/shape rather than the command one. */
  separateRead?: boolean;
  /** State/telemetry topic, used when separateRead is set. */
  stateTopic?: string;
  /** Broker the state topic lives on; defaults to the command broker. */
  stateBrokerId?: string;
  /** Shape of incoming messages, with `{value}` marking the value to compare. */
  readTemplate?: string;
  /** The exact bytes published to turn the device on. */
  onPayload?: string;
  /** The exact bytes published to turn it off. */
  offPayload?: string;
  /**
   * Legacy shape: the value used to sit inside a template. Folded into the two
   * payloads above on load; see `toggleWritePayloads`.
   */
  payloadTemplate?: string;
  /** Legacy read path, still honoured when no shape marks the value. */
  valueKey?: string;
  /** Caption drawn above the switch. Display only. */
  label?: string;
  /**
   * Which field sent the user to the topic picker. The picker round-trips the
   * draft config and hands the chosen topic back as `initialTopic`, which would
   * otherwise always land in the command topic — this says where it belongs.
   */
  pickTarget?: "topic" | "stateTopic";
  /** Command broker carried across the picker round-trip. */
  commandBrokerId?: string;
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
  const fallbackBroker = defaultBrokerId(brokerStatuses);
  // A topic picked for the state field must not overwrite the command topic
  const pickedForState = config.pickTarget === "stateTopic";
  const stored = toggleWritePayloads(config);

  const [topic, setTopic] = useState(
    (pickedForState ? config.topic : initialTopic) ?? config.topic ?? "",
  );
  const [onPayload, setOnPayload] = useState(stored.on);
  const [offPayload, setOffPayload] = useState(stored.off);
  const [separateRead, setSeparateRead] = useState(
    config.separateRead ?? Boolean(config.stateTopic?.trim()),
  );
  const [stateTopic, setStateTopic] = useState(
    (pickedForState ? initialTopic : config.stateTopic) ??
      config.stateTopic ??
      "",
  );
  const [stateBrokerId, setStateBrokerId] = useState(
    (pickedForState ? initialBrokerId : config.stateBrokerId) ??
      config.stateBrokerId ??
      "",
  );
  const [readTemplate, setReadTemplate] = useState(
    migrateTemplate(config.readTemplate ?? ""),
  );
  const [label, setLabel] = useState(config.label ?? "");
  const [qos, setQos] = useState(config.qos ?? 0);
  const [retain, setRetain] = useState(config.retain ?? false);
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    (pickedForState ? config.commandBrokerId : initialBrokerId) ||
      brokerId ||
      fallbackBroker,
  );
  const [touched, setTouched] = useState(Boolean(config.topic));
  const [usedKey, setUsedKey] = useState<string | null>(null);

  const effectiveStateBroker =
    (separateRead && stateBrokerId) || selectedBrokerId;

  // One fetch, one list: both payload boxes are filled from the same messages,
  // so the disclosure above them is shared rather than drawn twice.
  const commandHistory = usePayloadSample(selectedBrokerId, topic);

  const draft = (pickTarget: "topic" | "stateTopic"): ToggleConfig => ({
    topic,
    separateRead,
    stateTopic,
    stateBrokerId,
    readTemplate,
    onPayload,
    offPayload,
    label,
    valueKey: config.valueKey,
    qos,
    retain,
    pickTarget,
    commandBrokerId: selectedBrokerId,
  });

  const { fieldErrors, blockerReason } = useConfigValidation(
    [
      ...brokerRules(brokerStatuses.length),
      ...topicRules({ topic, subject: "A command topic" }),
      {
        field: "onPayload",
        when: onPayload.trim() === "",
        message: "The On message is empty — there would be nothing to publish.",
      },
      {
        field: "offPayload",
        when: offPayload.trim() === "",
        message:
          "The Off message is empty — there would be nothing to publish.",
      },
      {
        field: "onPayload",
        when: onPayload.trim() !== "" && onPayload.trim() === offPayload.trim(),
        message: "On and Off publish the same bytes, so the toggle can't flip.",
      },
      ...(separateRead
        ? [
            ...topicRules({
              field: "stateTopic",
              topic: stateTopic,
              allowWildcards: true,
              subject: "A state topic",
            }),
            ...payloadRules({
              field: "readShape",
              value: readTemplate,
              mode: "read",
            }),
          ]
        : []),
    ],
    { touched },
  );

  return (
    <PanelConfigModal
      icon={MdToggleOn}
      title="Toggle Configuration"
      brokerStatus={brokerPresence(brokerStatuses, selectedBrokerId)}
      blockerReason={blockerReason}
      onCancel={onClose}
      onSave={() =>
        onSave(
          {
            topic,
            separateRead,
            stateTopic: separateRead ? stateTopic.trim() : "",
            stateBrokerId: separateRead ? effectiveStateBroker : undefined,
            readTemplate: separateRead ? readTemplate : undefined,
            onPayload,
            offPayload,
            // Folded into the two payloads above; never written again.
            payloadTemplate: undefined,
            valueKey: config.valueKey,
            label,
            qos,
            retain,
          },
          selectedBrokerId || fallbackBroker,
        )
      }
    >
      <ConfigGroup heading="Publish">
        <BrokerTopicCard
          title="Publishes to"
          brokers={brokerStatuses}
          brokerId={selectedBrokerId}
          onBrokerChange={setSelectedBrokerId}
          topic={topic}
          onTopicChange={(next) => {
            setTopic(next);
            setTouched(true);
          }}
          topicPlaceholder="home/light/set"
          topicError={fieldErrors.topic}
          help="Publishes here, and reads the state back from here unless you turn on Read below."
          onExplore={
            onPickTopic
              ? () =>
                  onPickTopic({
                    currentTopic: topic,
                    selectedBrokerId,
                    draftConfig: draft("topic"),
                  })
              : undefined
          }
        />

        <ConfigCard
          title="Message"
          summary="two states, two sets of bytes"
          invalid={Boolean(fieldErrors.onPayload || fieldErrors.offPayload)}
        >
          <MessageHistory
            topic={topic}
            messages={commandHistory.recent}
            loading={commandHistory.loading}
            usedKey={usedKey}
            footnote="Fills the box you pick. You can edit it afterwards."
            actions={[
              {
                key: "on",
                label: "use as On",
                onUse: (payload, index) => {
                  setOnPayload(payload);
                  setUsedKey(`${index}:on`);
                  setTouched(true);
                },
              },
              {
                key: "off",
                label: "use as Off",
                onUse: (payload, index) => {
                  setOffPayload(payload);
                  setUsedKey(`${index}:off`);
                  setTouched(true);
                },
              },
            ]}
          />

          <StateBox
            caption="On sends"
            error={fieldErrors.onPayload}
            value={onPayload}
            onChange={(next) => {
              setOnPayload(next);
              setTouched(true);
            }}
            placeholder={DEFAULT_ON_PAYLOAD}
            brokerId={selectedBrokerId}
            topic={topic}
          />

          <StateBox
            caption="Off sends"
            error={fieldErrors.offPayload}
            value={offPayload}
            onChange={(next) => {
              setOffPayload(next);
              setTouched(true);
            }}
            placeholder={DEFAULT_OFF_PAYLOAD}
            brokerId={selectedBrokerId}
            topic={topic}
          />

          <span className="text-[11px] text-base-content/50">
            Both are sent verbatim, exactly these bytes.
          </span>
        </ConfigCard>

        <PublishOptionsCard
          qos={qos}
          onQosChange={setQos}
          retain={retain}
          onRetainChange={setRetain}
          retainNote="Last state kept for new subscribers"
        />
      </ConfigGroup>

      <ConfigGroup heading="Read">
        <ReadBackSwitch
          on={separateRead}
          onToggle={(next) => {
            setSeparateRead(next);
            setTouched(true);
          }}
          title="A different topic reports the state"
          offExplanation="Off: the device reports on the command topic, in the same shape the panel publishes."
          onExplanation="The panel listens here instead of on the command topic."
          invalid={Boolean(fieldErrors.stateTopic || fieldErrors.readShape)}
        >
          <BrokerTopicCard
            bare
            brokers={brokerStatuses}
            brokerId={effectiveStateBroker}
            onBrokerChange={setStateBrokerId}
            topic={stateTopic}
            onTopicChange={(next) => {
              setStateTopic(next);
              setTouched(true);
            }}
            topicPlaceholder="home/light/state"
            topicError={fieldErrors.stateTopic}
            help="Read-only, so wildcards (+ and #) are fine here."
            onExplore={
              onPickTopic
                ? () =>
                    onPickTopic({
                      currentTopic: stateTopic,
                      selectedBrokerId: effectiveStateBroker,
                      draftConfig: draft("stateTopic"),
                    })
                : undefined
            }
          />

          <div className="flex flex-col gap-2.5 pt-2.5 border-t border-base-300 dark:border-base-100 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold">
                Shape it arrives in
              </span>
              <span className="ml-auto text-[10.5px] text-base-content/50 truncate">
                the chip marks the value compared against On
              </span>
            </div>
            <PayloadBuilder
              mode="read"
              value={readTemplate}
              onChange={(next) => {
                setReadTemplate(next);
                setTouched(true);
              }}
              brokerId={effectiveStateBroker}
              topic={stateTopic}
              placeholder={`{"state":${DEFAULT_ON_PAYLOAD}}`}
            />
            {fieldErrors.readShape && (
              <span className="text-[11px] text-warning">
                {fieldErrors.readShape}
              </span>
            )}
          </div>
        </ReadBackSwitch>
      </ConfigGroup>

      <ConfigGroup heading="Appearance">
        <ConfigCard>
          <FieldRow
            label="Label"
            help="Caption above the switch. Leave blank for none."
          >
            <input
              className="input input-bordered w-full min-w-0 h-8 min-h-8 text-xs"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Porch light"
            />
          </FieldRow>
        </ConfigCard>
      </ConfigGroup>
    </PanelConfigModal>
  );
}

/** One of the toggle's two verbatim payloads, under its own caption. */
function StateBox({
  caption,
  error,
  value,
  onChange,
  placeholder,
  brokerId,
  topic,
}: {
  caption: string;
  error?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  brokerId: string;
  topic: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[10.5px] text-base-content/70">{caption}</span>
      <PayloadBuilder
        mode="write"
        value={value}
        onChange={onChange}
        acceptsChip={false}
        showHistory={false}
        note={null}
        brokerId={brokerId}
        topic={topic}
        placeholder={placeholder}
      />
      {error && <span className="text-[11px] text-warning">{error}</span>}
    </div>
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
    config.stateBrokerId ?? "",
    config.readTemplate ?? "",
    config.onPayload ?? DEFAULT_ON_PAYLOAD,
    config.offPayload ?? DEFAULT_OFF_PAYLOAD,
    config.valueKey ?? "",
    config.payloadTemplate ?? "",
    config.label ?? "",
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
  const separateRead =
    config.separateRead ?? Boolean(config.stateTopic?.trim());
  const stateTopic =
    (separateRead && config.stateTopic?.trim()) || commandTopic;
  // The state topic may live on another broker entirely
  const stateBrokerId =
    (separateRead && config.stateBrokerId?.trim()) || brokerId;
  const { on: onPayload, off: offPayload } = toggleWritePayloads(config);
  const readTemplate = separateRead
    ? migrateTemplate(config.readTemplate ?? "")
    : "";
  const valueKey = config.valueKey;
  const label = config.label ?? "";
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
    const next = parseToggleState(payload, {
      onPayload,
      offPayload,
      readTemplate,
      valueKey,
    });
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
    if (!stateBrokerId || !stateTopic) return;

    let cancelled = false;
    api
      .getExplorerHistory(stateBrokerId, stateTopic)
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
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stateBrokerId,
    stateTopic,
    onPayload,
    offPayload,
    readTemplate,
    valueKey,
  ]);

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
    subscribe({
      panel_id: panelId,
      broker_id: stateBrokerId,
      topics: [stateTopic],
    });
  }, [panelId, stateBrokerId, stateTopic, subscribe]);

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
  const availH = Math.max(40, (dimensions.height || 200) - (label ? 52 : 34));
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
    displayed === null ? "bg-base-300" : displayed ? "bg-success" : "bg-error";
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
      {label && (
        <div className="shrink-0 text-center text-xs font-medium truncate pb-1">
          {label}
        </div>
      )}
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
