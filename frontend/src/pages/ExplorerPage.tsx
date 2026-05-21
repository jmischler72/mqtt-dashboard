import { useEffect, useId, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
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

const commonSysTopics = [
  "$SYS/broker/version",
  "$SYS/broker/uptime",
  "$SYS/broker/clients/connected",
  "$SYS/broker/messages/sent",
  "$SYS/broker/messages/received",
  "$SYS/broker/messages/sent/5m",
  "$SYS/broker/messages/received/5m",
  "$SYS/broker/heap/current",
  "$SYS/broker/heap/maximum",
];

export default function ExplorerPage() {
  const navigate = useNavigate();
  const brokerStatuses = useBrokerStatuses();

  const [pickerCtx, setPickerCtx] = useState<{
    brokerId: string;
    dashboardId: string;
    panelId: string;
    currentTopic: string;
  } | null>(() => {
    const raw = sessionStorage.getItem("topicPickerOutbound");
    if (!raw) return null;
    sessionStorage.removeItem("topicPickerOutbound");
    try {
      return JSON.parse(raw) as {
        brokerId: string;
        dashboardId: string;
        panelId: string;
        currentTopic: string;
      };
    } catch {
      return null;
    }
  });

  const [selectedBrokerId, setSelectedBrokerId] = useState<string>(pickerCtx?.brokerId ?? "");
  const [pickerSelectedTopic, setPickerSelectedTopic] = useState<string>(pickerCtx?.currentTopic ?? "");
  const [topics, setTopics] = useState<string[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [liveMessages, setLiveMessages] = useState<WSMessage[]>([]);
  const [showSysTopic, setShowSysTopic] = useState(false);
  const pickerInitializedRef = useRef(false);
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
    let cancelled = false;
    api
      .getExplorerTree(effectiveBrokerId)
      .then((result) => {
        if (cancelled) return;
        // Use functional update to preserve $SYS placeholder topics that may
        // have been injected by the showSysTopic effect.
        setTopics((prev) => {
          const sysFromPrev = prev.filter((t) => t.startsWith("$SYS/"));
          const merged = new Set([...result, ...sysFromPrev]);
          return Array.from(merged).sort();
        });
      })
      .catch((error) => {
        void error;
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveBrokerId]);

  // Load persisted Explorer preference from app settings.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ retention_period_hours: number; show_sys_topics: boolean }>(
        "/api/settings",
      )
      .then((s) => {
        if (cancelled) return;
        setShowSysTopic(Boolean(s.show_sys_topics));
      })
      .catch((error) => {
        void error;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleShowSysChange = async (checked: boolean) => {
    setShowSysTopic(checked);
    try {
      await api.patch("/api/settings", { show_sys_topics: checked });
    } catch (error) {
      void error;
      // Revert UI state if persistence fails.
      setShowSysTopic((prev) => !prev);
    }
  };

  // Derive displayed topics so this list always matches what should be visible.
  // When $SYS topics are hidden, filter them out here to keep counts and the tree
  // in sync. When enabled, merge $SYS placeholders so the branch is visible
  // immediately without waiting for the next broker publish.
  const displayedTopics = useMemo(() => {
    const visibleTopics = showSysTopic
      ? topics
      : topics.filter((topic) => !topic.startsWith("$SYS"));

    if (!showSysTopic || !effectiveBrokerId) return visibleTopics;

    const merged = new Set(visibleTopics);
    for (const t of commonSysTopics) merged.add(t);
    return Array.from(merged).sort();
  }, [topics, showSysTopic, effectiveBrokerId]);

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
      topics: ["#", showSysTopic ? "$SYS/#" : ""].filter(Boolean),
    });
  }, [effectiveBrokerId, panelId, subscribe, showSysTopic]);

  // If in picker mode and a current topic exists, auto-select it in the tree
  useEffect(() => {
    if (pickerCtx && pickerSelectedTopic && displayedTopics.includes(pickerSelectedTopic)) {
      if (!pickerInitializedRef.current) {
        pickerInitializedRef.current = true;
        setSelectedTopic(pickerSelectedTopic);
      }
    } else if (!pickerCtx) {
      // Reset ref when exiting picker mode
      pickerInitializedRef.current = false;
    }
  }, [pickerCtx, pickerSelectedTopic, displayedTopics]);

  const handleTopicSelect = (topic: string) => {
    setSelectedTopic(topic);
    if (pickerCtx) setPickerSelectedTopic(topic);
  };

  const handlePickerConfirm = () => {
    if (pickerCtx) {
      sessionStorage.setItem(
        "topicPickerReturn",
        JSON.stringify({
          panelId: pickerCtx.panelId,
          topic: pickerSelectedTopic,
          dashboardId: pickerCtx.dashboardId,
          brokerId: effectiveBrokerId,
        }),
      );
    }
    navigate("/dashboard");
  };

  const handlePickerCancel = () => {
    setPickerCtx(null);
  };

  const handlePickerDoubleClick = pickerCtx
    ? (topic: string) => {
      sessionStorage.setItem(
        "topicPickerReturn",
        JSON.stringify({
          panelId: pickerCtx.panelId,
          topic,
          dashboardId: pickerCtx.dashboardId,
          brokerId: effectiveBrokerId,
        }),
      );
      navigate("/dashboard");
    }
    : undefined;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* ── Picker Mode announcement bar ── */}
      {pickerCtx && (
        <div role="alert" className="alert rounded-none shrink-0 border-x-0 border-t-0 bg-info/10 border-b-2 border-info">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <span className="badge badge-info badge-sm font-semibold shrink-0">Picker Mode</span>
            {pickerSelectedTopic ? (
              <span className="font-mono text-sm truncate">Selected topic: <span className="text-accent">{pickerSelectedTopic}</span></span>
            ) : (
              <span className="text-sm opacity-60">Click a topic to select it, or double-click to confirm instantly</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button className="btn btn-sm btn-primary" onClick={handlePickerConfirm}>
              {pickerSelectedTopic ? "Confirm" : "Return to Panel"}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={handlePickerCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

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
          {displayedTopics.length} topics captured
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="label cursor-pointer gap-2 p-0">
            <div className="tooltip tooltip-left" data-tip="$SYS topics are stored in history and may use significant disk space">
              <span className="label-text text-xs">Show $SYS</span>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-xs toggle-primary"
              checked={showSysTopic}
              onChange={(e) => void handleShowSysChange(e.target.checked)}
            />
          </label>
        </div>
      </div>

      {/* ── Split layout ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Topic tree */}
        <aside className="w-72 shrink-0 border-r border-base-300 bg-base-100 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-base-300 text-xs font-semibold text-base-content/50 uppercase tracking-wider">
            Topics
          </div>
          <TopicTree
            topics={displayedTopics}
            liveMessages={liveMessages}
            selectedTopic={selectedTopic}
            onSelectTopic={handleTopicSelect}
            onDoubleClickTopic={handlePickerDoubleClick}
            showSysTopic={showSysTopic}
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
              <div className="text-xs font-mono text-base-content/50 px-1 flex items-center gap-1 flex-wrap">
                {selectedTopic.split('/').map((part, index, parts) => (
                  <div key={index} className="flex items-center gap-1">
                    <button
                      onClick={() => handleTopicSelect(parts.slice(0, index + 1).join('/'))}
                      className="text-accent hover:text-accent-focus cursor-pointer"
                    >
                      {part}
                    </button>
                    {index < parts.length - 1 && <span className="text-base-content/30">/</span>}
                  </div>
                ))}
              </div>
              <div className="flex-1 overflow-hidden min-h-0">
                <LogPanel
                  key={`${effectiveBrokerId}:${selectedTopic}`}
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
