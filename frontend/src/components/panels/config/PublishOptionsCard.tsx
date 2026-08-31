import DisclosureCard from "./DisclosureCard";
import FieldRow from "./FieldRow";
import SwitchRow from "./SwitchRow";

export interface PublishOptionsCardProps {
  qos: number;
  onQosChange: (qos: number) => void;
  retain: boolean;
  onRetainChange: (retain: boolean) => void;
  /** What the retained message is, in the panel's own words. */
  retainNote?: string;
}

/**
 * The two MQTT delivery settings, and only those — anything a panel decides for
 * itself belongs to the group that owns it, not to the wire. Collapsed by
 * default: most dashboards never change it, and the summary badge says what it
 * is set to without opening.
 */
export default function PublishOptionsCard({
  qos,
  onQosChange,
  retain,
  onRetainChange,
  retainNote = "Last message kept for new subscribers",
}: PublishOptionsCardProps) {
  const summary = `QoS ${qos} · ${retain ? "Retain ON" : "No retain"}`;

  return (
    <DisclosureCard
      title="Publish options"
      summary={
        <span className="inline-flex items-center h-[21px] px-2 rounded-full border border-base-300 dark:border-base-100 bg-base-100 font-mono text-[10px] text-base-content/70">
          {summary}
        </span>
      }
    >
      <FieldRow label="QoS (Quality of Service)">
        <select
          className="select select-bordered w-full min-w-0 h-[30px] min-h-[30px] text-xs"
          aria-label="Quality of service"
          value={qos}
          onChange={(e) => onQosChange(Number(e.target.value))}
        >
          <option value={0}>0 — At most once</option>
          <option value={1}>1 — At least once</option>
          <option value={2}>2 — Exactly once</option>
        </select>
      </FieldRow>

      <SwitchRow
        name="Retain on broker"
        note={retainNote}
        on={retain}
        onToggle={onRetainChange}
      />
    </DisclosureCard>
  );
}
