import { useState } from "react";
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
  /** One line under the list saying what taking a message does. */
  footnote: string;
}

const rowClass =
  "w-full flex items-start gap-2.5 px-2.5 py-2 text-left " +
  "border-t border-base-300 dark:border-base-100";

/**
 * "Start from a message this device sent" — the shortcut past guessing what a
 * device's payload looks like. Real bytes beat a remembered shape, so this sits
 * above the box it fills rather than being hidden behind a help link.
 */
export default function MessageHistory({
  topic,
  messages,
  loading,
  actions,
  usedKey,
  footnote,
}: MessageHistoryProps) {
  // Closed until asked for: it is a shortcut past typing the bytes, not the
  // first thing to read, and an open list pushes the box itself off the card.
  const [open, setOpen] = useState(false);

  // One action means the row itself is the button — there is nothing to choose
  // between, so a per-row label would only repeat what clicking already does.
  const single = actions.length === 1 ? actions[0] : null;

  if (loading && messages.length === 0) {
    return (
      <span className="text-[11px] text-base-content/50">
        Looking for messages…
      </span>
    );
  }

  if (messages.length === 0) {
    return (
      <span className="text-[11px] text-base-content/50">
        {topic.trim()
          ? `Nothing heard on ${topic.trim()} yet — type the bytes your device sends.`
          : "Pick a topic and the last few messages show up here."}
      </span>
    );
  }

  return (
    <div className="rounded-lg border border-base-300 dark:border-base-100 bg-base-100 overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-[7px] px-2.5 py-2 text-left cursor-pointer ${
          open ? "border-b border-base-300 dark:border-base-100" : ""
        }`}
      >
        <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-success" />
        <span className="text-[11px] font-semibold">
          {open
            ? "Messages this device sent"
            : "Start from a message this device sent"}
        </span>
        <span className="ml-auto text-[11px] font-medium text-primary">
          {open ? "hide" : `show ${messages.length}`}
        </span>
      </button>

      {open && (
        <div>
          {messages.map((message, index) => {
            const body = (
              <>
                <span className="shrink-0 w-8 pt-px text-[10.5px] font-medium text-base-content/60">
                  {message.ago}
                </span>
                <span className="flex-1 min-w-0 font-mono text-[11.5px] leading-relaxed break-all">
                  {message.payload}
                </span>
                <span className="shrink-0 flex items-center gap-2">
                  {single
                    ? usedKey === `${index}:${single.key}` && (
                        <span className="text-[10.5px] font-medium text-primary">
                          in use
                        </span>
                      )
                    : actions.map((action) => {
                        const inUse = usedKey === `${index}:${action.key}`;
                        return (
                          <button
                            key={action.key}
                            type="button"
                            onClick={() => action.onUse(message.payload, index)}
                            className={`text-[10.5px] font-medium cursor-pointer ${
                              inUse ? "text-primary" : "text-base-content/60"
                            }`}
                          >
                            {inUse ? "in use" : action.label}
                          </button>
                        );
                      })}
                </span>
              </>
            );

            return single ? (
              <button
                key={index}
                type="button"
                aria-label={`${single.label}: ${message.payload}`}
                onClick={() => single.onUse(message.payload, index)}
                className={`${rowClass} cursor-pointer hover:bg-base-200`}
              >
                {body}
              </button>
            ) : (
              <div key={index} className={rowClass}>
                {body}
              </div>
            );
          })}
          <div className="px-2.5 pt-1.5 pb-2 border-t border-base-300 dark:border-base-100 text-[11px] text-base-content/60">
            {footnote}
          </div>
        </div>
      )}
    </div>
  );
}
