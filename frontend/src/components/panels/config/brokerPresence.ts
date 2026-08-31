import type { BrokerStatus } from "../../../hooks/useBrokers";

export type BrokerPresence = "connected" | "disconnected" | "none";

/**
 * What the header pill says about the broker the panel is pointed at.
 *
 * "none" is not the same as "disconnected": it means the dashboard has no
 * brokers at all, which is the one thing the user has to leave the modal to
 * fix, so it is worded as its own state rather than as a connection failure.
 */
export function brokerPresence(
  brokers: BrokerStatus[],
  brokerId: string,
): BrokerPresence {
  if (brokers.length === 0) return "none";
  const broker = brokers.find((b) => b.id === brokerId);
  return broker?.status === "CONNECTED" ? "connected" : "disconnected";
}

/** The broker a modal should start on when it has not been told which. */
export function defaultBrokerId(brokers: BrokerStatus[]): string {
  return brokers.find((b) => b.is_enabled)?.id ?? brokers[0]?.id ?? "";
}
