import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  MdSmartButton,
  MdInput,
  MdListAlt,
  MdSchedule,
  MdBarChart,
} from "react-icons/md";
import ReactGridLayout from "react-grid-layout";
import { useOutletContext } from "react-router-dom";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RGL = ReactGridLayout as any;
import { api } from "../api/client";
import PanelWrapper from "../components/PanelWrapper";
import type { BrokerStatus } from "../hooks/useBrokers";

type GridLayout = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
};

export interface Panel {
  id: string;
  title: string;
  panel_type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config_json: Record<string, unknown>;
  broker_id: string;
}

const PANEL_TYPES = [
  {
    value: "button",
    label: "Button",
    icon: MdSmartButton,
    preview: (
      <div className="flex items-center justify-center h-full py-4">
        <button className="btn btn-primary btn-lg pointer-events-none">
          Click
        </button>
      </div>
    ),
  },
  {
    value: "input",
    label: "Input",
    icon: MdInput,
    preview: (
      <div className="flex flex-col gap-2 p-1 h-full">
        <textarea
          className="textarea textarea-bordered font-mono flex-1 resize-none w-full text-xs pointer-events-none"
          placeholder="Enter payload…"
          readOnly
          value=""
        />
        <button className="btn btn-sm btn-primary pointer-events-none">
          Publish
        </button>
      </div>
    ),
  },
  {
    value: "log",
    label: "Log",
    icon: MdListAlt,
    preview: (
      <div className="flex flex-col h-full gap-1">
        <div className="flex gap-1 pb-1">
          <span className="btn btn-xs pointer-events-none">Clear</span>
          <span className="btn btn-xs pointer-events-none">Pause</span>
          <span className="text-xs text-base-content/50 ml-auto self-center">
            3 msgs
          </span>
        </div>
        <div className="flex-1 bg-neutral text-neutral-content rounded font-mono text-xs p-2 space-y-0.5">
          {[
            { topic: "sensor/temp", payload: "22.4" },
            { topic: "sensor/hum", payload: "61%" },
            { topic: "device/status", payload: "online" },
          ].map((m, i) => (
            <div key={i} className="leading-tight">
              <span className="text-neutral-content/70">[12:00:0{i}]</span>{" "}
              <span className="text-accent">{m.topic}</span>{" "}
              <span>{m.payload}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    value: "cron",
    label: "Cron",
    icon: MdSchedule,
    preview: (
      <div className="flex flex-col gap-3 p-1 h-full">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono bg-base-200 rounded px-2 py-1">
            every minute
          </span>
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm pointer-events-none"
            readOnly
            checked
          />
        </div>
        <div className="flex flex-col items-center justify-center gap-1 flex-1">
          <div className="text-xs text-base-content/50">Next run in</div>
          <div className="text-xl font-bold font-mono">00:42</div>
          <progress
            className="progress progress-primary w-full"
            value={30}
            max="100"
          />
        </div>
      </div>
    ),
  },
  {
    value: "stats",
    label: "Stats",
    icon: MdBarChart,
    preview: (
      <div className="flex flex-col gap-2 h-full">
        <div className="grid grid-cols-2 gap-1">
          {[
            { label: "Msg/s", value: "4.2" },
            { label: "Total", value: "1.2k" },
            { label: "Topics", value: "8" },
            { label: "Data in", value: "3.1k" },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-base-200 rounded p-1 text-center"
            >
              <div className="text-xs text-base-content/50">{s.label}</div>
              <div className="text-sm font-bold">{s.value}</div>
            </div>
          ))}
        </div>
        <svg viewBox="0 0 100 30" className="w-full opacity-60">
          <polyline
            points="0,28 20,20 40,22 60,10 80,14 100,6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-primary"
          />
        </svg>
      </div>
    ),
  },
];

const GRID_COLS = 12;
const GRID_ROW_HEIGHT = 60;
const GRID_ROW_GAP = 10;
const NEW_PANEL_W = 4;
const NEW_PANEL_H = 4;

type LayoutContext = {
  editMode: boolean;
  setEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  activeDashboardId: string;
  dashboardsLoading: boolean;
  brokerStatuses: BrokerStatus[];
};

export default function DashboardPage() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [isLoadingLayout, setIsLoadingLayout] = useState(true);
  const [gridWidth, setGridWidth] = useState(1200);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [newPanelId, setNewPanelId] = useState<string | null>(null);
  const [openConfigPanels, setOpenConfigPanels] = useState<Set<string>>(
    new Set(),
  );
  const [hasAnyModalOpen, setHasAnyModalOpen] = useState(false);
  const [pendingPickerReturn, setPendingPickerReturn] = useState<{
    panelId: string;
    topic: string;
    brokerId?: string;
    draftConfig?: Record<string, unknown>;
  } | null>(() => {
    const raw = sessionStorage.getItem("topicPickerReturn");
    if (!raw) return null;
    sessionStorage.removeItem("topicPickerReturn");
    try {
      const data = JSON.parse(raw) as {
        panelId: string;
        topic: string;
        dashboardId: string;
        brokerId?: string;
        draftConfig?: Record<string, unknown>;
      };
      return {
        panelId: data.panelId,
        topic: data.topic,
        brokerId: data.brokerId,
        draftConfig: data.draftConfig,
      };
    } catch {
      return null;
    }
  });
  const [hoveredPanelType, setHoveredPanelType] = useState<string | null>(null);
  const [previewPos, setPreviewPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const { editMode, activeDashboardId, dashboardsLoading, brokerStatuses } =
    useOutletContext<LayoutContext>();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        addMenuRef.current &&
        !addMenuRef.current.contains(e.target as Node)
      ) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const checkAnyModalOpen = () => {
      setHasAnyModalOpen(Boolean(document.querySelector(".modal.modal-open")));
    };

    checkAnyModalOpen();

    const observer = new MutationObserver(checkAnyModalOpen);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) =>
      setGridWidth(entry.contentRect.width),
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (dashboardsLoading || !activeDashboardId) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setIsLoadingLayout(true);
    });

    api
      .get<Panel[]>(`/api/layouts?dashboard_id=${activeDashboardId}`)
      .then((loadedPanels) => {
        if (!active) return;
        setPanels(loadedPanels);
      })
      .catch((error) => {
        void error;
      })
      .finally(() => {
        if (active) setIsLoadingLayout(false);
      });

    return () => {
      active = false;
    };
  }, [activeDashboardId, dashboardsLoading]);

  const gridInteractionsEnabled =
    editMode && openConfigPanels.size === 0 && !hasAnyModalOpen;

  const layout = panels.map((p) => ({
    i: p.id,
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
    minW: 2,
    minH: 2,
    static: !gridInteractionsEnabled,
  }));

  const handleLayoutChange = useCallback((newLayout: GridLayout[]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const patches = newLayout.map((l) => ({
        id: l.i,
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
      }));
      api.put("/api/layouts/batch", { panels: patches }).catch(() => {});
      setPanels((prev) =>
        prev.map((p) => {
          const l = newLayout.find((n) => n.i === p.id);
          return l ? { ...p, x: l.x, y: l.y, w: l.w, h: l.h } : p;
        }),
      );
    }, 300);
  }, []);

  const getClosestInsertPosition = useCallback(() => {
    const containerTop =
      (containerRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
    const viewportCenterY = window.scrollY + window.innerHeight / 2;
    const approxY = Math.max(
      0,
      Math.floor(
        (viewportCenterY - containerTop) / (GRID_ROW_HEIGHT + GRID_ROW_GAP),
      ),
    );

    const collides = (x: number, y: number) =>
      panels.some(
        (panel) =>
          x < panel.x + panel.w &&
          x + NEW_PANEL_W > panel.x &&
          y < panel.y + panel.h &&
          y + NEW_PANEL_H > panel.y,
      );

    const maxExistingY = panels.reduce(
      (max, panel) => Math.max(max, panel.y + panel.h),
      0,
    );
    const searchLimit = Math.max(
      approxY + NEW_PANEL_H,
      maxExistingY + NEW_PANEL_H,
    );

    for (let distance = 0; distance <= searchLimit; distance += 1) {
      const candidateYs =
        distance === 0
          ? [approxY]
          : [approxY - distance, approxY + distance].filter((y) => y >= 0);

      for (const y of candidateYs) {
        for (let x = 0; x <= GRID_COLS - NEW_PANEL_W; x += 1) {
          if (!collides(x, y)) {
            return { x, y };
          }
        }
      }
    }

    return { x: 0, y: maxExistingY };
  }, [panels]);

  const addPanel = async (panelType: string) => {
    if (isLoadingLayout || !activeDashboardId) return;
    setAddMenuOpen(false);
    const { x, y } = getClosestInsertPosition();
    try {
      const panel = await api.post<Panel>("/api/layouts", {
        dashboard_id: activeDashboardId,
        panel_type: panelType,
        x,
        y,
        title: `${PANEL_TYPES.find((t) => t.value === panelType)?.label ?? "New"} Panel`,
      });
      setPanels((prev) => [...prev, panel]);
      setNewPanelId(panel.id);
    } catch (error) {
      void error;
    }
  };

  const removePanel = (id: string) => {
    setPanels((prev) => prev.filter((p) => p.id !== id));
  };

  const updatePanel = (updated: Panel) => {
    setPanels((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleConfigModalChange = useCallback(
    (panelId: string, isOpen: boolean) => {
      setOpenConfigPanels((prev) => {
        const next = new Set(prev);
        if (isOpen) {
          next.add(panelId);
        } else {
          next.delete(panelId);
        }
        return next;
      });
    },
    [],
  );

  const handlePickerConsumed = useCallback(() => {
    setPendingPickerReturn(null);
  }, []);

  useEffect(() => {
    if (!newPanelId) return;
    // Defer scroll to let ReactGridLayout finish positioning the new item
    const scrollTimer = setTimeout(() => {
      const el = document.getElementById(`panel-${newPanelId}`);
      if (el) {
        // Scroll the RGL grid item wrapper (positioned ancestor) into view
        const target = el.closest(".react-grid-item") ?? el;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 150);
    const clearTimer = setTimeout(() => setNewPanelId(null), 2200);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [newPanelId]);

  return (
    <>
    <div className="min-h-screen bg-base-200">
      {editMode && (
        <div className="flex items-center gap-3 px-4 py-2 bg-base-100 border-b border-base-300 sticky top-0 z-10">
          <div className="relative" ref={addMenuRef}>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => setAddMenuOpen((o) => !o)}
              disabled={isLoadingLayout}
            >
              {isLoadingLayout ? "Loading layout..." : "+ Add Panel"}
            </button>
            {addMenuOpen && !isLoadingLayout && (
              <ul className="absolute top-full left-0 mt-1 bg-base-100 border border-base-300 rounded-box z-50 w-40 p-2 shadow">
                {PANEL_TYPES.map((t) => (
                  <li key={t.value}>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-base-200 rounded flex items-center gap-2"
                      onClick={() => addPanel(t.value)}
                      onMouseEnter={(e) => {
                        if (previewHideTimerRef.current)
                          clearTimeout(previewHideTimerRef.current);
                        const rect = (
                          e.currentTarget as HTMLElement
                        ).getBoundingClientRect();
                        const PREVIEW_W = 208;
                        const left = Math.min(
                          rect.right + 8,
                          window.innerWidth - PREVIEW_W - 8,
                        );
                        setPreviewPos({
                          top: rect.top,
                          left,
                        });
                        setHoveredPanelType(t.value);
                      }}
                      onMouseLeave={() => {
                        previewHideTimerRef.current = setTimeout(() => {
                          setHoveredPanelType(null);
                          setPreviewPos(null);
                        }, 150);
                      }}
                    >
                      <t.icon size={16} className="text-base-content/60 shrink-0" />
                      {t.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="p-4" ref={containerRef}>
        {dashboardsLoading || isLoadingLayout ? (
          <div className="flex items-center justify-center h-64 text-base-content/60">
            <div className="text-center">
              <span className="loading loading-spinner loading-lg mb-4" />
              <p className="text-xl">Loading dashboard layout...</p>
            </div>
          </div>
        ) : panels.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-base-content/40">
            <div className="text-center">
              <p className="text-2xl mb-2">No panels yet</p>
              <p>
                {editMode
                  ? 'Click "+ Add Panel" to get started'
                  : "Toggle Edit: ON in the navbar to add panels"}
              </p>
            </div>
          </div>
        ) : (
          <div className={hasAnyModalOpen ? "pointer-events-none" : ""}>
            <RGL
              width={gridWidth}
              layout={layout}
              cols={12}
              rowHeight={60}
              isDraggable={gridInteractionsEnabled}
              isResizable={gridInteractionsEnabled}
              onLayoutChange={handleLayoutChange}
              draggableHandle=".drag-handle"
              draggableCancel=".no-drag"
            >
              {panels.map((panel) => (
                <div key={panel.id} id={`panel-${panel.id}`}>
                  <PanelWrapper
                    panel={panel}
                    editMode={editMode}
                    brokerStatuses={brokerStatuses}
                    activeDashboardId={activeDashboardId}
                    highlight={panel.id === newPanelId}
                    pickerReturnTopic={
                      pendingPickerReturn?.panelId === panel.id
                        ? pendingPickerReturn.topic
                        : undefined
                    }
                    pickerReturnBrokerId={
                      pendingPickerReturn?.panelId === panel.id
                        ? pendingPickerReturn.brokerId
                        : undefined
                    }
                    pickerReturnDraftConfig={
                      pendingPickerReturn?.panelId === panel.id
                        ? pendingPickerReturn.draftConfig
                        : undefined
                    }
                    onDelete={() => removePanel(panel.id)}
                    onUpdate={updatePanel}
                    onConfigModalChange={handleConfigModalChange}
                    onPickerConsumed={handlePickerConsumed}
                  />
                </div>
              ))}
            </RGL>
          </div>
        )}
      </div>
    </div>
    {hoveredPanelType &&
      previewPos &&
      createPortal(
        <div
          className="fixed z-[100] rounded-box border border-base-300 bg-base-100 shadow-lg p-3 w-52 h-40 pointer-events-none"
          style={{ top: previewPos.top, left: previewPos.left }}
        >
          {PANEL_TYPES.find((t) => t.value === hoveredPanelType)?.preview}
        </div>,
        document.body,
      )}
    </>
  );
}
