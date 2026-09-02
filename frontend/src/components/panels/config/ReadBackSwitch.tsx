import type { ReactNode } from "react";
import ToggleSwitch from "./ToggleSwitch";

export interface ReadBackSwitchProps {
  on: boolean;
  onToggle: (next: boolean) => void;
  /** "A different topic reports the value" — what turning it on means. */
  title: string;
  /** What the panel does while it is off, so the default is never a mystery. */
  offExplanation: string;
  /** What it does once it is on. */
  onExplanation: string;
  invalid?: boolean;
  children?: ReactNode;
}

/**
 * The read half of a bidirectional panel, opt-in and collapsed to a single
 * switch until it is wanted. It is a peer of the write half — its own card in
 * its own group — never a broker card nested inside another broker card.
 */
export default function ReadBackSwitch({
  on,
  onToggle,
  title,
  offExplanation,
  onExplanation,
  invalid,
  children,
}: ReadBackSwitchProps) {
  return (
    <div
      className={`min-w-0 rounded-xl border bg-base-200 p-3 flex flex-col gap-2.5 ${
        invalid ? "border-warning" : "border-base-300 dark:border-base-100"
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[11px] font-semibold">{title}</span>
          <span className="text-[10.5px] leading-relaxed text-base-content/50">
            {on ? onExplanation : offExplanation}
          </span>
        </div>
        <span className="ml-auto">
          <ToggleSwitch on={on} onToggle={onToggle} label={title} />
        </span>
      </div>

      {on && children && (
        <div className="flex flex-col gap-2.5 pt-2.5 border-t border-base-300 dark:border-base-100 min-w-0">
          {children}
        </div>
      )}
    </div>
  );
}
