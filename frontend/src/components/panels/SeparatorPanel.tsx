import { useState } from "react";

export interface SeparatorConfig {
  orientation?: "horizontal" | "vertical";
}

interface ModalProps {
  config: SeparatorConfig;
  onSave: (cfg: SeparatorConfig, brokerId: string) => void;
  onClose: () => void;
}

export function SeparatorConfigModal({ config, onSave, onClose }: ModalProps) {
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">(
    config.orientation ?? "horizontal",
  );

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-h-[85vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-4">Separator Configuration</h3>
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Orientation</legend>
          <div className="join">
            <button
              type="button"
              className={`btn join-item ${orientation === "horizontal" ? "btn-primary" : "btn-outline"}`}
              onClick={() => setOrientation("horizontal")}
            >
              Horizontal
            </button>
            <button
              type="button"
              className={`btn join-item ${orientation === "vertical" ? "btn-primary" : "btn-outline"}`}
              onClick={() => setOrientation("vertical")}
            >
              Vertical
            </button>
          </div>
        </fieldset>
        <div className="modal-action">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onSave({ orientation }, "")}
          >
            Save
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </dialog>
  );
}

interface SeparatorPanelProps {
  config: SeparatorConfig;
}

export default function SeparatorPanel({ config }: SeparatorPanelProps) {
  const orientation = config.orientation ?? "horizontal";

  return (
    <div className="flex items-center justify-center h-full w-full">
      {orientation === "horizontal" ? (
        <div className="w-full h-1 rounded-full bg-base-content/30" />
      ) : (
        <div className="h-full w-1 rounded-full bg-base-content/30" />
      )}
    </div>
  );
}
