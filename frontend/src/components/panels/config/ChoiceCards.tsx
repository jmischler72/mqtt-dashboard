import type { ReactNode } from "react";

export interface Choice<T extends string> {
  id: T;
  label: string;
  /** Drawn with the panel's real configured values — the picker is the preview. */
  preview: ReactNode;
  disabled?: boolean;
  /** Why it is unavailable, e.g. "needs a number". */
  disabledNote?: string;
}

export interface ChoiceCardsProps<T extends string> {
  options: Choice<T>[];
  /** The stored pick, kept even while it cannot be drawn. */
  value: T;
  /** What is actually drawn — the fallback when the stored pick is impossible. */
  effective?: T;
  onChange: (next: T) => void;
}

/**
 * A visual choice made visually: each option draws itself with the panel's real
 * values, so the picker doubles as the preview and no `<option>` has to carry a
 * sentence of prose.
 *
 * The stored pick and the drawn one are separate on purpose. A style that needs
 * a number is dimmed while the payload is text, but the user's choice is kept
 * and comes back the moment it is possible again.
 */
export default function ChoiceCards<T extends string>({
  options,
  value,
  effective,
  onChange,
}: ChoiceCardsProps<T>) {
  const drawn = effective ?? value;

  return (
    <div className="flex gap-2 min-w-0">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={option.disabled}
          onClick={() => onChange(option.id)}
          className={`flex-1 min-w-0 rounded-[10px] border p-2.5 flex flex-col items-center gap-2 ${
            // The stored pick keeps its ring even while it cannot be drawn, so
            // a temporary fallback never looks like the user's choice was lost.
            value === option.id
              ? "border-primary"
              : "border-base-300 dark:border-base-100"
          } ${drawn === option.id ? "bg-primary/10" : "bg-base-100"} ${
            option.disabled ? "opacity-45 cursor-not-allowed" : "cursor-pointer"
          }`}
        >
          <div className="w-full h-[54px] flex items-center justify-center overflow-hidden">
            {option.preview}
          </div>
          <span className="text-[10.5px] font-semibold">{option.label}</span>
          <span className="text-[9.5px] text-center text-base-content/50">
            {option.disabled
              ? (option.disabledNote ?? "")
              : value === option.id
                ? "selected"
                : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
