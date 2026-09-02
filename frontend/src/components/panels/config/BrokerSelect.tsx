import type { BrokerStatus } from "../../../hooks/useBrokers";

export interface BrokerSelectProps {
  value: string;
  onChange: (brokerId: string) => void;
  brokers: BrokerStatus[];
}

/**
 * Which broker this half of the panel talks to. The live connection state is
 * not repeated here — the header pill already carries it, and two dots saying
 * the same thing is how the old modals grew their clutter.
 */
export default function BrokerSelect({
  value,
  onChange,
  brokers,
}: BrokerSelectProps) {
  return (
    <select
      className="select select-bordered w-full min-w-0 h-8 min-h-8 text-xs"
      aria-label="Broker"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {brokers.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}
