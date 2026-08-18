import { useState } from "react";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import BrokerTopicSection from "./BrokerTopicSection";
import MqttOptionsSection from "./MqttOptionsSection";

export interface InputConfig {
  topic?: string;
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
  const defaultBrokerId =
    brokerStatuses.find((b) => b.is_enabled)?.id ?? brokerStatuses[0]?.id ?? "";
  const [topic, setTopic] = useState(initialTopic ?? config.topic ?? "");
  const [qos, setQos] = useState(config.qos ?? 0);
  const [retain, setRetain] = useState(config.retain ?? false);
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || defaultBrokerId,
  );

  const hasWildcardWarning = topic.includes("+") || topic.includes("#");

  return (
    <dialog className="modal modal-open backdrop-blur-xs">
      <div className="modal-box max-h-[85vh] overflow-y-auto max-w-lg p-5">
        <h3 className="font-bold text-lg mb-4">Input Configuration</h3>
        <div className="flex flex-col gap-4">
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

          <MqttOptionsSection
            qos={qos}
            retain={retain}
            onQosChange={setQos}
            onRetainChange={setRetain}
          />
        </div>

        <div className="modal-action mt-6 pt-3 border-t border-base-300">
          <button className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={
              brokerStatuses.length === 0 ||
              !topic.trim() ||
              hasWildcardWarning
            }
            onClick={() =>
              onSave(
                { topic, qos, retain },
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

  const hasWildcard = parsedTopics.some((t) => t.includes("+") || t.includes("#"));

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
      setTimeout(() => setFlash(null), 1500);
    }
  };

  if (!effectiveTopic?.trim()) {
    return (
      <div className="flex items-center justify-center h-full text-base-content/40 text-xs">
        No topic configured — open settings to add topic
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-2 p-1">
      <textarea
        className="textarea textarea-bordered font-mono flex-1 resize-none w-full"
        placeholder="Enter payload…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
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
        title={hasWildcard ? "Cannot publish to wildcard topics (+ or #)" : undefined}
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
