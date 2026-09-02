import type { ReactNode } from "react";

export type GroupHeading = "Publish" | "Read" | "Appearance";

/**
 * One of the three headings a config modal is allowed to use, with the rule
 * that fills the rest of the line. Grouping is by consequence, not by widget:
 * anything deciding the bytes on the wire is Publish, anything the panel only
 * draws with is Appearance.
 */
export default function ConfigGroup({
  heading,
  children,
}: {
  heading: GroupHeading;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 pt-[17px] first:pt-0">
      <div className="flex items-center gap-2 px-0.5 pb-[11px]">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.11em] text-base-content/50">
          {heading}
        </span>
        <span className="flex-1 h-px bg-base-300 dark:bg-base-100" />
      </div>
      <div className="min-w-0 flex flex-col gap-2.5">{children}</div>
    </section>
  );
}
