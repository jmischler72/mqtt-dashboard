import type { ComponentType, ReactNode } from "react";
import { useEffect } from "react";
import BrokerStatusPill from "./BrokerStatusPill";
import type { BrokerPresence } from "./brokerPresence";

export interface PanelConfigModalProps {
  icon?: ComponentType<{ size?: number; className?: string }>;
  title: string;
  brokerStatus?: BrokerPresence;
  /**
   * The single most important reason Save is off, already phrased as a
   * sentence. Its presence is what disables Save — the footer line and the
   * button can therefore never disagree.
   */
  blockerReason?: string | null;
  onCancel: () => void;
  onSave: () => void;
  children: ReactNode;
}

/**
 * The shell every panel config modal wears: a fixed header carrying the panel's
 * own icon and the live broker state, a scrolling body, and a footer that never
 * scrolls away — so a Save that cannot be pressed always says why without the
 * user hunting for the field that broke.
 */
export default function PanelConfigModal({
  icon: Icon,
  title,
  brokerStatus,
  blockerReason,
  onCancel,
  onSave,
  children,
}: PanelConfigModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const blocked = Boolean(blockerReason);

  return (
    <dialog open className="modal modal-open">
      {/* Wider than daisyUI's 32rem so a shape and its preview fit on one
          line; the 91.67% width it keeps underneath means a phone is
          unaffected — the cap only bites once there is room for it. */}
      <div className="modal-box p-0 max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex-none flex items-center gap-2.5 px-[18px] pt-[15px] pb-[13px] border-b border-base-300 dark:border-base-100">
          <span className="w-6 h-6 shrink-0 rounded-md bg-primary/10 text-primary flex items-center justify-center">
            {Icon && <Icon size={13} />}
          </span>
          <h3 className="font-bold text-[15px] leading-tight truncate">
            {title}
          </h3>
          {brokerStatus && <BrokerStatusPill presence={brokerStatus} />}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-[20px] pt-3.5 pb-4">
          {children}
        </div>

        <div className="flex-none flex items-center gap-2.5 px-[18px] py-2.5 border-t border-base-300 dark:border-base-100 bg-base-100">
          <span className="flex-1 min-w-0 text-[11px] leading-snug text-warning">
            {blockerReason}
          </span>
          <button
            type="button"
            className="btn btn-sm h-8 min-h-8 font-medium"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary h-8 min-h-8"
            disabled={blocked}
            onClick={onSave}
          >
            Save
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onCancel} />
    </dialog>
  );
}
