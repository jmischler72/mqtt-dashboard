import type { BrokerPresence } from "./brokerPresence";

const COPY: Record<BrokerPresence, string> = {
  connected: "CONNECTED",
  disconnected: "DISCONNECTED",
  none: "NO BROKER",
};

/** Live broker state, in the header of every panel config modal. */
export default function BrokerStatusPill({
  presence,
}: {
  presence: BrokerPresence;
}) {
  const connected = presence === "connected";

  return (
    <span
      className={`ml-auto shrink-0 inline-flex items-center gap-1.5 h-[22px] px-2.5 rounded-full border border-base-300 dark:border-base-100 bg-base-200 text-[10.5px] font-medium ${
        connected ? "text-success" : "text-base-content/70"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          connected ? "bg-success" : "bg-base-content/40"
        }`}
      />
      {COPY[presence]}
    </span>
  );
}
