import { useState } from "react";
import { MdHorizontalRule } from "react-icons/md";
import {
  ChoiceCards,
  ConfigCard,
  ConfigGroup,
  PanelConfigModal,
} from "./config";

export type SeparatorOrientation = "horizontal" | "vertical";

export interface SeparatorConfig {
  orientation?: SeparatorOrientation;
}

interface ModalProps {
  config: SeparatorConfig;
  onSave: (cfg: SeparatorConfig, brokerId: string) => void;
  onClose: () => void;
}

export function SeparatorConfigModal({ config, onSave, onClose }: ModalProps) {
  const [orientation, setOrientation] = useState<SeparatorOrientation>(
    config.orientation ?? "horizontal",
  );

  return (
    <PanelConfigModal
      icon={MdHorizontalRule}
      title="Separator Configuration"
      onCancel={onClose}
      onSave={() => onSave({ orientation }, "")}
    >
      <ConfigGroup heading="Appearance">
        <ConfigCard title="Orientation">
          {/* The choice is entirely visual, so the picker draws it rather than
              naming it in a select. */}
          <ChoiceCards<SeparatorOrientation>
            value={orientation}
            onChange={setOrientation}
            options={[
              {
                id: "horizontal",
                label: "Horizontal",
                preview: (
                  <div className="w-full h-1 rounded-full bg-base-content/30" />
                ),
              },
              {
                id: "vertical",
                label: "Vertical",
                preview: (
                  <div className="h-[54px] w-1 rounded-full bg-base-content/30" />
                ),
              },
            ]}
          />
        </ConfigCard>
      </ConfigGroup>
    </PanelConfigModal>
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
