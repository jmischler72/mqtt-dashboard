interface Props {
  on: boolean;
  onToggle: (next: boolean) => void;
  label: string;
}

/**
 * The 32×18 switch every opt-in row in a config modal uses. Drawn rather than
 * borrowed from DaisyUI's `toggle` so its proportions match the rest of the
 * modal's 11px scale, and so the one shape reads the same in a publish option
 * and in the read-back row.
 */
export default function ToggleSwitch({ on, onToggle, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onToggle(!on)}
      className={`relative shrink-0 w-8 h-[18px] rounded-full border transition-colors cursor-pointer ${
        on
          ? "bg-primary border-primary"
          : "bg-base-300 border-base-300 dark:border-base-100"
      }`}
    >
      <span
        className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
          on ? "left-[18px] bg-primary-content" : "left-0.5 bg-base-content/60"
        }`}
      />
    </button>
  );
}
