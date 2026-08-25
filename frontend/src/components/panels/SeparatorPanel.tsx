import { useState } from "react";
import PanelModalFrame from "./PanelModalFrame";

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
    <PanelModalFrame
      title="Separator Configuration"
      onClose={onClose}
      onSave={() => onSave({ orientation }, "")}
      maxWidthClass="max-w-md"
    >
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
    </PanelModalFrame>
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
