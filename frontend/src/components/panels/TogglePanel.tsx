import { useState, useEffect } from "react";
import { api } from "../../api/client";
import { useWebSocket } from "../../hooks/useWebSocket";
import type { BrokerStatus } from "../../hooks/useBrokers";
import BrokerTopicSection from "./BrokerTopicSection";
import MqttOptionsSection from "./MqttOptionsSection";
import PanelModalFrame from "./PanelModalFrame";
import { RiTimeLine, RiToggleLine, RiQuestionLine } from "react-icons/ri";
import { parseTogglePayload } from "./toggleUtils";

export interface ToggleConfig {
  label?: string;
  topic?: string;
  stateTopic?: string;
  useSeparateTopics?: boolean;
  onPayload?: string;
  offPayload?: string;
  valueKey?: string;
  qos?: number;
  retain?: boolean;
  requireConfirm?: boolean;
  _pickingField?: "topic" | "stateTopic";
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

  const pickingField = config._pickingField;

  const [label, setLabel] = useState(config.label ?? "Power");
  const [useSeparateTopics, setUseSeparateTopics] = useState(
    config.useSeparateTopics ?? Boolean(config.stateTopic),
  );

  const [topic, setTopic] = useState(
    pickingField === "topic" && initialTopic !== undefined
      ? initialTopic
      : (config.topic ?? ""),
  );
  const [stateTopic, setStateTopic] = useState(
    pickingField === "stateTopic" && initialTopic !== undefined
      ? initialTopic
      : (config.stateTopic ?? ""),
  );

  const [onPayload, setOnPayload] = useState(config.onPayload ?? "ON");
  const [offPayload, setOffPayload] = useState(config.offPayload ?? "OFF");
  const [valueKey, setValueKey] = useState(config.valueKey ?? "");
  const [qos, setQos] = useState(config.qos ?? 0);
  const [retain, setRetain] = useState(config.retain ?? false);
  const [requireConfirm, setRequireConfirm] = useState(
    config.requireConfirm ?? false,
  );
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || defaultBrokerId,
  );

  const actionTopicHasWildcard = topic.includes("+") || topic.includes("#");
  const isSaveDisabled =
    brokerStatuses.length === 0 ||
    !topic.trim() ||
    actionTopicHasWildcard ||
    (useSeparateTopics && !stateTopic.trim());

  const currentDraftConfig = (
    picking: "topic" | "stateTopic",
  ): ToggleConfig => ({
    label,
    topic,
    stateTopic,
    useSeparateTopics,
    onPayload,
    offPayload,
    valueKey,
    qos,
    retain,
    requireConfirm,
    _pickingField: picking,
  });

  return (
    <PanelModalFrame
      title="Toggle Configuration"
      onClose={onClose}
      onSave={() => {
        onSave(
          {
            label,
            topic: topic.trim(),
            stateTopic: useSeparateTopics ? stateTopic.trim() : undefined,
            useSeparateTopics,
            onPayload,
            offPayload,
            valueKey: valueKey.trim() || undefined,
            qos,
            retain,
            requireConfirm,
          },
          selectedBrokerId || defaultBrokerId,
        );
      }}
      saveDisabled={isSaveDisabled}
      maxWidthClass="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        {/* Label Field */}
        <fieldset className="fieldset p-0 border-0">
          <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
            Component Label / Name
          </legend>
          <input
            className="input input-bordered input-sm w-full font-medium"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Living Room Lamp, Relay 1, Heater"
          />
        </fieldset>

        {/* Unified or Split Topics Toggle */}
        <fieldset className="fieldset p-0 border-0">
          <label className="flex items-center justify-between cursor-pointer p-2.5 rounded-lg border border-base-300 bg-base-200/50">
            <div>
              <div className="text-xs font-semibold text-base-content">
                Separate Action & Telemetry Topics
              </div>
              <div className="text-[11px] text-base-content/60">
                Enable if your device publishes state to a different topic than
                it receives commands
              </div>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-xs toggle-primary"
              checked={useSeparateTopics}
              onChange={(e) => setUseSeparateTopics(e.target.checked)}
            />
          </label>
        </fieldset>

        {/* Action / Command Topic */}
        <BrokerTopicSection
          selectedBrokerId={selectedBrokerId}
          onBrokerChange={setSelectedBrokerId}
          brokerStatuses={brokerStatuses}
          topic={topic}
          onTopicChange={setTopic}
          topicLabel={
            useSeparateTopics
              ? "Action (Command) Topic"
              : "Topic (Action & Telemetry)"
          }
          placeholder={
            useSeparateTopics
              ? "e.g. cmnd/device/power"
              : "e.g. home/livingroom/switch"
          }
          helpText={
            useSeparateTopics
              ? "Topic where ON/OFF command payloads will be published (no wildcards)."
              : "Topic used for publishing commands and reading component state."
          }
          allowWildcards={false}
          allowMultiple={false}
          onPickTopic={
            onPickTopic
              ? () =>
                  onPickTopic({
                    currentTopic: topic,
                    selectedBrokerId,
                    draftConfig: currentDraftConfig("topic"),
                  })
              : undefined
          }
        />

        {/* Telemetry / State Topic (when separate) */}
        {useSeparateTopics && (
          <BrokerTopicSection
            selectedBrokerId={selectedBrokerId}
            onBrokerChange={setSelectedBrokerId}
            brokerStatuses={brokerStatuses}
            topic={stateTopic}
            onTopicChange={setStateTopic}
            topicLabel="State (Telemetry) Topic"
            placeholder="e.g. stat/device/power"
            helpText="Topic monitored for live state updates and historic status."
            allowWildcards={true}
            allowMultiple={false}
            onPickTopic={
              onPickTopic
                ? () =>
                    onPickTopic({
                      currentTopic: stateTopic,
                      selectedBrokerId,
                      draftConfig: currentDraftConfig("stateTopic"),
                    })
                : undefined
            }
          />
        )}

        {/* Payload Configuration */}
        <div className="border border-base-300 bg-base-200/40 rounded-xl p-3.5 flex flex-col gap-3">
          <div className="text-xs font-semibold text-base-content/90">
            Payloads & State Matching
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <fieldset className="fieldset p-0 border-0">
              <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
                ON Payload (Command)
              </legend>
              <input
                className="input input-bordered input-sm w-full font-mono text-xs"
                value={onPayload}
                onChange={(e) => setOnPayload(e.target.value)}
                placeholder="ON"
              />
            </fieldset>

            <fieldset className="fieldset p-0 border-0">
              <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
                OFF Payload (Command)
              </legend>
              <input
                className="input input-bordered input-sm w-full font-mono text-xs"
                value={offPayload}
                onChange={(e) => setOffPayload(e.target.value)}
                placeholder="OFF"
              />
            </fieldset>
          </div>

          <fieldset className="fieldset p-0 border-0">
            <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
              JSON State Key (Optional)
            </legend>
            <input
              className="input input-bordered input-sm w-full font-mono text-xs"
              value={valueKey}
              onChange={(e) => setValueKey(e.target.value)}
              placeholder="e.g. state, power, or val"
            />
            <p className="text-[11px] text-base-content/60 mt-1">
              If incoming telemetry is a JSON object, specify the property name
              to evaluate.
            </p>
          </fieldset>
        </div>

        {/* Require Confirmation */}
        <fieldset className="fieldset p-0 border-0">
          <label className="flex items-center justify-between cursor-pointer p-2.5 rounded-lg border border-base-300 bg-base-200/40">
            <span className="text-xs font-medium text-base-content/80">
              Require Confirmation before switching
            </span>
            <input
              type="checkbox"
              className="toggle toggle-xs toggle-primary"
              checked={requireConfirm}
              onChange={(e) => setRequireConfirm(e.target.checked)}
            />
          </label>
        </fieldset>

        {/* MQTT QoS & Retain */}
        <MqttOptionsSection
          qos={qos}
          retain={retain}
          onQosChange={setQos}
          onRetainChange={setRetain}
        />
      </div>
    </PanelModalFrame>
  );
}

function normalizeTimestamp(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const pad2 = (n: number) => String(n).padStart(2, "0");
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  } catch {
    return "";
  }
}

interface TogglePanelProps {
  panelId: string;
  brokerId: string;
  config: ToggleConfig;
}

export default function TogglePanel({
  panelId,
  brokerId,
  config,
}: TogglePanelProps) {
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<"success" | "error" | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const [stateData, setStateData] = useState<{
    isOn: boolean | null;
    raw: string;
    receivedAt: string;
    isHistorical: boolean;
  } | null>(null);

  const actionTopic = config.topic?.trim() ?? "";
  const stateTopic =
    config.useSeparateTopics && config.stateTopic?.trim()
      ? config.stateTopic.trim()
      : actionTopic;

  const onPayload = config.onPayload ?? "ON";
  const offPayload = config.offPayload ?? "OFF";
  const valueKey = config.valueKey;
  const qos = config.qos ?? 0;
  const retain = config.retain ?? false;
  const requireConfirm = config.requireConfirm ?? false;
  const label = config.label?.trim() || "Component";

  // Fetch initial state from topic history
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
        if (last) {
          const res = parseTogglePayload(
            last.payload,
            valueKey,
            onPayload,
            offPayload,
          );
          setStateData({
            isOn: res.isOn,
            raw: last.payload,
            receivedAt: normalizeTimestamp(last.timestamp),
            isHistorical: true,
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [brokerId, stateTopic, valueKey, onPayload, offPayload]);

  // Real-time WebSocket updates
  const { subscribe } = useWebSocket({
    onMessage: (msgStr) => {
      try {
        const msg = JSON.parse(msgStr) as {
          topic: string;
          payload: string;
          timestamp?: string;
        };
        const res = parseTogglePayload(
          msg.payload,
          valueKey,
          onPayload,
          offPayload,
        );
        setStateData({
          isOn: res.isOn,
          raw: msg.payload,
          receivedAt: normalizeTimestamp(msg.timestamp),
          isHistorical: false,
        });
      } catch {
        // Ignore malformed WS message frame
      }
    },
  });

  useEffect(() => {
    if (!stateTopic) return;
    const topicList = stateTopic
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    subscribe({ panel_id: panelId, broker_id: brokerId, topics: topicList });
  }, [panelId, brokerId, stateTopic, subscribe]);

  const currentIsOn = stateData?.isOn;

  const executePublish = async (nextState: boolean) => {
    if (!actionTopic) return;
    const payloadToSend = nextState ? onPayload : offPayload;
    setLoading(true);

    // Optimistic state update
    const previousStateData = stateData;
    setStateData({
      isOn: nextState,
      raw: payloadToSend,
      receivedAt: new Date().toISOString(),
      isHistorical: false,
    });

    try {
      await api.post("/api/publish", {
        broker_id: brokerId,
        topic: actionTopic,
        payload: payloadToSend,
        qos,
        retain,
      });
      setFlash("success");
    } catch {
      setFlash("error");
      // Revert optimistic state on error
      setStateData(previousStateData);
    } finally {
      setLoading(false);
      setTimeout(() => setFlash(null), 1500);
    }
  };

  const handleToggleClick = () => {
    if (loading || !actionTopic) return;
    const nextState = currentIsOn === null ? true : !currentIsOn;
    if (requireConfirm) {
      setShowConfirmModal(true);
    } else {
      executePublish(nextState);
    }
  };

  const nextTargetState = currentIsOn === null ? true : !currentIsOn;
  const nextTargetPayload = nextTargetState ? onPayload : offPayload;

  return (
    <div className="flex flex-col h-full justify-between p-2">
      {!actionTopic ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 text-base-content/40 p-4 text-center">
          <RiToggleLine className="text-4xl opacity-50" />
          <span className="text-sm font-medium">No Topic Configured</span>
          <span className="text-xs text-base-content/50">
            Open settings to configure the toggle action topic.
          </span>
        </div>
      ) : (
        <>
          {/* Main Toggle Display */}
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-2">
            <div className="text-sm font-bold text-base-content tracking-tight truncate max-w-full text-center">
              {label}
            </div>

            {/* Toggle Switch Control */}
            <div className="relative inline-flex items-center justify-center">
              <input
                type="checkbox"
                aria-label={`Toggle ${label}`}
                className={`toggle toggle-xl transition-all cursor-pointer ${
                  currentIsOn === true
                    ? "toggle-success shadow-md shadow-success/20"
                    : currentIsOn === false
                      ? "toggle-neutral opacity-80"
                      : "toggle-warning opacity-70"
                }`}
                checked={currentIsOn === true}
                onChange={handleToggleClick}
                disabled={loading}
              />
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-base-100/50 rounded-full">
                  <span className="loading loading-spinner loading-sm text-primary" />
                </div>
              )}
            </div>

            {/* State Status Badge */}
            <div className="flex items-center gap-2">
              {currentIsOn === true && (
                <span className="badge badge-success badge-sm font-mono font-bold tracking-wider uppercase gap-1.5 shadow-xs py-2 px-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  <span>ON</span>
                </span>
              )}
              {currentIsOn === false && (
                <span className="badge badge-neutral badge-sm font-mono font-semibold tracking-wider uppercase opacity-80 py-2 px-2.5">
                  <span>OFF</span>
                </span>
              )}
              {currentIsOn === null && (
                <span
                  className="badge badge-warning badge-outline badge-sm font-mono text-[11px] gap-1 py-2 px-2"
                  title="No telemetry received yet or state undetermined"
                >
                  <RiQuestionLine className="text-xs" />
                  <span>UNKNOWN</span>
                </span>
              )}

              {flash === "success" && (
                <span className="badge badge-xs badge-success animate-fade-in font-sans">
                  Sent
                </span>
              )}
              {flash === "error" && (
                <span className="badge badge-xs badge-error animate-fade-in font-sans">
                  Failed
                </span>
              )}
            </div>
          </div>

          {/* Footer Metadata */}
          <div className="flex items-center justify-between text-[10px] text-base-content/50 pt-1.5 border-t border-base-200">
            <div
              className="flex items-center gap-1 min-w-0"
              title={
                stateData?.raw !== undefined
                  ? `Last payload: ${stateData.raw}`
                  : "Waiting for telemetry"
              }
            >
              <RiTimeLine className="text-xs shrink-0" />
              <span className="truncate">
                {stateData?.receivedAt
                  ? formatTime(stateData.receivedAt)
                  : "No data"}
              </span>
            </div>

            <div className="flex items-center gap-1 font-mono text-[9px] shrink-0 opacity-75">
              <span>QoS {qos}</span>
              {retain && <span>· Retain</span>}
            </div>
          </div>

          {/* Confirmation Modal */}
          {showConfirmModal && (
            <dialog className="modal modal-open backdrop-blur-xs">
              <div className="modal-box max-w-sm p-5">
                <h3 className="font-bold text-base mb-2">Confirm Action</h3>
                <p className="text-xs text-base-content/80 mb-3">
                  Are you sure you want to turn{" "}
                  <strong
                    className={nextTargetState ? "text-success" : "text-error"}
                  >
                    {nextTargetState ? "ON" : "OFF"}
                  </strong>{" "}
                  <strong>{label}</strong>?
                </p>

                <div className="bg-base-200 rounded-lg p-2.5 text-xs font-mono mb-4 border border-base-300 space-y-1">
                  <div className="text-[11px] text-base-content/60">
                    Topic: <span className="text-accent">{actionTopic}</span>
                  </div>
                  <div className="text-[11px] text-base-content/60">
                    Payload:{" "}
                    <span className="font-bold text-base-content">
                      {nextTargetPayload}
                    </span>
                  </div>
                </div>

                <div className="modal-action">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowConfirmModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className={`btn btn-sm ${
                      nextTargetState ? "btn-success" : "btn-primary"
                    }`}
                    onClick={() => {
                      setShowConfirmModal(false);
                      executePublish(nextTargetState);
                    }}
                  >
                    Confirm
                  </button>
                </div>
              </div>
              <div
                className="modal-backdrop"
                onClick={() => setShowConfirmModal(false)}
              />
            </dialog>
          )}
        </>
      )}
    </div>
  );
}
