import { useState } from "react";
import { RiSearchLine } from "react-icons/ri";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";
import MqttOptionsSection from "./MqttOptionsSection";

export interface InputConfig {
  topic?: string;
  placeholder?: string;
  multiline?: boolean;
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
  const [placeholder, setPlaceholder] = useState(config.placeholder ?? "");
  const [multiline, setMultiline] = useState(config.multiline ?? false);
  const [qos, setQos] = useState(config.qos ?? 0);
  const [retain, setRetain] = useState(config.retain ?? false);
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || defaultBrokerId,
  );

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-h-[85vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-4">Input Configuration</h3>
        <div className="flex flex-col gap-3">
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Broker</legend>
            {brokerStatuses.length === 0 ? (
              <div role="alert" className="alert alert-warning py-2">
                <span className="text-sm">
                  No brokers configured.{" "}
                  <a href="/config" className="underline">
                    Add one in the Config page.
                  </a>
                </span>
              </div>
            ) : (
              <select
                className="select select-bordered w-full"
                value={selectedBrokerId}
                onChange={(e) => setSelectedBrokerId(e.target.value)}
              >
                {brokerStatuses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Topic</legend>
            <div className="flex gap-1 w-full">
              <input
                className="input input-bordered flex-1"
                placeholder="home/sensor/cmd"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
              {onPickTopic && (
                <button
                  type="button"
                  className="btn btn-neutral"
                  title="Browse topics in Explorer"
                  onClick={() =>
                    onPickTopic({ currentTopic: topic, selectedBrokerId })
                  }
                >
                  <RiSearchLine />
                </button>
              )}
            </div>
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Placeholder text</legend>
            <input
              className="input input-bordered w-full"
              placeholder="Enter payload…"
              value={placeholder}
              onChange={(e) => setPlaceholder(e.target.value)}
            />
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Mode</legend>
            <label className="label cursor-pointer justify-start gap-3 px-0">
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={multiline}
                onChange={(e) => setMultiline(e.target.checked)}
              />
              <span className="label-text">Multi-line / JSON mode</span>
            </label>
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">MQTT Options</legend>
            <div className="flex gap-4 flex-wrap">
              <label className="flex items-center gap-2">
                <span className="text-sm">QoS</span>
                <select
                  className="select select-sm select-bordered"
                  value={qos}
                  onChange={(e) => setQos(Number(e.target.value))}
                >
                  <option value={0}>0 – At most once</option>
                  <option value={1}>1 – At least once</option>
                  <option value={2}>2 – Exactly once</option>
                </select>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-sm">Retain</span>
                <input
                  type="checkbox"
                  className="toggle toggle-sm toggle-primary"
                  checked={retain}
                  onChange={(e) => setRetain(e.target.checked)}
                />
              </label>
            </div>
          </fieldset>
        </div>
        <div className="modal-action">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={brokerStatuses.length === 0}
            onClick={() =>
              onSave(
                { topic, placeholder, multiline, qos, retain },
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
  const [qos, setQos] = useState(config.qos ?? 0);
  const [retain, setRetain] = useState(config.retain ?? false);

  const effectiveTopic = overrideTopic ?? config.topic;
  const effectiveBrokerId = overrideBrokerId ?? brokerId;

  const handlePublish = async () => {
    if (!effectiveTopic) return;
    setLoading(true);
    try {
      await api.post("/api/publish", {
        broker_id: effectiveBrokerId,
        topic: effectiveTopic,
        payload: value,
        qos,
        retain,
      });
      setValue("");
      setFlash("success");
    } catch {
      setFlash("error");
    } finally {
      setLoading(false);
      setTimeout(() => setFlash(null), 1500);
    }
  };

  return (
    <div className="flex flex-col h-full gap-2 p-1">
      {config.multiline ? (
        <textarea
          className="textarea textarea-bordered font-mono flex-1 resize-none"
          placeholder={config.placeholder ?? "Enter payload…"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      ) : (
        <input
          className="input input-bordered w-full"
          placeholder={config.placeholder ?? "Enter payload…"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handlePublish()}
        />
      )}
      <MqttOptionsSection
        qos={qos}
        retain={retain}
        onQosChange={setQos}
        onRetainChange={setRetain}
      />
      <button
        className={`btn btn-sm ${flash === "success" ? "btn-success" : flash === "error" ? "btn-error" : "btn-primary"}`}
        onClick={handlePublish}
        disabled={loading || !effectiveTopic || !value}
      >
        {loading ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          "Publish"
        )}
      </button>
    </div>
  );
}
