import { useState } from "react";
import { RiSearchLine } from "react-icons/ri";
import { api } from "../../api/client";
import type { BrokerStatus } from "../../hooks/useBrokers";

export interface ButtonConfig {
  label?: string;
  topic?: string;
  payload?: string;
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
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || defaultBrokerId,
  );

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-h-[85vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-4">Button Configuration</h3>
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
            <legend className="fieldset-legend">Button Label</legend>
            <input
              className="input input-bordered w-full"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Topic</legend>
            <div className="flex gap-1 w-full">
              <input
                className="input input-bordered flex-1"
                placeholder="home/light/switch"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
              {onPickTopic && (
                <button
                  type="button"
                  className="btn btn-outline"
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
            <legend className="fieldset-legend">Payload</legend>
            <textarea
              className="textarea textarea-bordered w-full font-mono"
              rows={3}
              placeholder='{"action": "on"}'
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
            />
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
                { label, topic, payload },
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

interface ButtonPanelProps {
  panelId: string;
  brokerId: string;
  config: ButtonConfig;
}

export default function ButtonPanel({ brokerId, config }: ButtonPanelProps) {
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<"success" | "error" | null>(null);

  const handleClick = async () => {
    if (!config.topic) return;
    setLoading(true);
    try {
      await api.post("/api/publish", {
        broker_id: brokerId,
        topic: config.topic,
        payload: config.payload ?? "",
      });
      setFlash("success");
    } catch {
      setFlash("error");
    } finally {
      setLoading(false);
      setTimeout(() => setFlash(null), 1500);
    }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <button
        className={`btn btn-lg ${flash === "success" ? "btn-success" : flash === "error" ? "btn-error" : "btn-primary"}`}
        onClick={handleClick}
        disabled={loading || !config.topic}
      >
        {loading ? (
          <span className="loading loading-spinner" />
        ) : (
          (config.label ?? "Click")
        )}
      </button>
    </div>
  );
}
