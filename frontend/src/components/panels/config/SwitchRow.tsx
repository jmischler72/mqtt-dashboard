import ToggleSwitch from "./ToggleSwitch";

export interface SwitchRowProps {
  name: string;
  /** States what happens — and for an opt-in, what happens when it is off. */
  note: string;
  on: boolean;
  onToggle: (next: boolean) => void;
}

/** Name, one-line explanation, 32×18 switch. The only switch row shape. */
export default function SwitchRow({
  name,
  note,
  on,
  onToggle,
}: SwitchRowProps) {
  return (
    <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-base-300 dark:border-base-100 bg-base-100 min-w-0">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[11.5px]">{name}</span>
        <span className="text-[10.5px] leading-relaxed text-base-content/50">
          {note}
        </span>
      </div>
      <span className="ml-auto">
        <ToggleSwitch on={on} onToggle={onToggle} label={name} />
      </span>
    </div>
  );
}
