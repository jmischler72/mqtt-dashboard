import { useState } from "react";

export interface SeparatorConfig {
  orientation?: "horizontal" | "vertical";
  thickness?: number;
  color?: string;
}

const DEFAULT_COLOR = "#9ca3af";
const DEFAULT_THICKNESS = 2;

interface ModalProps {
  config: SeparatorConfig;
  onSave: (cfg: SeparatorConfig, brokerId: string) => void;
  onClose: () => void;
}

export function SeparatorConfigModal({ config, onSave, onClose }: ModalProps) {
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">(
    config.orientation ?? "horizontal",
  );
  const [thickness, setThickness] = useState(
    config.thickness ?? DEFAULT_THICKNESS,
  );
  const [color, setColor] = useState(config.color ?? DEFAULT_COLOR);

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-h-[85vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-4">Separator Configuration</h3>
        <div className="flex flex-col gap-3">
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
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Thickness (px)</legend>
            <input
              type="number"
              min={1}
              max={64}
              className="input input-bordered w-full"
              value={thickness}
              onChange={(e) =>
                setThickness(Math.max(1, Number(e.target.value) || 1))
              }
            />
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Color</legend>
            <input
              type="color"
              className="input input-bordered h-10 w-full p-1"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </fieldset>
        </div>
        <div className="modal-action">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onSave({ orientation, thickness, color }, "")}
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
  const thickness = config.thickness ?? DEFAULT_THICKNESS;
  const color = config.color ?? DEFAULT_COLOR;

  return (
    <div className="flex items-center justify-center h-full w-full">
      {orientation === "horizontal" ? (
        <div
          className="w-full rounded-full"
          style={{ height: thickness, backgroundColor: color }}
        />
      ) : (
        <div
          className="h-full rounded-full"
          style={{ width: thickness, backgroundColor: color }}
        />
      )}
    </div>
  );
}
