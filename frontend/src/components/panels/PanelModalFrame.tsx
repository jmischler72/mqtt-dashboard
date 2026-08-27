import type { ComponentType, ReactNode } from "react";
import { useEffect } from "react";

export interface PanelModalFrameProps {
  title: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  onClose: () => void;
  onSave?: () => void;
  saveDisabled?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  headerAction?: ReactNode;
  children: ReactNode;
  maxWidthClass?: string;
}

export default function PanelModalFrame({
  title,
  icon: Icon,
  onClose,
  onSave,
  saveDisabled = false,
  saveLabel = "Save",
  cancelLabel = "Cancel",
  headerAction,
  children,
  maxWidthClass,
}: PanelModalFrameProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <dialog open className="modal modal-open">
      <div
        className={`modal-box max-h-[85vh] overflow-y-auto ${maxWidthClass ?? ""}`}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {Icon && <Icon size={20} className="text-primary" />}
            <h3 className="font-bold text-lg">{title}</h3>
          </div>
          {headerAction}
        </div>

        <div className="space-y-4">{children}</div>

        <div className="modal-action">
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {cancelLabel}
          </button>
          {onSave && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={saveDisabled}
              onClick={onSave}
            >
              {saveLabel}
            </button>
          )}
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </dialog>
  );
}
