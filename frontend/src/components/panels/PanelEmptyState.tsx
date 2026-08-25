import type { ComponentType } from "react";
import { RiSettings3Line } from "react-icons/ri";

interface Props {
  message: string;
  actionLabel?: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  onConfigure?: () => void;
  editMode?: boolean;
}

export default function PanelEmptyState({
  message,
  actionLabel = "Configure Panel",
  icon: Icon,
  onConfigure,
  editMode,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-4 text-center gap-2 select-none">
      {Icon && <Icon size={24} className="text-base-content/30 mb-1" />}
      <p className="text-xs text-base-content/50 leading-relaxed max-w-xs">
        {message}
      </p>
      {editMode && onConfigure && (
        <button
          type="button"
          onClick={onConfigure}
          className="btn btn-xs btn-outline btn-primary gap-1 mt-1 no-drag"
        >
          <RiSettings3Line size={12} />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
