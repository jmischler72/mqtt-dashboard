import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useWebSocket, mqttTopicMatches } from "./useWebSocket";

function formatAgo(timestamp: string): string {
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export interface TopicDetail {
  hasMessages: boolean;
  lastSeen?: string;
}

export interface TopicMessageStatus {
  hasMessages: boolean | null;
  loading: boolean;
  lastSeen?: string;
  totalCount: number;
  activeCount: number;
  byTopic: Record<string, TopicDetail>;
}

/**
 * Checks whether historic or live messages exist for one or more comma-separated topics.
 */
export function useTopicMessages(
  brokerId?: string,
  topic?: string,
): TopicMessageStatus {
  const topics = useMemo(
    () =>
      (topic ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [topic],
  );
  const currentKey = `${brokerId ?? ""}\u0000${topics.join(",")}`;

  const [state, setState] = useState<{
    key: string;
    hasMessages: boolean | null;
    loading: boolean;
    lastSeen?: string;
    totalCount: number;
    activeCount: number;
    byTopic: Record<string, TopicDetail>;
  }>({
    key: currentKey,
    hasMessages: null,
    loading: false,
    totalCount: 0,
    activeCount: 0,
    byTopic: {},
  });

  const [subId] = useState(
    () => `topic-preview-${Math.random().toString(36).slice(2, 9)}`,
  );

  // Live WebSocket listener
  const { subscribe } = useWebSocket({
    onMessage: (msgStr) => {
      try {
        const msg = JSON.parse(msgStr) as { topic: string };
        const matched = topics.find((t) => mqttTopicMatches(t, msg.topic));
        if (matched) {
          setState((prev) => {
            if (prev.key !== currentKey) return prev;
            const prevDetail = prev.byTopic[matched];
            if (
              prevDetail?.hasMessages &&
              prevDetail?.lastSeen === "just now"
            ) {
              return prev;
            }
            const nextByTopic = {
              ...prev.byTopic,
              [matched]: { hasMessages: true, lastSeen: "just now" },
            };
            const activeCount = Object.values(nextByTopic).filter(
              (d) => d.hasMessages,
            ).length;
            return {
              ...prev,
              byTopic: nextByTopic,
              activeCount,
              hasMessages: activeCount > 0,
              lastSeen: "just now",
            };
          });
        }
      } catch {
        // ignore malformed frame
      }
    },
  });

  useEffect(() => {
    if (!brokerId || topics.length === 0) {
      subscribe({
        action: "unsubscribe",
        panel_id: subId,
      });
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setState((prev) => ({
        ...prev,
        key: currentKey,
        loading: true,
        totalCount: topics.length,
      }));

      subscribe({
        panel_id: subId,
        broker_id: brokerId,
        topics,
      });

      Promise.all(
        topics.map((t) =>
          api
            .getExplorerHistory(brokerId, t)
            .then((records) => {
              const newestRecord =
                records && records.length > 0
                  ? records[records.length - 1]
                  : undefined;
              return {
                topic: t,
                hasMessages: Boolean(records && records.length > 0),
                rawTimestamp: newestRecord?.timestamp,
                lastSeen: newestRecord?.timestamp
                  ? formatAgo(newestRecord.timestamp) || undefined
                  : undefined,
              };
            })
            .catch(() => ({
              topic: t,
              hasMessages: false,
              rawTimestamp: undefined,
              lastSeen: undefined,
            })),
        ),
      ).then((results) => {
        if (cancelled) return;
        const byTopic: Record<string, TopicDetail> = {};
        let activeCount = 0;
        let newestTimestamp: string | undefined;
        let newestTime = -Infinity;
        let fallbackLastSeen: string | undefined;

        for (const res of results) {
          byTopic[res.topic] = {
            hasMessages: res.hasMessages,
            lastSeen: res.lastSeen,
          };
          if (res.hasMessages) {
            activeCount++;
            if (res.rawTimestamp) {
              const time = new Date(res.rawTimestamp).getTime();
              if (!Number.isNaN(time) && time > newestTime) {
                newestTime = time;
                newestTimestamp = res.rawTimestamp;
              }
            }
            if (!fallbackLastSeen && res.lastSeen) {
              fallbackLastSeen = res.lastSeen;
            }
          }
        }

        setState({
          key: currentKey,
          hasMessages: activeCount > 0,
          loading: false,
          lastSeen: newestTimestamp
            ? formatAgo(newestTimestamp) || undefined
            : fallbackLastSeen,
          totalCount: topics.length,
          activeCount,
          byTopic,
        });
      });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [brokerId, currentKey, topics, subId, subscribe]);

  if (!brokerId || topics.length === 0) {
    return {
      hasMessages: null,
      loading: false,
      totalCount: 0,
      activeCount: 0,
      byTopic: {},
    };
  }

  if (state.key !== currentKey) {
    return {
      hasMessages: null,
      loading: true,
      totalCount: topics.length,
      activeCount: 0,
      byTopic: {},
    };
  }

  return {
    hasMessages: state.hasMessages,
    loading: state.loading,
    lastSeen: state.lastSeen,
    totalCount: state.totalCount,
    activeCount: state.activeCount,
    byTopic: state.byTopic,
  };
}
