import type { ReactNode } from "react";
import type { BrokerStatus } from "../../../hooks/useBrokers";
import BrokerSelect from "./BrokerSelect";
import DisclosureCard from "./DisclosureCard";
import FieldRow from "./FieldRow";
import NoBrokersNotice from "./NoBrokersNotice";
import TopicField from "./TopicField";

export interface BrokerTopicCardProps {
  /** "Publishes to" / "Reads from" — what this end of the panel does. */
  title?: string;
  summary?: ReactNode;
  brokers: BrokerStatus[];
  brokerId: string;
  onBrokerChange: (brokerId: string) => void;
  topic: string;
  onTopicChange: (topic: string) => void;
  topicPlaceholder?: string;
  onExplore?: () => void;
  /** Set by the caller's validation; also decides the card's border. */
  topicError?: string;
  help?: ReactNode;
  /**
   * Renders the rows without the card around them, for the one place that is
   * already inside a card of its own: the opt-in read-back switch. Keeps the
   * fields identical there rather than growing a second broker/topic pair.
   */
  bare?: boolean;
  /** Extra rows belonging to the same destination, e.g. a schedule. */
  children?: ReactNode;
  /** Whether the card starts open. Defaults to true. */
  defaultOpen?: boolean;
}

const brokerDotColor: Record<string, string> = {
  CONNECTED: "bg-success",
  CONNECTING: "bg-warning animate-pulse",
  DISCONNECTED: "bg-error",
  ERROR: "bg-error",
  DISABLED: "bg-neutral",
};

/**
 * Where one half of a panel points: a broker and a topic, in one collapsible card.
 *
 * Used by the write half and the read half alike — the read side is a peer of
 * the write side, never a card nested inside it.
 */
export default function BrokerTopicCard({
  title = "Broker & Topic",
  summary,
  brokers,
  brokerId,
  onBrokerChange,
  topic,
  onTopicChange,
  topicPlaceholder,
  onExplore,
  topicError,
  help,
  bare,
  children,
  defaultOpen = true,
}: BrokerTopicCardProps) {
  const rows = (
    <>
      <FieldRow label="Broker">
        <BrokerSelect
          value={brokerId}
          onChange={onBrokerChange}
          brokers={brokers}
        />
      </FieldRow>

      <FieldRow
        label="Topic"
        invalid={Boolean(topicError)}
        help={topicError ?? help}
      >
        <TopicField
          value={topic}
          onChange={onTopicChange}
          placeholder={topicPlaceholder}
          invalid={Boolean(topicError)}
          onExplore={onExplore}
          brokerId={brokerId}
        />
      </FieldRow>

      {children}
    </>
  );

  const content = brokers.length === 0 ? <NoBrokersNotice /> : rows;

  if (bare) return <>{content}</>;

  const broker = brokers.find((b) => b.id === brokerId);
  const brokerName = broker?.name || brokerId;
  const brokerStatus = (broker?.status ?? "DISABLED").toUpperCase();
  const dotColor = brokerDotColor[brokerStatus] ?? "bg-neutral";

  const defaultSummary = topic.trim() ? (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] truncate max-w-full">
      {broker && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`}
        />
      )}
      <span className="truncate">
        {brokerName ? `${brokerName} : ` : ""}
        {topic}
      </span>
    </span>
  ) : (
    <span className="text-[11px] text-base-content/50 italic">
      No topic configured
    </span>
  );

  return (
    <DisclosureCard
      title={title}
      summary={summary ?? defaultSummary}
      defaultOpen={defaultOpen || Boolean(topicError)}
      invalid={Boolean(topicError)}
    >
      {content}
    </DisclosureCard>
  );
}

