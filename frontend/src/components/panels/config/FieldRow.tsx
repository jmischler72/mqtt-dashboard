import type { ReactNode } from "react";

export interface FieldRowProps {
  /**
   * The left-hand column, 46px wide so short labels line up down the card. A
   * longer one keeps its own line and takes the width it needs off the
   * control, which shrinks — labels never wrap.
   */
  label?: string;
  /** Sits under the control, indented to the control's left edge. */
  help?: ReactNode;
  /** Draws `help` in the warning colour and is what a bad border pairs with. */
  invalid?: boolean;
  children: ReactNode;
}

/** Label, control, and the one line of help that belongs to the control. */
export default function FieldRow({
  label,
  help,
  invalid,
  children,
}: FieldRowProps) {
  return (
    <div className="min-w-0 flex flex-col gap-1.5">
      <div className="min-w-0 flex items-center gap-2">
        {label && (
          <span className="min-w-[46px] shrink-0 whitespace-nowrap text-[11.5px] text-base-content/70">
            {label}
          </span>
        )}
        <div className="flex-1 min-w-0 flex items-center gap-2">{children}</div>
      </div>
      {help && (
        <span
          className={`text-[11px] leading-relaxed ${label ? "pl-[54px]" : ""} ${
            invalid ? "text-warning" : "text-base-content/50"
          }`}
        >
          {help}
        </span>
      )}
    </div>
  );
}
