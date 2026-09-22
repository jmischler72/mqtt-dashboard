import type { ReactNode } from "react";
import {
  RiCloseLine as CloseIcon,
  RiSearchLine as SearchIcon,
  RiMessage3Line,
  RiHashtag,
} from "react-icons/ri";
import { useTopicMessages } from "../../../hooks/useTopicMessages";

export interface TopicFieldProps {
  value: string;
  onChange: (topic: string) => void;
  placeholder?: string;
  invalid?: boolean;
  /** Opens the Topic Explorer. Omitted when the modal has no picker wired up. */
  onExplore?: () => void;
  brokerId?: string;
  joined?: boolean;
}

/** A topic, always monospace, with the Explorer a square button away. */
export default function TopicField({
  value,
  onChange,
  placeholder,
  invalid,
  onExplore,
  brokerId,
  joined = false,
}: TopicFieldProps) {
  // Only worth drawing once there are several: a single topic is already
  // readable in the field, and a lone chip under it would just repeat it.
  const topics = value
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
  const separable = topics.length > 1;

  const remove = (index: number) =>
    onChange(topics.filter((_, at) => at !== index).join(", "));

  const {
    hasMessages,
    loading,
    lastSeen,
    totalCount,
    activeCount,
    byTopic,
  } = useTopicMessages(brokerId, value);

  let statusIcon: ReactNode = null;
  if (brokerId) {
    if (loading) {
      statusIcon = (
        <div
          className="tooltip tooltip-left shrink-0 flex items-center justify-center w-5"
          data-tip="Checking topic messages..."
        >
          <RiMessage3Line className="text-sm text-base-content/40 animate-pulse shrink-0" />
        </div>
      );
    } else if (topics.length > 1) {
      const isAll = activeCount === totalCount && totalCount > 0;
      const isSome = activeCount > 0;
      const iconColor = isAll
        ? "text-success"
        : isSome
          ? "text-warning"
          : "text-base-content/30";
      const tooltipMsg = isAll
        ? `All ${totalCount} topics have recorded messages`
        : isSome
          ? `${activeCount} of ${totalCount} topics have recorded messages`
          : `0 of ${totalCount} topics have recorded messages`;

      statusIcon = (
        <div
          className="tooltip tooltip-left shrink-0 flex items-center justify-center w-5"
          data-tip={tooltipMsg}
        >
          <RiMessage3Line className={`text-sm shrink-0 ${iconColor}`} />
        </div>
      );
    } else if (topics.length === 1) {
      const iconColor = hasMessages ? "text-success" : "text-base-content/30";
      const tooltipMsg = hasMessages
        ? `Messages found on this topic${lastSeen ? ` (last active ${lastSeen})` : ""}`
        : "No messages recorded on this topic yet";

      statusIcon = (
        <div
          className="tooltip tooltip-left shrink-0 flex items-center justify-center w-5"
          data-tip={tooltipMsg}
        >
          <RiMessage3Line className={`text-sm shrink-0 ${iconColor}`} />
        </div>
      );
    }
  }

  if (joined) {
    return (
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div
          className={`join-item flex-1 min-w-0 flex items-center gap-1.5 h-8 bg-base-100 border border-base-300 dark:border-base-100 border-l-0 px-2 ${
            invalid ? "border-warning" : ""
          }`}
        >
          <RiHashtag className="text-xs text-base-content/50 shrink-0" />
          <input
            className="input input-ghost input-xs p-0 h-full w-full font-mono text-xs focus:outline-none"
            aria-label="Topic"
            spellCheck={false}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {onExplore && (
            <button
              type="button"
              title="Browse topics in Explorer"
              onClick={onExplore}
              className="btn btn-ghost btn-xs btn-square shrink-0 text-base-content/60 hover:text-base-content"
            >
              <SearchIcon className="text-xs" />
            </button>
          )}
          {statusIcon}
        </div>

        {separable && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {topics.map((topic, index) => {
              const topicInfo = byTopic[topic];
              return (
                <span
                  key={`${index}-${topic}`}
                  className="inline-flex items-center gap-1.5 h-6 pl-2 pr-1 rounded-full border border-base-300 dark:border-base-100 bg-base-100 font-mono text-[11px] min-w-0"
                >
                  {brokerId && (
                    <RiMessage3Line
                      className={`text-xs shrink-0 ${
                        topicInfo?.hasMessages
                          ? "text-success"
                          : topicInfo
                            ? "text-base-content/30"
                            : "text-base-content/20 animate-pulse"
                      }`}
                      title={
                        topicInfo?.hasMessages
                          ? `Messages found (last active ${topicInfo.lastSeen || "recently"})`
                          : "No messages recorded on this topic yet"
                      }
                    />
                  )}
                  <span className="truncate max-w-[180px]">{topic}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${topic}`}
                    title={`Remove ${topic}`}
                    onClick={() => remove(index)}
                    className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-base-content/50 hover:text-error cursor-pointer"
                  >
                    <CloseIcon className="text-xs" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
      <div className="min-w-0 flex items-center gap-2">
        <input
          className={`input input-bordered flex-1 min-w-0 h-8 min-h-8 font-mono text-xs ${
            invalid ? "input-warning" : ""
          }`}
          aria-label="Topic"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {onExplore && (
          <button
            type="button"
            title="Browse topics in Explorer"
            onClick={onExplore}
            className="w-8 h-8 shrink-0 rounded border border-base-300 dark:border-base-100 bg-base-100 text-base-content/70 hover:text-base-content flex items-center justify-center cursor-pointer"
          >
            <SearchIcon className="text-sm" />
          </button>
        )}
        {statusIcon}
      </div>

      {separable && (
        <div className="flex flex-wrap gap-1.5">
          {topics.map((topic, index) => {
            const topicInfo = byTopic[topic];
            return (
              <span
                key={`${index}-${topic}`}
                className="inline-flex items-center gap-1.5 h-6 pl-2 pr-1 rounded-full border border-base-300 dark:border-base-100 bg-base-100 font-mono text-[11px] min-w-0"
              >
                {brokerId && (
                  <RiMessage3Line
                    className={`text-xs shrink-0 ${
                      topicInfo?.hasMessages
                        ? "text-success"
                        : topicInfo
                          ? "text-base-content/30"
                          : "text-base-content/20 animate-pulse"
                    }`}
                    title={
                      topicInfo?.hasMessages
                        ? `Messages found (last active ${topicInfo.lastSeen || "recently"})`
                        : "No messages recorded on this topic yet"
                    }
                  />
                )}
                <span className="truncate max-w-[180px]">{topic}</span>
                <button
                  type="button"
                  aria-label={`Remove ${topic}`}
                  title={`Remove ${topic}`}
                  onClick={() => remove(index)}
                  className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-base-content/50 hover:text-error cursor-pointer"
                >
                  <CloseIcon className="text-xs" />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
