import { useState, useEffect, useRef } from "react";
import { MdTune } from "react-icons/md";
import { RiErrorWarningLine, RiLoader4Line, RiTimeLine } from "react-icons/ri";
import { useWebSocket } from "../../hooks/useWebSocket";
import { usePanelSize } from "../../hooks/usePanelSize";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import {
  BrokerTopicCard,
  ConfigCard,
  ConfigGroup,
  DisclosureCard,
  FieldRow,
  NumberRangeRow,
  PanelConfigModal,
  PayloadBuilder,
  PayloadSummary,
  PublishOptionsCard,
  ReadBackSwitch,
  brokerPresence,
  brokerRules,
  defaultBrokerId,
  payloadRules,
  rangeRules,
  topicRules,
  useConfigValidation,
} from "./config";
import {
  VALUE_TOKEN,
  effectiveReadTemplate,
  renderPayload,
} from "./payloadShape";
import {
  clampToRange,
  normalizeRange,
  parseSliderValue,
  valueToFraction,
  DEFAULT_MAX,
  DEFAULT_MIN,
  DEFAULT_STEP,
} from "./sliderUtils";

/** How long to wait for the state topic to confirm a write before giving up. */
const CONFIRM_TIMEOUT_MS = 5000;

export interface SliderConfig {
  /** Command topic — the slider publishes here. */
  topic?: string;
  /** Reads back from its own broker/topic/shape rather than the command one. */
  separateRead?: boolean;
  /** State/telemetry topic, used when separateRead is set. */
  stateTopic?: string;
  /** Broker the state topic lives on; defaults to the command broker. */
  stateBrokerId?: string;
  /** Shape of incoming messages, with `{value}` marking the value to read. */
  readTemplate?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Shown next to the value readout, e.g. "%" or "°C". */
  unit?: string;
  /**
   * Which field sent the user to the topic picker. The picker round-trips the
   * draft config and hands the chosen topic back as `initialTopic`, which would
   * otherwise always land in the command topic — this says where it belongs.
   */
  pickTarget?: "topic" | "stateTopic";
  /** Command broker carried across the picker round-trip. */
  commandBrokerId?: string;
  /**
   * The literal payload published, with `{value}` marking where the position
   * drops in. Absent means the position is published on its own.
   */
  payloadTemplate?: string;
  qos?: number;
  retain?: boolean;
}

interface ModalProps {
  config: SliderConfig;
  brokerId: string;
  brokerStatuses: BrokerStatus[];
  onSave: (cfg: SliderConfig, brokerId: string) => void;
  onClose: () => void;
  onPickTopic?: (data: {
    currentTopic: string;
    selectedBrokerId: string;
    draftConfig?: SliderConfig;
  }) => void;
  initialTopic?: string;
  initialBrokerId?: string;
}

export function SliderConfigModal({
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

  const [topic, setTopic] = useState(
    (pickedForState ? config.topic : initialTopic) ?? config.topic ?? "",
  );
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
    config.readTemplate ?? config.payloadTemplate ?? VALUE_TOKEN,
  );
  const [min, setMin] = useState(String(config.min ?? DEFAULT_MIN));
  const [max, setMax] = useState(String(config.max ?? DEFAULT_MAX));
  const [step, setStep] = useState(String(config.step ?? DEFAULT_STEP));
  const [unit, setUnit] = useState(config.unit ?? "");
  const [payloadTemplate, setPayloadTemplate] = useState(
    config.payloadTemplate ?? VALUE_TOKEN,
  );
  const [qos, setQos] = useState(config.qos ?? 0);
  const [retain, setRetain] = useState(config.retain ?? false);
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    (pickedForState ? config.commandBrokerId : initialBrokerId) ||
      brokerId ||
      fallbackBroker,
  );

  const effectiveStateBroker =
    (separateRead && stateBrokerId) || selectedBrokerId;

  // `Number("")` is 0 and `Number("ab")` is NaN, either of which would turn a
  // field the user has not finished into a value they never chose — and NaN
  // reaches the stored config as null. A field that is not a usable number
  // falls back to the default it started from instead.
  const asNumber = (raw: string, fallback: number) => {
    const value = Number(raw);
    return raw.trim() !== "" && Number.isFinite(value) ? value : fallback;
  };
  const minNum = asNumber(min, DEFAULT_MIN);
  const maxNum = asNumber(max, DEFAULT_MAX);
  const stepNum = asNumber(step, DEFAULT_STEP);

  // Everything the user has typed so far, carried through the picker so a trip
  // to the explorer does not discard in-progress edits.
  const draft = (pickTarget: "topic" | "stateTopic"): SliderConfig => ({
    topic,
    separateRead,
    stateTopic,
    stateBrokerId,
    readTemplate,
    min: minNum,
    max: maxNum,
    step: stepNum,
    unit,
    payloadTemplate,
    qos,
    retain,
    pickTarget,
    commandBrokerId: selectedBrokerId,
  });

  const { fieldErrors, blockerReason } = useConfigValidation([
    ...brokerRules(brokerStatuses.length),
    ...topicRules({ topic, allowMultiple: false, subject: "A command topic" }),
    ...rangeRules({ low: min, high: max, step }),
    ...payloadRules({
      value: payloadTemplate,
      mode: "write",
      subject: "the slider has",
    }),
    ...(separateRead
      ? [
          ...topicRules({
            field: "stateTopic",
            topic: stateTopic,
            allowWildcards: true,
            // Subscribed to as one topic, so a list would be handed to the
            // broker whole and match nothing — the command topic above says
            // the same thing.
            allowMultiple: false,
            subject: "A state topic",
          }),
          ...payloadRules({
            field: "readShape",
            value: readTemplate,
            mode: "read",
          }),
        ]
      : []),
  ]);

  const rangeUsable = !fieldErrors.range && maxNum > minNum && stepNum > 0;

  return (
    <PanelConfigModal
      icon={MdTune}
      title="Slider Configuration"
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
            min: minNum,
            max: maxNum,
            step: stepNum,
            unit: unit.trim(),
            payloadTemplate,
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
          }}
          topicPlaceholder="home/light/brightness/set"
          topicError={fieldErrors.topic}
          help="Publishes here, and reads the value back from here unless you turn on Read below."
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

        {/* The range decides which numbers are legal on the wire, so it belongs
            to Publish even though it also draws the handle. */}
        <ConfigCard
          title="Value range"
          summary={rangeUsable ? `${minNum} – ${maxNum} · step ${stepNum}` : ""}
          invalid={Boolean(fieldErrors.range)}
        >
          <NumberRangeRow
            fields={[
              {
                label: "Low",
                value: min,
                placeholder: "0",
                invalid: Boolean(fieldErrors.range),
                onChange: (next) => {
                  setMin(next);
                },
              },
              {
                label: "High",
                value: max,
                placeholder: "100",
                invalid: Boolean(fieldErrors.range),
                onChange: (next) => {
                  setMax(next);
                },
              },
              {
                label: "Step",
                value: step,
                placeholder: "1",
                invalid: Boolean(fieldErrors.range),
                onChange: (next) => {
                  setStep(next);
                },
              },
            ]}
          />
          {fieldErrors.range && (
            <span className="text-[11px] text-warning">
              {fieldErrors.range}
            </span>
          )}
        </ConfigCard>

        <DisclosureCard
          title="Message"
          summary={<PayloadSummary value={payloadTemplate} />}
          defaultOpen={payloadTemplate.trim() === ""}
          invalid={Boolean(fieldErrors.payload)}
        >
          <PayloadBuilder
            mode="write"
            value={payloadTemplate}
            onChange={(next) => {
              setPayloadTemplate(next);
            }}
            brokerId={selectedBrokerId}
            topic={topic}
            range={
              rangeUsable ? { min: minNum, max: maxNum, step: stepNum } : null
            }
            placeholder={`{"brightness":${VALUE_TOKEN}}`}
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
          retainNote="Last position kept for new subscribers"
        />
      </ConfigGroup>

      <ConfigGroup heading="Read">
        <ReadBackSwitch
          on={separateRead}
          onToggle={(next) => {
            setSeparateRead(next);
          }}
          title="A different topic reports the value"
          offExplanation="The device reports on the command topic, in the same shape the panel publishes."
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
            }}
            topicPlaceholder="home/light/brightness"
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
                the chip marks the value to pull out
              </span>
            </div>
            <PayloadBuilder
              mode="read"
              value={readTemplate}
              onChange={(next) => {
                setReadTemplate(next);
              }}
              brokerId={effectiveStateBroker}
              topic={stateTopic}
              unit={unit}
              placeholder={`{"brightness":${VALUE_TOKEN}}`}
            />
            <button
              type="button"
              onClick={() => setReadTemplate(payloadTemplate)}
              className="self-start inline-flex items-center h-6 px-2.5 rounded-full border border-base-300 dark:border-base-100 bg-base-100 text-[11px] font-medium text-base-content/70 cursor-pointer hover:border-primary"
            >
              same as Message
            </button>
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
            label="Unit"
            help="Shown next to the value. Display only — never sent to the broker."
          >
            <input
              className="input input-bordered w-full min-w-0 h-8 min-h-8 text-xs"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g. %"
            />
          </FieldRow>
        </ConfigCard>
      </ConfigGroup>
    </PanelConfigModal>
  );
}

interface SliderPanelProps {
  panelId: string;
  brokerId: string;
  config: SliderConfig;
}

/** Same HH:MM:SS footer format the gauge and toggle panels use. */
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
 * topic or range, so stale state is dropped without a reset effect.
 */
export default function SliderPanel(props: SliderPanelProps) {
  const { brokerId, config } = props;
  const identity = [
    brokerId,
    config.topic ?? "",
    config.stateTopic ?? "",
    config.stateBrokerId ?? "",
    config.readTemplate ?? "",
    // The write template is also the read stencil when there is no separate
    // state topic, so editing it has to remount the runtime.
    config.payloadTemplate ?? "",
    String(config.min ?? DEFAULT_MIN),
    String(config.max ?? DEFAULT_MAX),
    String(config.step ?? DEFAULT_STEP),
  ].join("\u0000");

  return <SliderRuntime key={identity} {...props} />;
}

function SliderRuntime({ panelId, brokerId, config }: SliderPanelProps) {
  // Last value the device reported; null until the state topic says something.
  const [remote, setRemote] = useState<number | null>(null);
  // Handle position while the user is holding it, null when they are not.
  const [dragging, setDragging] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [error, setError] = useState(false);
  // Set while the readout is being typed into, holding the text as typed
  const [typed, setTyped] = useState<string | null>(null);

  const { ref: sizeRef, size } = usePanelSize<HTMLDivElement>();
  const pendingRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commandTopic = (config.topic ?? "").split(",")[0]?.trim() ?? "";
  const separateRead =
    config.separateRead ?? Boolean(config.stateTopic?.trim());
  const stateTopic =
    (separateRead && config.stateTopic?.trim()) || commandTopic;
  // The state topic may live on another broker entirely
  const stateBrokerId =
    (separateRead && config.stateBrokerId?.trim()) || brokerId;
  const range = normalizeRange(config);
  const unit = config.unit?.trim() ?? "";
  // The derived flag, not the stored one: a config saved before `separateRead`
  // existed says so only by carrying a state topic, and reading such a panel
  // through the *write* shape would decode the state topic with the wrong
  // stencil. The toggle resolves it the same way.
  const readTemplate = effectiveReadTemplate({ ...config, separateRead });
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
  // pending write and replaces the optimistic position.
  const applyIncomingValue = (payload: string, receivedAt: number) => {
    const next = parseSliderValue(payload, { template: readTemplate });
    if (next === null) return;

    setRemote(next);
    setUpdatedAt(receivedAt);

    const inFlight = pendingRef.current;
    if (inFlight !== null) {
      clearPendingTimer();
      pendingRef.current = null;
      setPending(null);
      // Devices commonly round or clamp what they were sent, so anything
      // within a step of the request counts as having landed.
      setUnconfirmed(Math.abs(next - inFlight) > range.step);
    }
  };

  useEffect(() => clearPendingTimer, []);

  // Seed the last known value from history so a reload isn't blank
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
        applyIncomingValue(
          last.payload,
          Number.isNaN(parsed) ? Date.now() : parsed,
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateBrokerId, stateTopic, readTemplate]);

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
        applyIncomingValue(
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

  const disabled = !commandTopic || hasWildcard;

  // Publishes once, when the handle is released — dragging only moves the
  // local position, so one adjustment is one MQTT message.
  const commit = async (raw: number) => {
    setDragging(null);
    if (disabled) return;

    const value = clampToRange(raw, range);
    setUnconfirmed(false);
    setError(false);
    pendingRef.current = value;
    setPending(value);

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
        payload: renderPayload(config.payloadTemplate ?? VALUE_TOKEN, value),
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

  /** Publish what was typed into the readout, snapped onto the range. */
  const commitTyped = () => {
    const text = (typed ?? "").trim();
    setTyped(null);
    // `Number("")` is 0, so a field cleared and confirmed would publish the
    // range minimum — a command nobody asked for. Nothing typed, nothing sent.
    if (text === "") return;
    const raw = Number(text);
    if (!Number.isFinite(raw)) return;
    commit(raw);
  };

  // Follow the finger first, then the optimistic write, then the device.
  const displayed = dragging ?? pending ?? remote;
  const handlePosition = displayed ?? range.min;

  // Scale the readout with the panel, like GaugePanel does.
  const availH = Math.max(40, (size.height || 200) - 34);
  const availW = Math.max(40, (size.width || 240) - 16);
  const valueFontSize = Math.round(
    Math.max(13, Math.min(availH * 0.26, availW * 0.17, 48)),
  );
  const unitFontSize = Math.max(9, Math.round(valueFontSize * 0.4));
  // The handle is what the user actually has to hit, so it grows with the panel
  // like the readout does — never below a comfortable touch target.
  const thumbSize = Math.round(
    Math.max(24, Math.min(availW * 0.11, availH * 0.3, 44)),
  );
  // daisyUI draws the track at half the thumb, which reads as a bar with a knob
  // on it. A hairline under a round handle makes the grabbable part obvious:
  // the circle stays several times wider than the line it rides on.
  const trackSize = Math.min(10, Math.max(6, Math.round(thumbSize * 0.22)));
  const filled = valueToFraction(handlePosition, range);

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
  } else if (pending !== null) {
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
    status = <span className="text-base-content/50">waiting for value…</span>;
  }

  return (
    <div
      ref={sizeRef}
      className="flex flex-col h-full justify-between p-2 overflow-hidden"
    >
      <div className="grid flex-1 min-h-0 w-full grid-rows-[1fr_auto_1fr] items-center">
        <div className="flex items-baseline justify-center gap-1 leading-none self-end pb-2">
          {typed !== null ? (
            <input
              type="number"
              autoFocus
              className="font-bold font-mono text-base-content tabular-nums bg-transparent border-b border-primary outline-none text-center w-[5ch] p-0 leading-none"
              style={{ fontSize: valueFontSize }}
              min={range.min}
              max={range.max}
              step={range.step}
              value={typed}
              aria-label="Value"
              onChange={(e) => setTyped(e.target.value)}
              onBlur={commitTyped}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTyped();
                if (e.key === "Escape") setTyped(null);
              }}
            />
          ) : (
            <span
              className={`font-bold font-mono text-base-content tabular-nums ${
                disabled ? "" : "cursor-text"
              }`}
              style={{ fontSize: valueFontSize }}
              title={disabled ? undefined : "Double-click to type a value"}
              onDoubleClick={() => {
                if (disabled) return;
                setTyped(String(displayed ?? range.min));
              }}
            >
              {displayed === null ? "—" : displayed}
            </span>
          )}
          {unit && (
            <span
              className="font-mono text-base-content/60"
              style={{ fontSize: unitFontSize }}
            >
              {unit}
            </span>
          )}
        </div>

        <div className="w-full">
          <input
            type="range"
            className={`range range-primary range-hairline w-full ${
              pending !== null ? "animate-pulse" : ""
            }`}
            style={
              {
                "--range-thumb-size": `${thumbSize}px`,
                "--track-size": `${trackSize}px`,
                // Off: daisyUI's fill is a shadow cast by the thumb, as tall as
                // the thumb. The track's own gradient replaces it.
                "--range-fill": "0",
                "--range-progress-x": `${filled * 100}%`,
              } as React.CSSProperties
            }
            min={range.min}
            max={range.max}
            step={range.step}
            value={handlePosition}
            disabled={disabled}
            aria-label={commandTopic || "Slider"}
            title={
              hasWildcard
                ? "Cannot publish to wildcard topics (+ or #)"
                : !commandTopic
                  ? "No topic configured"
                  : undefined
            }
            onChange={(e) => setDragging(Number(e.target.value))}
            onPointerUp={(e) => commit(Number(e.currentTarget.value))}
            onKeyUp={(e) => {
              // keyup fires on whichever element has focus, so the Tab that moves
              // focus onto the slider lands here too. Only a key that actually
              // moved the handle leaves a drag to commit.
              if (dragging !== null) commit(Number(e.currentTarget.value));
            }}
            onBlur={(e) => {
              // Pointer released outside the track still ends the drag.
              if (dragging !== null) commit(Number(e.currentTarget.value));
            }}
          />
        </div>

        {/* Same width as the track above, so the ends line up with it */}
        <div className="flex justify-between w-full text-[10px] text-base-content/40 font-mono self-start pt-1">
          <span>{range.min}</span>
          <span>{range.max}</span>
        </div>
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
