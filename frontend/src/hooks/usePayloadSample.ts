import { useEffect, useState } from "react";
import { api } from "../api/client";
import { suggestPaths } from "../components/panels/payloadShape";

export interface RecentMessage {
  payload: string;
  /** Relative age for display, e.g. "2s", "4m", "1d". */
  ago: string;
}

export interface PayloadSample {
  /** Raw payload of the most recent historic message, if any. */
  payload: string | null;
  /** Most recent messages, newest first — what the device actually sends. */
  recent: RecentMessage[];
  /** Dot paths present in the newest payload, likely candidates first. */
  suggestedPaths: string[];
  loading: boolean;
}

/** Compact relative age: 2s, 4m, 3h, 1d. */
function ago(timestamp: string): string {
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return "";

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/**
 * Fetch the latest message on a topic so a config modal can show what the
 * payload actually looks like and offer the paths inside it.
 *
 * Extracted from the gauge modal, which was the only panel doing this. Callers
 * pass the topic string as typed; only the first of a comma-separated list is
 * sampled, since a shape only makes sense for one topic.
 *
 * The result is stored tagged with the broker/topic it came from, so `loading`
 * and `payload` are derived rather than synchronised — state is only ever set
 * from the fetch callback, never synchronously inside the effect.
 */
export function usePayloadSample(
  brokerId: string,
  topic: string,
  limit = 3,
): PayloadSample {
  const [result, setResult] = useState<{
    source: string;
    recent: RecentMessage[];
  } | null>(null);

  const singleTopic = topic.split(",")[0]?.trim() ?? "";
  const source = `${brokerId}\u0000${singleTopic}`;
  const canSample = Boolean(brokerId && singleTopic);

  useEffect(() => {
    if (!canSample) return;

    let cancelled = false;

    api
      .getExplorerHistory(brokerId, singleTopic)
      .then((records) => {
        if (cancelled) return;

        const newest = records
          ? [...records]
              .sort(
                (a, b) =>
                  new Date(b.timestamp).getTime() -
                  new Date(a.timestamp).getTime(),
              )
              .slice(0, limit)
              .map((r) => ({ payload: r.payload, ago: ago(r.timestamp) }))
          : [];

        setResult({ source, recent: newest });
      })
      .catch(() => {
        if (!cancelled) setResult({ source, recent: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [brokerId, singleTopic, source, canSample, limit]);

  // Ignore a result belonging to a broker/topic the caller has since changed
  const fresh = result?.source === source ? result : null;
  const recent = fresh?.recent ?? [];
  const payload = recent[0]?.payload ?? null;

  return {
    payload,
    recent,
    suggestedPaths: payload ? suggestPaths(payload) : [],
    loading: canSample && fresh === null,
  };
}
