import type { ReactNode } from "react";

export interface ConfigCardProps {
  /** 11px bold row above the fields. Omitted for a card that needs no name. */
  title?: string;
  /** Right-aligned miniature of the card's content, e.g. `0 – 255 · step 5`. */
  summary?: ReactNode;
  /** Turns the border warning-coloured when the card holds the broken field. */
  invalid?: boolean;
  children: ReactNode;
}

/**
 * The one box shape in a config modal. Cards never nest inside cards of the
 * same weight — a section that would need one is a peer group instead.
 *
 * A card carries no outer spacing: the stack it sits in owns the gaps, so the
 * last card in a group leaves no margin dangling under it.
 */
export default function ConfigCard({
  title,
  summary,
  invalid,
  children,
}: ConfigCardProps) {
  return (
    <div
      className={`min-w-0 rounded-xl border bg-base-200 p-3 flex flex-col gap-2.5 ${
        invalid ? "border-warning" : "border-base-300 dark:border-base-100"
      }`}
    >
      {(title || summary) && (
        <div className="flex items-center gap-2 min-w-0">
          {title && (
            <span className="text-[11px] font-semibold tracking-[0.02em] shrink-0">
              {title}
            </span>
          )}
          {summary && (
            <span className="ml-auto min-w-0 text-[10.5px] text-base-content/50 truncate">
              {summary}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
