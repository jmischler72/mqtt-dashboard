import { useState } from "react";
import type { ReactNode } from "react";
import { RiArrowRightSLine } from "react-icons/ri";

export interface DisclosureCardProps {
  title: string;
  /** The content in miniature, shown on the collapsed row and kept when open. */
  summary?: ReactNode;
  /** Collapsed by default only for things most users never touch. */
  defaultOpen?: boolean;
  invalid?: boolean;
  children: ReactNode;
}

/**
 * The only collapsible shape in the config modals: caret, name, right-aligned
 * summary. Everything that folds looks like this, so a user learns the gesture
 * once instead of meeting a new affordance in every panel.
 */
export default function DisclosureCard({
  title,
  summary,
  defaultOpen = false,
  invalid,
  children,
}: DisclosureCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [contentId] = useState(
    () => `disclosure-${Math.random().toString(36).slice(2, 9)}`,
  );

  return (
    <div
      className={`min-w-0 rounded-xl border bg-base-200 ${
        invalid ? "border-warning" : "border-base-300 dark:border-base-100"
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((o) => !o)}
        className="w-full min-w-0 flex items-center gap-[7px] px-3 py-[11px] text-left cursor-pointer"
      >
        <RiArrowRightSLine
          aria-hidden="true"
          className={`w-3.5 h-3.5 shrink-0 text-base-content/50 transition-transform duration-150 ${
            open ? "rotate-90" : ""
          }`}
        />
        <span className="text-[11px] font-semibold shrink-0">{title}</span>
        {!open && summary && (
          <span className="ml-auto min-w-0 max-w-[70%] flex items-center justify-end text-[11.5px] text-base-content/60 overflow-hidden">
            {summary}
          </span>
        )}
      </button>

      {open && (
        <div id={contentId} className="px-3 pb-3 flex flex-col gap-2.5">
          {children}
        </div>
      )}
    </div>
  );
}
