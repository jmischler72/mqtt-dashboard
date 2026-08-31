import {
  RiCloseLine as CloseIcon,
  RiSearchLine as SearchIcon,
} from "react-icons/ri";

export interface TopicFieldProps {
  value: string;
  onChange: (topic: string) => void;
  placeholder?: string;
  invalid?: boolean;
  /** Opens the Topic Explorer. Omitted when the modal has no picker wired up. */
  onExplore?: () => void;
}

/** A topic, always monospace, with the Explorer a square button away. */
export default function TopicField({
  value,
  onChange,
  placeholder,
  invalid,
  onExplore,
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
      </div>

      {separable && (
        <div className="flex flex-wrap gap-1.5">
          {topics.map((topic, index) => (
            <span
              key={`${index}-${topic}`}
              className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full border border-base-300 dark:border-base-100 bg-base-100 font-mono text-[11px] min-w-0"
            >
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
          ))}
        </div>
      )}
    </div>
  );
}
