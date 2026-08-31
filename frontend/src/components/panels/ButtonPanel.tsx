import { useState } from "react";
import { MdSmartButton } from "react-icons/md";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import {
  BrokerTopicCard,
  ConfigCard,
  ConfigGroup,
  DisclosureCard,
  FieldRow,
  PanelConfigModal,
  PayloadBuilder,
  PayloadSummary,
  PublishOptionsCard,
  SwitchRow,
  brokerPresence,
  brokerRules,
  defaultBrokerId,
  payloadRules,
  topicRules,
  useConfigValidation,
} from "./config";
import { migrateTemplate } from "./payloadShape";
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
  const fallbackBroker = defaultBrokerId(brokerStatuses);
  const [label, setLabel] = useState(config.label ?? "Click");
  const [topic, setTopic] = useState(initialTopic ?? config.topic ?? "");
  const [payload, setPayload] = useState(migrateTemplate(config.payload ?? ""));
  const [qos, setQos] = useState(config.qos ?? 0);
  const [retain, setRetain] = useState(config.retain ?? false);
  const [requireConfirm, setRequireConfirm] = useState(
    config.requireConfirm ?? false,
  );
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || fallbackBroker,
  );
  const [touched, setTouched] = useState(Boolean(config.topic));

  const { fieldErrors, blockerReason } = useConfigValidation(
    [
      ...brokerRules(brokerStatuses.length),
      ...topicRules({ topic }),
      // A button publishes a fixed message, so there is no runtime value for a
      // chip to stand in for — an empty payload, on the other hand, is how a
      // retained message gets cleared and is perfectly valid.
      ...payloadRules({
        value: payload,
        mode: "write",
        acceptsChip: false,
        allowEmpty: true,
        subject: "a button has",
      }),
    ],
    { touched },
  );

  const topicCount = topic.split(",").filter((t) => t.trim()).length;

  return (
    <PanelConfigModal
      icon={MdSmartButton}
      title="Button Configuration"
      brokerStatus={brokerPresence(brokerStatuses, selectedBrokerId)}
      blockerReason={blockerReason}
      onCancel={onClose}
      onSave={() =>
        onSave(
          { label, topic, payload, qos, retain, requireConfirm },
          selectedBrokerId || fallbackBroker,
        )
      }
    >
      <ConfigGroup heading="Publish">
        <BrokerTopicCard
          title="Publishes to"
          summary={topicCount > 1 ? `${topicCount} topics` : undefined}
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
          help="Comma-separate to publish to several topics."
          onExplore={
            onPickTopic
              ? () => onPickTopic({ currentTopic: topic, selectedBrokerId })
              : undefined
          }
        />

        <DisclosureCard
          title="Message"
          summary={<PayloadSummary value={payload} empty="empty message" />}
          defaultOpen
          invalid={Boolean(fieldErrors.payload)}
        >
          <PayloadBuilder
            mode="write"
            value={payload}
            onChange={setPayload}
            acceptsChip={false}
            brokerId={selectedBrokerId}
            topic={topic}
            placeholder="ON"
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
        />
      </ConfigGroup>

      <ConfigGroup heading="Appearance">
        <ConfigCard>
          <FieldRow label="Label" help="Button text. Scales to the panel.">
            <input
              className="input input-bordered w-full min-w-0 h-8 min-h-8 text-xs"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Click"
            />
          </FieldRow>

          <SwitchRow
            name="Ask before publishing"
            note="A click on the panel opens a confirm dialog"
            on={requireConfirm}
            onToggle={setRequireConfirm}
          />
        </ConfigCard>
      </ConfigGroup>
    </PanelConfigModal>
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
  const { ref: containerRef, size: dimensions } =
    usePanelSize<HTMLDivElement>();
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

  const hasWildcard = parsedTopics.some(
    (t) => t.includes("+") || t.includes("#"),
  );

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
              Are you sure you want to send this message to{" "}
              {parsedTopics.length === 1
                ? "topic"
                : `${parsedTopics.length} topics`}
              ?
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
