import { useState, useEffect, useRef } from "react";
import { MdTune } from "react-icons/md";
import { RiErrorWarningLine, RiLoader4Line, RiTimeLine } from "react-icons/ri";
import { useWebSocket } from "../../hooks/useWebSocket";
import { usePanelSize } from "../../hooks/usePanelSize";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import BrokerTopicSection from "./BrokerTopicSection";
import MqttOptionsSection from "./MqttOptionsSection";
import PanelModalFrame from "./PanelModalFrame";
import PayloadBuilder from "./PayloadBuilder";
import ReadBackSection from "./ReadBackSection";
import {
  VALUE_TOKEN,
  effectiveReadPath,
  effectiveReadTemplate,
  payloadIssue,
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
  /** Shape of incoming messages, with `◆` marking the value to read. */
  readTemplate?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Shown next to the value readout, e.g. "%" or "°C". */
  unit?: string;
  /** Legacy read path, still honoured when no template marks the value. */
  valueKey?: string;
  /**
   * Which field sent the user to the topic picker. The picker round-trips the
   * draft config and hands the chosen topic back as `initialTopic`, which would
   * otherwise always land in the command topic — this says where it belongs.
   */
  pickTarget?: "topic" | "stateTopic";
  /** Command broker carried across the picker round-trip. */
  commandBrokerId?: string;
  /**
   * The literal payload published, with `◆` marking where the position drops
   * in. Absent means the position is published on its own.
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
  const defaultBrokerId =
    brokerStatuses.find((b) => b.is_enabled)?.id ?? brokerStatuses[0]?.id ?? "";
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
  // Lets the user sweep the range and watch the bytes change
  const [demoPosition, setDemoPosition] = useState<number | null>(null);
  const [qos, setQos] = useState(config.qos ?? 0);
  const [retain, setRetain] = useState(config.retain ?? false);
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    (pickedForState ? config.commandBrokerId : initialBrokerId) ||
      brokerId ||
      defaultBrokerId,
  );

  // Everything the user has typed so far, carried through the picker so a trip
  // to the explorer does not discard in-progress edits.
  const draft = (pickTarget: "topic" | "stateTopic"): SliderConfig => ({
    topic,
    separateRead,
    stateTopic,
    stateBrokerId,
    readTemplate,
    min: Number(min),
    max: Number(max),
    step: Number(step),
    unit,
    payloadTemplate,
    valueKey: config.valueKey,
    qos,
    retain,
    pickTarget,
    commandBrokerId: selectedBrokerId,
  });

  const hasWildcardWarning = topic.includes("+") || topic.includes("#");
  const effectiveStateTopic = separateRead ? stateTopic.trim() : "";
  const effectiveStateBroker =
    (separateRead && stateBrokerId) || selectedBrokerId;

  // `Number("")` is 0, which would let a cleared Low save as a silent zero, so
  // a blank field parses as NaN and fails the checks below like any other
  // unusable entry.
  const parseField = (raw: string) => (raw.trim() === "" ? NaN : Number(raw));

  const minNum = parseField(min);
  const maxNum = parseField(max);
  const stepNum = parseField(step);
  const rangeBlank = !Number.isFinite(minNum) || !Number.isFinite(maxNum);
  const rangeInvalid = rangeBlank || maxNum <= minNum;
  const stepInvalid = !Number.isFinite(stepNum) || stepNum <= 0;

  // Show the user what actually goes on the wire, using the midpoint so the
  // example is representative rather than always the minimum.
  const exampleValue = rangeInvalid
    ? DEFAULT_MAX / 2
    : clampToRange(
        (minNum + maxNum) / 2,
        normalizeRange({ min: minNum, max: maxNum, step: stepNum }),
      );

  const previewPosition = demoPosition ?? exampleValue;

  // A payload with nowhere for the position to go publishes the same bytes on
  // every move, so it blocks Save the way a missing topic does.
  const payloadProblem =
    payloadIssue({ template: payloadTemplate }) ??
    (separateRead
      ? payloadIssue({ template: readTemplate, mode: "read" })
      : null);

  return (
    <PanelModalFrame
      title="Slider Configuration"
      icon={MdTune}
      onClose={onClose}
      onSave={() =>
        onSave(
          {
            topic,
            separateRead,
            stateTopic: effectiveStateTopic,
            stateBrokerId: separateRead ? effectiveStateBroker : undefined,
            readTemplate: separateRead ? readTemplate : undefined,
            min: minNum,
            max: maxNum,
            step: stepNum,
            unit: unit.trim(),
            valueKey: config.valueKey,
            payloadTemplate,
            qos,
            retain,
          },
          selectedBrokerId || defaultBrokerId,
        )
      }
      saveDisabled={
        brokerStatuses.length === 0 ||
        !topic.trim() ||
        hasWildcardWarning ||
        rangeInvalid ||
        stepInvalid ||
        Boolean(payloadProblem)
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
            ? () =>
                onPickTopic({
                  currentTopic: topic,
                  selectedBrokerId,
                  draftConfig: draft("topic"),
                })
            : undefined
        }
        topicLabel="Command topic"
        allowWildcards={false}
        allowMultiple={false}
        helpText="The topic the slider publishes to. Also used to read the value back unless a separate state topic is set below."
      />

      <fieldset className="fieldset p-0 border-0">
        <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
          Range
        </legend>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-base-content/60">Low</span>
            <input
              type="number"
              className={`input input-bordered input-sm w-full font-mono text-xs ${
                rangeInvalid ? "input-warning" : ""
              }`}
              value={min}
              onChange={(e) => setMin(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-base-content/60">High</span>
            <input
              type="number"
              className={`input input-bordered input-sm w-full font-mono text-xs ${
                rangeInvalid ? "input-warning" : ""
              }`}
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-base-content/60">Step</span>
            <input
              type="number"
              min="0"
              className={`input input-bordered input-sm w-full font-mono text-xs ${
                stepInvalid ? "input-warning" : ""
              }`}
              value={step}
              onChange={(e) => setStep(e.target.value)}
            />
          </label>
        </div>
        {rangeInvalid && (
          <p className="text-[11px] text-warning mt-1.5 leading-normal">
            {rangeBlank
              ? "Low and High are both required."
              : "High must be greater than Low."}
          </p>
        )}
        {!rangeInvalid && stepInvalid && (
          <p className="text-[11px] text-warning mt-1.5 leading-normal">
            Step must be greater than 0.
          </p>
        )}
      </fieldset>

      <fieldset className="fieldset p-0 border-0">
        <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
          Unit <span className="opacity-60 font-normal">(optional)</span>
        </legend>
        <input
          className="input input-bordered input-sm w-full font-mono text-xs"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="e.g. %"
        />
        <p className="text-[11px] text-base-content/60 mt-1.5 leading-normal">
          Shown next to the value. Display only — never sent to the broker.
        </p>
      </fieldset>

      <PayloadBuilder
        template={payloadTemplate}
        onTemplateChange={setPayloadTemplate}
        previews={[{ key: "", value: String(previewPosition) }]}
        brokerId={selectedBrokerId}
        topic={topic}
        previewNote="Move the handle: this is what the slider publishes at that position."
      >
        {/* Sweep the range and watch the bytes underneath follow. The position
            is not repeated as a number — the payload line below is the value. */}
        <input
          type="range"
          aria-label="Preview position"
          className="range range-primary range-xs w-full"
          min={rangeInvalid ? 0 : minNum}
          max={rangeInvalid ? 100 : maxNum}
          step={stepInvalid ? 1 : stepNum}
          value={previewPosition}
          onChange={(e) => setDemoPosition(Number(e.target.value))}
        />
      </PayloadBuilder>

      <ReadBackSection
        enabled={separateRead}
        onEnabledChange={setSeparateRead}
        brokerStatuses={brokerStatuses}
        brokerId={effectiveStateBroker}
        onBrokerChange={setStateBrokerId}
        topic={stateTopic}
        onTopicChange={setStateTopic}
        onPickTopic={
          onPickTopic
            ? () =>
                onPickTopic({
                  currentTopic: stateTopic,
                  selectedBrokerId: effectiveStateBroker,
                  draftConfig: draft("stateTopic"),
                })
            : undefined
        }
        readTemplate={readTemplate}
        onReadTemplateChange={setReadTemplate}
        noun="value"
      />

      <MqttOptionsSection
        qos={qos}
        retain={retain}
        onQosChange={setQos}
        onRetainChange={setRetain}
      />
    </PanelModalFrame>
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
    config.valueKey ?? "",
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
  const readTemplate = effectiveReadTemplate(config);
  const valueKey = effectiveReadPath(config);
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
    const next = parseSliderValue(payload, {
      template: readTemplate,
      path: valueKey,
    });
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
  }, [stateBrokerId, stateTopic, valueKey]);

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
    const raw = Number(typed);
    setTyped(null);
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
