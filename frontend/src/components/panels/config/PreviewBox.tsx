import type { ReactNode } from "react";

export interface PreviewBoxProps {
  /** Right-aligned aside, e.g. "Move the handle." */
  note?: string;
  /** Shown instead of the children when there is nothing to preview yet. */
  problem?: string | null;
  children?: ReactNode;
}

/**
 * The framed block that shows what the configuration actually does — bytes out,
 * or the value read in. Mismatch and empty states live inside the frame, so a
 * shape that does not fit never leaves loose warnings under the field.
 */
export default function PreviewBox({
  note,
  problem,
  children,
}: PreviewBoxProps) {
  return (
    <div className="rounded-lg border border-base-300 dark:border-base-100 bg-base-100 p-2.5 flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="text-[11px] text-base-content/50">
          ◉
        </span>
        <span className="text-[10.5px] font-semibold">Preview</span>
        {note && (
          <span className="ml-auto text-[10.5px] text-base-content/50 truncate">
            {note}
          </span>
        )}
      </div>
      {problem ? (
        <span className="text-[11px] leading-relaxed text-warning">
          {problem}
        </span>
      ) : (
        children
      )}
    </div>
  );
}
