import { RiServerLine } from "react-icons/ri";
import type { BrokerStatus } from "../../../hooks/useBrokers";

export interface BrokerSelectProps {
  value: string;
  onChange: (brokerId: string) => void;
  brokers: BrokerStatus[];
  joined?: boolean;
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
  joined = false,
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

  if (joined) {
    return (
      <div className="join-item flex items-center gap-1.5 h-8 bg-base-100 border border-base-300 dark:border-base-100 pl-2 pr-2 w-48 sm:w-56 shrink-0">
        <RiServerLine className="text-xs text-base-content/50 shrink-0" />
        <select
          className="select select-ghost select-xs py-0 pl-1 pr-6 h-full flex-1 min-w-0 font-medium text-xs focus:outline-none cursor-pointer truncate"
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
          className="tooltip tooltip-bottom shrink-0 flex items-center justify-center"
          data-tip={
            selected
              ? `${selected.name}: ${statusLabel}`
              : "No broker selected"
          }
        >
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`}
            aria-label={statusLabel}
          />
        </div>
      </div>
    );
  }

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

