import { useMemo } from "react";
import {
  RiSearchLine as SearchIcon,
  RiServerLine as ServerIcon,
  RiHashtag as TopicIcon,
  RiCloseLine as CloseIcon,
} from "react-icons/ri";
import type { BrokerStatus } from "../../hooks/useBrokers";

export interface BrokerTopicSectionProps {
  selectedBrokerId: string;
  onBrokerChange: (brokerId: string) => void;
  brokerStatuses: BrokerStatus[];
  topic: string;
  onTopicChange: (topic: string) => void;
  onPickTopic?: () => void;
  topicLabel?: string;
  placeholder?: string;
  helpText?: string;
  hideTopic?: boolean;
}

export default function BrokerTopicSection({
  selectedBrokerId,
  onBrokerChange,
  brokerStatuses,
  topic,
  onTopicChange,
  onPickTopic,
  topicLabel = "Topic",
  placeholder = "e.g. sensors/+, home/#",
  helpText = "Separate multiple topics with commas. Supports wildcards: + (single level) and # (multi-level), e.g. sensors/+/temp, home/#.",
  hideTopic = false,
}: BrokerTopicSectionProps) {
  // Parse comma-separated topics for visual badge preview
  const parsedTopics = useMemo(() => {
    if (!topic) return [];
    return topic
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }, [topic]);

  const removeTopicBadge = (topicToRemove: string) => {
    const next = parsedTopics.filter((t) => t !== topicToRemove).join(", ");
    onTopicChange(next);
  };

  return (
    <div className="border border-base-300 bg-base-200/40 rounded-xl p-3.5 flex flex-col gap-3.5">
      {/* Broker Selector */}
      <fieldset className="fieldset p-0 border-0">
        <legend className="fieldset-legend flex items-center gap-1.5 font-medium text-xs text-base-content/80 mb-1.5">
          <ServerIcon className="text-primary text-sm" />
          <span>Broker</span>
        </legend>

        {brokerStatuses.length === 0 ? (
          <div role="alert" className="alert alert-warning py-2 text-xs">
            <span>
              No brokers configured.{" "}
              <a href="/config" className="underline font-semibold">
                Add one in Config
              </a>
            </span>
          </div>
        ) : (
          <select
            className="select select-bordered select-sm w-full font-medium"
            value={selectedBrokerId}
            onChange={(e) => onBrokerChange(e.target.value)}
          >
            {brokerStatuses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </fieldset>

      {/* Topic Input & Parsed Badges */}
      {!hideTopic && (
        <fieldset className="fieldset p-0 border-0">
          <div className="flex items-center justify-between mb-1.5">
            <legend className="fieldset-legend flex items-center gap-1.5 font-medium text-xs text-base-content/80">
              <TopicIcon className="text-secondary text-sm" />
              <span>{topicLabel}</span>
            </legend>
            {parsedTopics.length > 1 && (
              <span className="badge badge-sm badge-secondary badge-soft font-mono text-[10px]">
                {parsedTopics.length} topics
              </span>
            )}
          </div>

          <div className="flex gap-1.5 w-full items-start">
            <div className="flex-1 min-w-0">
              <input
                className="input input-bordered input-sm w-full font-mono text-xs"
                placeholder={placeholder}
                value={topic}
                onChange={(e) => onTopicChange(e.target.value)}
              />
            </div>
            {onPickTopic && (
              <button
                type="button"
                className="btn btn-sm btn-square border border-base-300 bg-base-100 hover:bg-base-200 text-base-content/70 hover:text-base-content transition-colors shrink-0 shadow-2xs"
                title="Browse topics in Explorer"
                onClick={onPickTopic}
              >
                <SearchIcon className="text-base" />
              </button>
            )}
          </div>

          {/* Parsed Topic Badges */}
          {parsedTopics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {parsedTopics.map((t, idx) => (
                <span
                  key={`${t}-${idx}`}
                  className="badge badge-sm bg-base-100 border border-base-300 text-base-content font-mono text-[11px] gap-1 py-2 px-2 shadow-xs group"
                >
                  <span className="text-secondary opacity-70">#</span>
                  <span className="truncate max-w-48">{t}</span>
                  <button
                    type="button"
                    className="hover:text-error transition-colors ml-0.5"
                    title="Remove topic"
                    onClick={() => removeTopicBadge(t)}
                  >
                    <CloseIcon className="text-xs" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Helper hint text */}
          <p className="text-[11px] text-base-content/60 mt-1.5 leading-normal">
            {helpText}
          </p>
        </fieldset>
      )}
    </div>
  );
}
