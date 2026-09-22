import type { BrokerStatus } from "../../../hooks/useBrokers";

export interface BrokerSelectProps {
  value: string;
  onChange: (brokerId: string) => void;
  brokers: BrokerStatus[];
}

const brokerDotColor: Record<string, string> = {
  CONNECTED: "bg-success",
  CONNECTING: "bg-warning animate-pulse",
  DISCONNECTED: "bg-error",
  ERROR: "bg-error",
  DISABLED: "bg-neutral",
};

/**
 * Which broker this half of the panel talks to, with live connection status dot.
 */
export default function BrokerSelect({
  value,
  onChange,
  brokers,
}: BrokerSelectProps) {
  const selected = brokers.find((b) => b.id === value) ?? brokers[0];
  const status = selected?.status ?? "DISABLED";
  const dotColor = brokerDotColor[status] ?? "bg-neutral";
  const statusLabel =
    status === "CONNECTED"
      ? "Connected"
      : status === "CONNECTING"
        ? "Connecting"
        : status === "DISABLED"
          ? "Disabled"
          : "Disconnected";

  return (
    <div className="flex items-center gap-2 w-full min-w-0">
      <select
        className="select select-bordered flex-1 min-w-0 h-8 min-h-8 text-xs"
        aria-label="Broker"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {brokers.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
            {b.status !== "CONNECTED"
              ? ` (${b.status.toLowerCase()})`
              : ""}
          </option>
        ))}
      </select>
      <div
        className="tooltip tooltip-left shrink-0 flex items-center justify-center w-5"
        data-tip={
          selected
            ? `${selected.name}: ${statusLabel}`
            : "No broker selected"
        }
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`}
          aria-label={statusLabel}
        />
      </div>
    </div>
  );
}

