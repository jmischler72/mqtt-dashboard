import { useEffect, useRef, useState } from "react";
import { MdInput } from "react-icons/md";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import {
  BrokerTopicCard,
  ConfigCard,
  ConfigGroup,
  FieldRow,
  PanelConfigModal,
  PublishOptionsCard,
  brokerPresence,
  brokerRules,
  defaultBrokerId,
  topicRules,
  useConfigValidation,
} from "./config";

export interface InputConfig {
  topic?: string;
  /** Placeholder inside the field. Display only. */
  placeholder?: string;
  qos?: number;
  retain?: boolean;
}

interface ModalProps {
  config: InputConfig;
  brokerId: string;
  brokerStatuses: BrokerStatus[];
  onSave: (cfg: InputConfig, brokerId: string) => void;
  onClose: () => void;
  onPickTopic?: (data: {
    currentTopic: string;
    selectedBrokerId: string;
    draftConfig?: InputConfig;
  }) => void;
  initialTopic?: string;
  initialBrokerId?: string;
}

export function InputConfigModal({
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

  const [topic, setTopic] = useState(initialTopic ?? config.topic ?? "");
  const [placeholder, setPlaceholder] = useState(config.placeholder ?? "");
  const [qos, setQos] = useState(config.qos ?? 0);
  const [retain, setRetain] = useState(config.retain ?? false);
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || fallbackBroker,
  );
  const [touched, setTouched] = useState(Boolean(config.topic));

  const draft = (): InputConfig => ({
    topic,
    placeholder,
    qos,
    retain,
  });

  const { fieldErrors, blockerReason } = useConfigValidation(
    [...brokerRules(brokerStatuses.length), ...topicRules({ topic })],
    { touched },
  );

  const topicCount = topic.split(",").filter((t) => t.trim()).length;

  return (
    <PanelConfigModal
      icon={MdInput}
      title="Input Configuration"
      brokerStatus={brokerPresence(brokerStatuses, selectedBrokerId)}
      blockerReason={blockerReason}
      onCancel={onClose}
      onSave={() =>
        onSave(
          {
            topic,
            placeholder,
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
          summary={topicCount > 1 ? `${topicCount} topics` : undefined}
          brokers={brokerStatuses}
          brokerId={selectedBrokerId}
          onBrokerChange={setSelectedBrokerId}
          topic={topic}
          onTopicChange={(next) => {
            setTopic(next);
            setTouched(true);
          }}
          topicPlaceholder="home/display/text"
          topicError={fieldErrors.topic}
          help="Comma-separate to publish to several topics."
          onExplore={
            onPickTopic
              ? () =>
                  onPickTopic({
                    currentTopic: topic,
                    selectedBrokerId,
                    draftConfig: draft(),
                  })
              : undefined
          }
        />

        <PublishOptionsCard
          qos={qos}
          onQosChange={setQos}
          retain={retain}
          onRetainChange={setRetain}
          retainNote="Last text kept for new subscribers"
        />
      </ConfigGroup>

      <ConfigGroup heading="Appearance">
        <ConfigCard>
          <FieldRow
            label="Hint"
            help="Placeholder shown inside the empty field."
          >
            <input
              className="input input-bordered w-full min-w-0 h-8 min-h-8 text-xs"
              value={placeholder}
              onChange={(e) => setPlaceholder(e.target.value)}
              placeholder="Enter payload…"
            />
          </FieldRow>
        </ConfigCard>
      </ConfigGroup>
    </PanelConfigModal>
  );
}

interface InputPanelProps {
  brokerId: string;
  config: InputConfig;
  overrideTopic?: string;
  overrideBrokerId?: string;
}

export default function InputPanel({
  brokerId,
  config,
  overrideTopic,
  overrideBrokerId,
}: InputPanelProps) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<"success" | "error" | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    [],
  );

  const effectiveTopic = overrideTopic ?? config.topic;
  const effectiveBrokerId = overrideBrokerId ?? brokerId;
  const qos = config.qos ?? 0;
  const retain = config.retain ?? false;

  const parsedTopics = effectiveTopic
    ? effectiveTopic
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const hasWildcard = parsedTopics.some(
    (t) => t.includes("+") || t.includes("#"),
  );

  const handlePublish = async () => {
    if (parsedTopics.length === 0 || hasWildcard) return;
    setLoading(true);
    try {
      await Promise.all(
        parsedTopics.map((t) =>
          api.post("/api/publish", {
            broker_id: effectiveBrokerId,
            topic: t,
            payload: value,
            qos,
            retain,
          }),
        ),
      );
      setValue("");
      setFlash("success");
    } catch {
      setFlash("error");
    } finally {
      setLoading(false);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlash(null), 1500);
    }
  };

  return (
    <div className="flex flex-col h-full gap-2 p-1">
      <textarea
        className="textarea textarea-bordered font-mono flex-1 resize-none w-full"
        placeholder={config.placeholder || "Enter payload…"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!loading && parsedTopics.length > 0 && value && !hasWildcard) {
              handlePublish();
            }
          }
        }}
      />
      <button
        className={`btn btn-sm ${
          flash === "success"
            ? "btn-success"
            : flash === "error"
              ? "btn-error"
              : "btn-primary"
        }`}
        onClick={handlePublish}
        disabled={loading || parsedTopics.length === 0 || !value || hasWildcard}
        title={
          hasWildcard ? "Cannot publish to wildcard topics (+ or #)" : undefined
        }
      >
        {loading ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          `Publish${parsedTopics.length > 1 ? ` (${parsedTopics.length} topics)` : ""}`
        )}
      </button>
    </div>
  );
}
