import { useState } from "react";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import BrokerTopicSection from "./BrokerTopicSection";
import MqttOptionsSection from "./MqttOptionsSection";
import PanelModalFrame from "./PanelModalFrame";
import { usePanelSize } from "../../hooks/usePanelSize";

export interface ButtonConfig {
  label?: string;
  topic?: string;
  payload?: string;
  qos?: number;
  retain?: boolean;
  requireConfirm?: boolean;
}

interface ModalProps {
  config: ButtonConfig;
  brokerId: string;
  brokerStatuses: BrokerStatus[];
  onSave: (cfg: ButtonConfig, brokerId: string) => void;
  onClose: () => void;
  onPickTopic?: (data: {
    currentTopic: string;
    selectedBrokerId: string;
  }) => void;
  initialTopic?: string;
  initialBrokerId?: string;
}

export function ButtonConfigModal({
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
  const [label, setLabel] = useState(config.label ?? "Click");
  const [topic, setTopic] = useState(initialTopic ?? config.topic ?? "");
  const [payload, setPayload] = useState(config.payload ?? "");
  const [qos, setQos] = useState(config.qos ?? 0);
  const [retain, setRetain] = useState(config.retain ?? false);
  const [requireConfirm, setRequireConfirm] = useState(
    config.requireConfirm ?? false,
  );
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || defaultBrokerId,
  );

  const hasWildcardWarning =
    topic.includes("+") || topic.includes("#");

  return (
    <PanelModalFrame
      title="Button Configuration"
      onClose={onClose}
      onSave={() =>
        onSave(
          { label, topic, payload, qos, retain, requireConfirm },
          selectedBrokerId,
        )
      }
      saveDisabled={
        brokerStatuses.length === 0 || !topic.trim() || hasWildcardWarning
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
      />

      <fieldset className="fieldset p-0 border-0">
        <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
          Button Label
        </legend>
        <input
          className="input input-bordered input-sm w-full font-medium"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Button text"
        />
      </fieldset>

      <fieldset className="fieldset p-0 border-0">
        <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
          Payload
        </legend>
        <textarea
          className="textarea textarea-bordered textarea-sm w-full font-mono"
          rows={3}
          placeholder='{"action": "on"}'
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
        />
      </fieldset>

      <fieldset className="fieldset p-0 border-0">
        <label className="flex items-center justify-between cursor-pointer p-2 rounded-lg border border-base-300 bg-base-200/40">
          <span className="text-xs font-medium text-base-content/80">
            Require Confirmation before publishing
          </span>
          <input
            type="checkbox"
            className="toggle toggle-xs toggle-primary"
            checked={requireConfirm}
            onChange={(e) => setRequireConfirm(e.target.checked)}
          />
        </label>
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

// Keeps the label readable without turning the panel into a billboard.
const MAX_FONT_SIZE = 28;

// The button spans most of the panel but stays inset from its edges.
const WIDTH_RATIO = 0.8;

interface ButtonPanelProps {
  panelId: string;
  brokerId: string;
  config: ButtonConfig;
}

export default function ButtonPanel({ brokerId, config }: ButtonPanelProps) {
  const { ref: containerRef, size: dimensions } = usePanelSize<HTMLDivElement>();
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<"success" | "error" | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const qos = config.qos ?? 0;
  const retain = config.retain ?? false;

  const rawTopic = config.topic ?? "";
  const parsedTopics = rawTopic
    ? rawTopic
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
    : [];

  const hasWildcard = parsedTopics.some((t) => t.includes("+") || t.includes("#"));

  const publishMessage = async () => {
    if (parsedTopics.length === 0 || hasWildcard) return;
    setLoading(true);
    try {
      await Promise.all(
        parsedTopics.map((t) =>
          api.post("/api/publish", {
            broker_id: brokerId,
            topic: t,
            payload: config.payload ?? "",
            qos,
            retain,
          }),
        ),
      );
      setFlash("success");
    } catch {
      setFlash("error");
    } finally {
      setLoading(false);
      setTimeout(() => setFlash(null), 1500);
    }
  };

  const handleClick = () => {
    if (parsedTopics.length === 0 || hasWildcard) return;
    if (config.requireConfirm) {
      setShowConfirmModal(true);
    } else {
      publishMessage();
    }
  };

  const label = config.label ?? "Click";

  // Dynamic Sizing derived from container dimensions
  const availW = Math.max(60, (dimensions.width || 240) - 16);
  const availH = Math.max(40, (dimensions.height || 120) - 16);

  // The button fills the panel rather than hugging its label, so the box is a
  // function of the panel alone and only the text is clamped.
  const labelLen = Math.max(1, label.length);
  const btnWidth = Math.max(48, Math.round(availW * WIDTH_RATIO));
  const btnHeight = Math.max(28, Math.min(Math.round(availH * 0.72), 160));
  const btnPaddingX = Math.max(12, Math.min(Math.round(btnWidth * 0.08), 32));
  const btnRadius = Math.max(6, Math.round(Math.min(btnHeight * 0.22, 24)));

  // Font scales on both axes against the button's real inner width, so a long
  // label shrinks to fit instead of truncating.
  const textWidthBudget = Math.max(24, btnWidth - 2 * btnPaddingX);
  const fontSize = Math.max(
    10,
    Math.floor(
      Math.min(
        availH * 0.34,
        textWidthBudget / (labelLen * 0.58),
        MAX_FONT_SIZE,
      ),
    ),
  );

  return (
    <div
      ref={containerRef}
      className="flex items-center justify-center h-full w-full overflow-hidden p-2"
    >
      <button
        className={`btn border-0 font-semibold ${
          flash === "success"
            ? "btn-success"
            : flash === "error"
              ? "btn-error"
              : "btn-primary"
        }`}
        style={{
          fontSize: `${fontSize}px`,
          width: `${btnWidth}px`,
          height: `${btnHeight}px`,
          minHeight: `${btnHeight}px`,
          paddingInline: `${btnPaddingX}px`,
          borderRadius: `${btnRadius}px`,
        }}
        onClick={handleClick}
        disabled={loading || parsedTopics.length === 0 || hasWildcard}
        title={
          hasWildcard
            ? "Cannot publish to wildcard topics (+ or #)"
            : parsedTopics.length === 0
              ? "No topic configured"
              : undefined
        }
      >
        {loading ? (
          <span
            className="loading loading-spinner"
            style={{
              width: `${Math.round(fontSize * 1.2)}px`,
              height: `${Math.round(fontSize * 1.2)}px`,
            }}
          />
        ) : (
          <span className="truncate leading-none min-w-0">{label}</span>
        )}
      </button>

      {showConfirmModal && (
        <dialog className="modal modal-open backdrop-blur-xs">
          <div className="modal-box max-w-sm p-5">
            <h3 className="font-bold text-base mb-2">Confirm Action</h3>
            <p className="text-xs text-base-content/80 mb-3">
              Are you sure you want to send this message to {parsedTopics.length === 1 ? "topic" : `${parsedTopics.length} topics`}?
            </p>
            <div className="flex flex-wrap gap-1 mb-4 max-h-28 overflow-y-auto">
              {parsedTopics.map((t, idx) => (
                <code
                  key={`${t}-${idx}`}
                  className="font-mono bg-base-200 text-xs px-2 py-0.5 rounded border border-base-300"
                >
                  {t}
                </code>
              ))}
            </div>
            <div className="modal-action">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowConfirmModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setShowConfirmModal(false);
                  publishMessage();
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
    </div>
  );
}
