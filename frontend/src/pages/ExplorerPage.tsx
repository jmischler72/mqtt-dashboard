import { useEffect, useId, useMemo, useState } from "react";
import { api } from "../api/client";
import { useBrokerStatuses } from "../hooks/useBrokers";
import { useWebSocket } from "../hooks/useWebSocket";
import TopicTree from "../components/explorer/TopicTree";
import LogPanel from "../components/panels/LogPanel";
import InputPanel from "../components/panels/InputPanel";

interface WSMessage {
  topic: string;
  payload: string;
}

export default function ExplorerPage() {
  const brokerStatuses = useBrokerStatuses();
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>("");
  const [topics, setTopics] = useState<string[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [liveMessages, setLiveMessages] = useState<WSMessage[]>([]);
  const panelId = useId();
  const autoSelectedBrokerId = useMemo(() => {
    const firstConnected = brokerStatuses.find(
      (b) => b.is_enabled && b.status === "CONNECTED",
    );
    if (firstConnected) return firstConnected.id;
    const firstEnabled = brokerStatuses.find((b) => b.is_enabled);
    if (firstEnabled) return firstEnabled.id;
    return brokerStatuses[0]?.id ?? "";
  }, [brokerStatuses]);
  const effectiveBrokerId = selectedBrokerId || autoSelectedBrokerId;

  // Load topic tree when broker changes
  useEffect(() => {
    if (!effectiveBrokerId) return;
    api
      .getExplorerTree(effectiveBrokerId)
      .then(setTopics)
      .catch((error) => {
        void error;
      });
  }, [effectiveBrokerId]);

  // Subscribe to # on selected broker via WebSocket
  const { subscribe } = useWebSocket({
    onMessage: (data) => {
      try {
        const msg = JSON.parse(data) as WSMessage;
        if (!msg.topic) return;
        setLiveMessages((prev) => [...prev.slice(-499), msg]);
        // Add new topics to tree as they arrive
        setTopics((prev) => {
          if (prev.includes(msg.topic)) return prev;
          return [...prev, msg.topic].sort();
        });
      } catch (error) {
        void error;
      }
    },
  });

  useEffect(() => {
    if (!effectiveBrokerId) return;
    subscribe({
      panel_id: panelId,
      broker_id: effectiveBrokerId,
      topics: ["#"],
    });
  }, [effectiveBrokerId, panelId, subscribe]);

  const handleTopicSelect = (topic: string) => {
    setSelectedTopic(topic);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* ── Header bar ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-base-300 bg-base-100 shrink-0">
        <span className="text-sm font-medium text-base-content/60">Broker</span>
        <select
          className="select select-bordered select-sm"
          value={effectiveBrokerId}
          onChange={(e) => {
            setSelectedBrokerId(e.target.value);
            setTopics([]);
            setSelectedTopic(null);
            setLiveMessages([]);
          }}
        >
          {brokerStatuses.length === 0 && (
            <option value="">No brokers configured</option>
          )}
          {brokerStatuses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-base-content/40">
          {topics.length} topics captured
        </span>
      </div>

      {/* ── Split layout ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Topic tree */}
        <aside className="w-72 shrink-0 border-r border-base-300 bg-base-100 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-base-300 text-xs font-semibold text-base-content/50 uppercase tracking-wider">
            Topics
          </div>
          <TopicTree
            topics={topics}
            liveMessages={liveMessages}
            selectedTopic={selectedTopic}
            onSelectTopic={handleTopicSelect}
          />
        </aside>

        {/* Detail panel */}
        <main className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
          {!selectedTopic ? (
            <div className="flex items-center justify-center h-full text-base-content/40 text-sm">
              Select a topic from the tree to inspect its messages
            </div>
          ) : (
            <>
              <div className="text-xs font-mono text-base-content/50 px-1">
                <span className="text-accent">{selectedTopic}</span>
              </div>
              <div className="flex-1 overflow-hidden min-h-0">
                <LogPanel
                  panelId={panelId}
                  brokerId={effectiveBrokerId}
                  config={{
                    topics: selectedTopic,
                    maxMessages: 500,
                    dateFormat: "time",
                  }}
                />
              </div>
              <div className="shrink-0">
                <InputPanel
                  brokerId={effectiveBrokerId}
                  config={{}}
                  overrideTopic={selectedTopic}
                  overrideBrokerId={effectiveBrokerId}
                />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
