interface Props {
  on: boolean;
  onToggle: (next: boolean) => void;
  label: string;
}

/**
 * Standard DaisyUI semantic toggle switch used across config modals and option rows.
 */
export default function ToggleSwitch({ on, onToggle, label }: Props) {
  return (
    <input
      type="checkbox"
      role="switch"
      aria-checked={on}
      aria-label={label}
      checked={on}
      onChange={(e) => onToggle(e.target.checked)}
      className="toggle toggle-primary toggle-sm shrink-0 cursor-pointer"
    />
  );
}
