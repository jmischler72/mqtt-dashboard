import { useMemo } from "react";
import {
  RiSearchLine as SearchIcon,
  RiServerLine as ServerIcon,
  RiHashtag as TopicIcon,
  RiCloseLine as CloseIcon,
  RiErrorWarningLine as WarningIcon,
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
  allowWildcards?: boolean;
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
  placeholder,
  allowWildcards = false,
  helpText,
  hideTopic = false,
}: BrokerTopicSectionProps) {
  const effectivePlaceholder =
    placeholder ??
    (allowWildcards
      ? "e.g. sensors/+, home/#"
      : "e.g. home/living/light, home/kitchen/light");

  const effectiveHelpText =
    helpText ??
    (allowWildcards
      ? "Separate multiple topics with commas. Supports wildcards: + (single level) and # (multi-level), e.g. sensors/+/temp, home/#."
      : "Separate multiple topics with commas.");

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

  const hasWildcardWarning = useMemo(() => {
    if (allowWildcards || !topic) return false;
    return parsedTopics.some((t) => t.includes("+") || t.includes("#"));
  }, [allowWildcards, topic, parsedTopics]);

  const selectedBroker = brokerStatuses.find((b) => b.id === selectedBrokerId);
  const isBrokerConnected = selectedBroker?.status === "CONNECTED";

  return (
    <div className="border border-base-300 bg-base-200/40 rounded-xl p-3.5 flex flex-col gap-3.5">
      {/* Broker Selector */}
      <fieldset className="fieldset p-0 border-0">
        <div className="flex items-center justify-between mb-1.5">
          <legend className="fieldset-legend flex items-center gap-1.5 font-medium text-xs text-base-content/80">
            <ServerIcon className="text-primary text-sm" />
            <span>Broker</span>
          </legend>
          {selectedBroker && (
            <span
              className={`badge badge-xs gap-1 font-mono text-[10px] ${
                isBrokerConnected
                  ? "badge-success badge-outline"
                  : "badge-ghost opacity-60"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isBrokerConnected ? "bg-success" : "bg-base-content/40"
                }`}
              />
              {selectedBroker.status || "DISCONNECTED"}
            </span>
          )}
        </div>

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
                className={`input input-bordered input-sm w-full font-mono text-xs ${
                  hasWildcardWarning || !topic?.trim() ? "input-warning" : ""
                }`}
                placeholder={effectivePlaceholder}
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

          {/* Missing Topic Warning Alert */}
          {!topic?.trim() && (
            <div
              role="alert"
              className="alert alert-warning py-1.5 px-3 text-xs mt-2 font-medium flex items-center gap-2"
            >
              <WarningIcon className="text-sm shrink-0" />
              <span>
                No topic configured. Panel will not receive or publish messages until a topic is set.
              </span>
            </div>
          )}

          {/* Parsed Topic Badges */}
          {parsedTopics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {parsedTopics.map((t, idx) => {
                const isInvalidWildcard =
                  !allowWildcards && (t.includes("+") || t.includes("#"));

                return (
                  <span
                    key={`${t}-${idx}`}
                    className={`badge badge-sm font-mono text-[11px] gap-1 py-2 px-2 shadow-xs group ${
                      isInvalidWildcard
                        ? "bg-warning/15 border border-warning/50 text-warning-content font-semibold"
                        : "bg-base-100 border border-base-300 text-base-content"
                    }`}
                  >
                    {isInvalidWildcard ? (
                      <WarningIcon className="text-warning text-xs shrink-0" />
                    ) : (
                      <span className="text-secondary opacity-70">#</span>
                    )}
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
                );
              })}
            </div>
          )}

          {/* Wildcard Warning Alert */}
          {hasWildcardWarning && (
            <div
              role="alert"
              className="alert alert-warning py-1.5 px-3 text-xs mt-2 font-medium flex items-center gap-2"
            >
              <WarningIcon className="text-sm shrink-0" />
              <span>
                Wildcards (<strong>+</strong> or <strong>#</strong>) are not supported when publishing. Please use exact topic names.
              </span>
            </div>
          )}

          {/* Helper hint text */}
          <p className="text-[11px] text-base-content/60 mt-1.5 leading-normal">
            {effectiveHelpText}
          </p>
        </fieldset>
      )}
    </div>
  );
}
