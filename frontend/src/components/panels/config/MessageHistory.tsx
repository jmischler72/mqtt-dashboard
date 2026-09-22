import { useState } from "react";
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiHistoryLine,
} from "react-icons/ri";
import type { RecentMessage } from "../../../hooks/usePayloadSample";

export interface HistoryAction {
  /** Identifies which row is "in use"; also the button's label. */
  key: string;
  /** Shown per row only when there are several actions to pick between. */
  label: string;
  onUse: (payload: string, index: number) => void;
}

export interface MessageHistoryProps {
  /** Named in the empty state, so the user knows what was listened to. */
  topic: string;
  messages: RecentMessage[];
  loading?: boolean;
  actions: HistoryAction[];
  /** `${index}:${action.key}` of the row last taken, or null. */
  usedKey?: string | null;
}

/**
 * Compact dropdown past typing bytes: pick from messages recently heard on broker.
 */
export default function MessageHistory({
  topic: _topic,
  messages,
  loading: _loading,
  actions,
  usedKey,
}: MessageHistoryProps) {
  const [open, setOpen] = useState(false);
  const single = actions.length === 1 ? actions[0] : null;

  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="relative inline-block">
      <div
        className="tooltip tooltip-bottom"
        data-tip={`${messages.length} recent message${messages.length > 1 ? "s" : ""}`}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "hide recent messages" : `show ${messages.length} recent messages`}
          onClick={() => setOpen((o) => !o)}
          className={`btn btn-xs btn-ghost border border-base-300 dark:border-base-100 font-mono gap-1 text-[11px] h-6 min-h-0 text-base-content/70 hover:text-base-content rounded-full cursor-pointer px-2 ${
            open ? "bg-base-200" : ""
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
          <RiHistoryLine className="text-xs shrink-0" />
          <span className="text-[10px] font-semibold">{messages.length}</span>
          <RiArrowDownSLine
            className={`text-xs shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {open && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-30 w-72 max-h-52 overflow-auto rounded-lg border border-base-300 dark:border-base-100 bg-base-100 shadow-xl p-1 flex flex-col gap-0.5">
            <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-base-content/40 border-b border-base-200 dark:border-base-200/50 mb-0.5">
              Recent Messages
            </div>
            {messages.map((message, index) => {
              const inUse = single && usedKey === `${index}:${single.key}`;
              return (
                <button
                  key={index}
                  type="button"
                  aria-label={`${single ? single.label : "use"}: ${message.payload}`}
                  onClick={() => {
                    single?.onUse(message.payload, index);
                    setOpen(false);
                  }}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-base-200 text-left font-mono text-[11px] cursor-pointer transition-colors ${
                    inUse ? "bg-primary/10 text-primary" : ""
                  }`}
                >
                  <span className="shrink-0 text-[10px] text-base-content/40">
                    {message.ago}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-xs">
                    {message.payload}
                  </span>
                  {inUse && (
                    <RiCheckLine className="text-xs text-primary shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
