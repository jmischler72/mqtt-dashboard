import { useEffect, useId, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useBrokerStatuses } from "../hooks/useBrokers";
import { useWebSocket } from "../hooks/useWebSocket";
import TopicTree from "../components/explorer/TopicTree";
import LogPanel from "../components/panels/LogPanel";
import GraphPanel from "../components/panels/GraphPanel";
import ExplorerPublishPanel from "../components/explorer/ExplorerPublishPanel";
import { topicMatchesFilter } from "../components/explorer/topicFilterUtils";

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
    draftConfig?: Record<string, unknown>;
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
        draftConfig?: Record<string, unknown>;
      };
    } catch {
      return null;
    }
  });

  const [selectedBrokerId, setSelectedBrokerId] = useState<string>(
    pickerCtx?.brokerId ?? "",
  );
  const [pickerSelectedTopic, setPickerSelectedTopic] = useState<string>(
    pickerCtx?.currentTopic ?? "",
  );
  const [topics, setTopics] = useState<string[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(
    pickerCtx ? null : "#",
  );
  const [liveMessages, setLiveMessages] = useState<WSMessage[]>([]);
  const [showSysTopic, setShowSysTopic] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [graphWindowSeconds, setGraphWindowSeconds] = useState(900);
  const [showExactTopicOnly, setShowExactTopicOnly] = useState(false);
  const [defaultExpanded, setDefaultExpanded] = useState(false);
  const [expandCollapseVersion, setExpandCollapseVersion] = useState(0);
  const [filterText, setFilterText] = useState("");
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

  const filteredTopics = useMemo(() => {
    if (!filterText.trim()) return displayedTopics;
    return displayedTopics.filter((topic) =>
      topicMatchesFilter(topic, filterText),
    );
  }, [displayedTopics, filterText]);

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
    if (
      pickerCtx &&
      pickerSelectedTopic &&
      (displayedTopics.includes(pickerSelectedTopic) ||
        (pickerSelectedTopic.endsWith("/#") &&
          displayedTopics.some((t) =>
            t.startsWith(pickerSelectedTopic.slice(0, -1)),
          )))
    ) {
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
    const isParent =
      !topic.endsWith("/#") &&
      displayedTopics.some((t) => t.startsWith(topic + "/"));
    const effectiveTopic =
      !showExactTopicOnly && isParent ? topic + "/#" : topic;
    setSelectedTopic(effectiveTopic);
    if (pickerCtx) setPickerSelectedTopic(effectiveTopic);
  };

  const handleToggleExactTopicOnly = (checked: boolean) => {
    setShowExactTopicOnly(checked);
    if (!selectedTopic || selectedTopic === "#") return;

    if (checked) {
      if (selectedTopic.endsWith("/#")) {
        const stripped = selectedTopic.slice(0, -2);
        setSelectedTopic(stripped);
        if (pickerCtx) setPickerSelectedTopic(stripped);
      }
    } else {
      const baseTopic = selectedTopic.endsWith("/#")
        ? selectedTopic.slice(0, -2)
        : selectedTopic;
      const isParent = displayedTopics.some((t) =>
        t.startsWith(baseTopic + "/"),
      );
      if (isParent) {
        const subtreeTopic = `${baseTopic}/#`;
        setSelectedTopic(subtreeTopic);
        if (pickerCtx) setPickerSelectedTopic(subtreeTopic);
      }
    }
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
          draftConfig: pickerCtx.draftConfig,
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
            draftConfig: pickerCtx.draftConfig,
          }),
        );
        navigate("/dashboard");
      }
    : undefined;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* ── Picker Mode announcement bar ── */}
      {pickerCtx && (
        <div
          role="alert"
          className="alert rounded-none shrink-0 border-x-0 border-t-0 bg-info/10 border-b-2 border-info"
        >
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <span className="badge badge-info badge-sm font-semibold shrink-0">
              Picker Mode
            </span>
            {pickerSelectedTopic ? (
              <span className="font-mono text-sm truncate">
                Selected topic:{" "}
                <span className="text-accent">{pickerSelectedTopic}</span>
              </span>
            ) : (
              <span className="text-sm opacity-60">
                Click a topic to select it, or double-click to confirm instantly
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="btn btn-sm btn-primary"
              onClick={handlePickerConfirm}
            >
              {pickerSelectedTopic ? "Confirm" : "Return to Panel"}
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={handlePickerCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Header bar ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-base-300 bg-base-100 shrink-0">
        <span className="text-sm font-medium text-base-content/60">Broker</span>
        <select
          className="select select-bordered select-sm"
          value={effectiveBrokerId}
          onChange={(e) => {
            setSelectedBrokerId(e.target.value);
            setTopics([]);
            setSelectedTopic(pickerCtx ? null : "#");
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
          {filterText.trim()
            ? `${filteredTopics.length} of ${displayedTopics.length} topics`
            : `${displayedTopics.length} topics captured`}
        </span>
        {/* tooltip-start top-aligns these tips so they grow downward. Centred,
            a multi-line tip on this thin row reaches up into the sticky navbar
            (z-40 in Layout.tsx) and is painted over; raising the toggles above
            it instead would put them in front of the broker flyout. */}
        <div className="ml-auto flex items-center gap-4">
          <label className="label cursor-pointer gap-2 p-0">
            <div
              className="tooltip tooltip-left tooltip-start"
              data-tip="When enabled, clicking a parent topic only shows messages published directly to that exact topic instead of including all child topics (topic/#)."
            >
              <span className="label-text text-xs">Show exact topic only</span>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-xs toggle-secondary"
              checked={showExactTopicOnly}
              onChange={(e) => handleToggleExactTopicOnly(e.target.checked)}
            />
          </label>
          <label className="label cursor-pointer gap-2 p-0">
            <div
              className="tooltip tooltip-left tooltip-start"
              data-tip="Plot the selected topic over time. Bare numbers are charted directly; for JSON payloads the first numeric field is picked automatically. Messages with nothing numeric in them are skipped."
            >
              <span className="label-text text-xs">Show graph</span>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-xs toggle-accent"
              checked={showGraph}
              onChange={(e) => setShowGraph(e.target.checked)}
            />
          </label>
          <label className="label cursor-pointer gap-2 p-0">
            <div
              className="tooltip tooltip-left tooltip-start"
              data-tip="Show $SYS broker system topics in the tree. If you have not enabled 'Save $SYS topics in history' in settings, these topics will only be visible here when they are published by the broker, and will not be saved to history."
            >
              <span className="label-text text-xs">Show $SYS</span>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-xs toggle-primary"
              checked={showSysTopic}
              onChange={(e) => setShowSysTopic(e.target.checked)}
            />
          </label>
        </div>
      </div>

      {/* ── Split layout ── */}
      <div className="flex flex-col sm:flex-row flex-1 overflow-hidden">
        {/* Topic tree */}
        <aside className="w-full sm:w-72 shrink-0 max-h-64 sm:max-h-none border-b sm:border-b-0 sm:border-r border-base-300 bg-base-100 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-base-300 flex items-center justify-between gap-2 shrink-0">
            <span className="text-xs font-semibold text-base-content/50 uppercase tracking-wider">
              Topics
            </span>
            <div className="flex items-center gap-1">
              <button
                className="btn btn-xs btn-ghost"
                onClick={() => {
                  setDefaultExpanded(true);
                  setExpandCollapseVersion((v) => v + 1);
                }}
              >
                Expand all
              </button>
              <button
                className="btn btn-xs btn-ghost"
                onClick={() => {
                  setDefaultExpanded(false);
                  setExpandCollapseVersion((v) => v + 1);
                }}
              >
                Collapse all
              </button>
            </div>
          </div>

          {/* Topic search / filter input */}
          <div className="p-2 border-b border-base-300 shrink-0">
            <div className="relative flex items-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5 absolute left-2.5 text-base-content/40 pointer-events-none"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setFilterText("");
                  }
                }}
                placeholder="Filter topics..."
                className="input input-sm input-bordered w-full pl-8 pr-7 text-xs font-mono"
              />
              {filterText && (
                <button
                  type="button"
                  onClick={() => setFilterText("")}
                  className="btn btn-ghost btn-xs btn-circle absolute right-1 h-5 w-5 min-h-0 text-base-content/50 hover:text-base-content"
                  title="Clear filter (Esc)"
                  aria-label="Clear filter"
                >
                  ✕
                </button>
              )}
            </div>
            {filterText && (
              <div className="mt-1 px-1 text-[11px] text-base-content/50">
                {filteredTopics.length} of {displayedTopics.length} matched
              </div>
            )}
          </div>

          <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
            <TopicTree
              topics={filteredTopics}
              allTopicsCount={displayedTopics.length}
              filterText={filterText}
              onClearFilter={() => setFilterText("")}
              liveMessages={liveMessages}
              selectedTopic={selectedTopic}
              onSelectTopic={handleTopicSelect}
              onDoubleClickTopic={handlePickerDoubleClick}
              showSysTopic={showSysTopic}
              defaultExpanded={defaultExpanded}
              expandCollapseVersion={expandCollapseVersion}
            />
          </div>
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
                {selectedTopic.split("/").map((part, index, parts) => (
                  <div key={index} className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        handleTopicSelect(parts.slice(0, index + 1).join("/"))
                      }
                      className="text-accent hover:text-accent-focus cursor-pointer"
                    >
                      {part}
                    </button>
                    {index < parts.length - 1 && (
                      <span className="text-base-content/30">/</span>
                    )}
                  </div>
                ))}
              </div>
              {showGraph && (
                <section className="shrink-0 rounded-lg border border-base-300 bg-base-100">
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-base-300">
                    <span className="text-xs font-semibold text-base-content/50 uppercase tracking-wider">
                      Graph
                    </span>
                    <select
                      className="select select-bordered select-xs ml-auto"
                      value={graphWindowSeconds}
                      onChange={(e) =>
                        setGraphWindowSeconds(Number(e.target.value))
                      }
                    >
                      <option value={300}>Last 5 minutes</option>
                      <option value={900}>Last 15 minutes</option>
                      <option value={3600}>Last hour</option>
                      <option value={21600}>Last 6 hours</option>
                      <option value={86400}>Last 24 hours</option>
                      <option value={0}>All history</option>
                    </select>
                  </div>
                  <div className="h-48 p-2">
                    <GraphPanel
                      key={`graph:${effectiveBrokerId}:${selectedTopic}:${graphWindowSeconds}`}
                      panelId={`${panelId}-graph`}
                      brokerId={effectiveBrokerId}
                      compact
                      autoValue
                      config={{
                        topics: selectedTopic,
                        maxPoints: 500,
                        timeWindowSeconds: graphWindowSeconds,
                        curve: "linear",
                        showArea: true,
                        showLegend: true,
                      }}
                    />
                  </div>
                </section>
              )}
              <div className="flex-1 overflow-hidden min-h-0">
                <LogPanel
                  key={`${effectiveBrokerId}:${selectedTopic}`}
                  panelId={panelId}
                  brokerId={effectiveBrokerId}
                  config={{
                    topics: selectedTopic,
                    maxMessages: 500,
                    dateFormat: "full",
                    showQos: true,
                    showRetained: true,
                  }}
                />
              </div>
              <div className="shrink-0">
                <ExplorerPublishPanel
                  brokerId={effectiveBrokerId}
                  selectedTopic={selectedTopic}
                />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
