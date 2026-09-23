import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { RiArrowDownSLine, RiCheckLine, RiHistoryLine } from "react-icons/ri";
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

interface DropdownPos {
  top?: number;
  bottom?: number;
  right: number;
  maxHeight: number;
}

/**
 * Compact dropdown past typing bytes: pick from messages recently heard on broker.
 */
export default function MessageHistory({
  topic,
  messages,
  loading = false,
  actions,
  usedKey,
}: MessageHistoryProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<DropdownPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const single = actions.length === 1 ? actions[0] : null;

  const updatePos = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const availableHeight = openUp ? spaceAbove - 16 : spaceBelow - 16;

    setPos({
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
      right: Math.max(8, window.innerWidth - rect.right),
      maxHeight: Math.max(100, Math.min(208, availableHeight)),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) {
      updatePos();
    }
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;

    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      if (dropdownRef.current && dropdownRef.current.contains(target)) {
        return;
      }
      setOpen(false);
    };

    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [open]);

  if (messages.length === 0) {
    return null;
  }

  const tooltipText = `${messages.length} recent message${messages.length > 1 ? "s" : ""}${topic ? ` on ${topic}` : ""}`;

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        title={tooltipText}
        aria-expanded={open}
        aria-label={
          open
            ? "hide recent messages"
            : `show ${messages.length} recent messages`
        }
        onClick={() => {
          if (!open) updatePos();
          setOpen((o) => !o);
        }}
        className={`btn btn-xs btn-ghost border border-base-300 dark:border-base-100 font-mono gap-1 text-[11px] h-6 min-h-0 text-base-content/70 hover:text-base-content rounded-full cursor-pointer px-2 ${
          open ? "bg-base-200" : ""
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${loading ? "bg-warning animate-pulse" : "bg-success"}`}
        />
        <RiHistoryLine className="text-xs shrink-0" />
        <span className="text-[10px] font-semibold">{messages.length}</span>
        <RiArrowDownSLine
          className={`text-xs shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[9998]"
              onClick={() => setOpen(false)}
            />
            <div
              ref={dropdownRef}
              style={{
                top: pos?.top,
                bottom: pos?.bottom,
                right: pos?.right,
                maxHeight: pos?.maxHeight,
              }}
              className="fixed z-[9999] w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-base-300 dark:border-base-100 bg-base-100 shadow-2xl p-1 flex flex-col gap-0.5"
            >
              <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-base-content/40 border-b border-base-200 dark:border-base-200/50 mb-0.5">
                Recent Messages
              </div>
              {messages.map((message, index) => {
                const inUse = single && usedKey === `${index}:${single.key}`;
                return (
                  <button
                    key={index}
                    type="button"
                    title={message.payload}
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
                    <span
                      className="flex-1 min-w-0 truncate text-xs"
                      title={message.payload}
                    >
                      {message.payload}
                    </span>
                    {inUse && (
                      <RiCheckLine className="text-xs text-primary shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
