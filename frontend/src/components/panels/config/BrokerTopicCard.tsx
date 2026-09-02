import type { ReactNode } from "react";
import type { BrokerStatus } from "../../../hooks/useBrokers";
import BrokerSelect from "./BrokerSelect";
import ConfigCard from "./ConfigCard";
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
}

/**
 * Where one half of a panel points: a broker and a topic, in one card.
 *
 * Used by the write half and the read half alike — the read side is a peer of
 * the write side, never a card nested inside it.
 */
export default function BrokerTopicCard({
  title,
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
        />
      </FieldRow>

      {children}
    </>
  );

  const content = brokers.length === 0 ? <NoBrokersNotice /> : rows;

  if (bare) return <>{content}</>;

  return (
    <ConfigCard title={title} summary={summary}>
      {content}
    </ConfigCard>
  );
}
