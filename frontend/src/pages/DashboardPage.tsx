import { useState, useEffect, useCallback, useRef } from "react";
import ReactGridLayout from "react-grid-layout";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { MdAdd } from "react-icons/md";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RGL = ReactGridLayout as any;
import { api } from "../api/client";
import PanelWrapper from "../components/PanelWrapper";
import PanelLibraryModal from "../components/PanelLibraryModal";
import { getPanelDefinition } from "../components/panels";
import type { BrokerStatus } from "../hooks/useBrokers";
import { useIsMobile } from "../hooks/useIsMobile";
import type { Dashboard } from "../components/DashboardSelector";

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

const GRID_COLS = 12;
const GRID_ROW_HEIGHT = 60;
const GRID_ROW_GAP = 10;
const NEW_PANEL_W = 4;
const NEW_PANEL_H = 3;
// Uniform height for every non-separator panel in the mobile stacked layout.
const MOBILE_PANEL_HEIGHT =
  NEW_PANEL_H * GRID_ROW_HEIGHT + (NEW_PANEL_H - 1) * GRID_ROW_GAP;

type LayoutContext = {
  editMode: boolean;
  setEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  activeDashboardId: string;
  dashboardsLoading: boolean;
  hasDashboards: boolean;
  brokerStatuses: BrokerStatus[];
  panelLibraryOpen: boolean;
  setPanelLibraryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  dashboards: Dashboard[];
  switchDashboard: (id: string) => void;
};

export default function DashboardPage() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [isLoadingLayout, setIsLoadingLayout] = useState(true);
  const [gridWidth, setGridWidth] = useState(1200);
  const [highlightedPanelId, setHighlightedPanelId] = useState<string | null>(
    null,
  );
  const pendingHighlightRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openConfigPanels, setOpenConfigPanels] = useState<Set<string>>(
    new Set(),
  );
  const [hasAnyModalOpen, setHasAnyModalOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    editMode,
    activeDashboardId,
    dashboardsLoading,
    hasDashboards,
    brokerStatuses,
    panelLibraryOpen,
    setPanelLibraryOpen,
    dashboards,
    switchDashboard,
  } = useOutletContext<LayoutContext>();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const checkAnyModalOpen = () => {
      const isOpen = Boolean(
        document.querySelector(".modal.modal-open, dialog.modal[open]"),
      );
      setHasAnyModalOpen((prev) => (prev === isOpen ? prev : isOpen));
    };

    checkAnyModalOpen();

    const observer = new MutationObserver(checkAnyModalOpen);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "open"],
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

  const layout = panels.map((p) => {
    let minW = 2,
      minH = 2;
    let maxW: number | undefined, maxH: number | undefined;
    const def = getPanelDefinition(p.panel_type);
    if (def?.getMinMaxConstraints) {
      const constraints = def.getMinMaxConstraints(p.config_json);
      if (constraints.minW !== undefined) minW = constraints.minW;
      if (constraints.minH !== undefined) minH = constraints.minH;
      if (constraints.maxW !== undefined) maxW = constraints.maxW;
      if (constraints.maxH !== undefined) maxH = constraints.maxH;
    }
    return {
      i: p.id,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      minW,
      minH,
      maxW,
      maxH,
      static: !gridInteractionsEnabled,
    };
  });

  const handleLayoutChange = useCallback(
    (newLayout: GridLayout[]) => {
      if (!gridInteractionsEnabled) return;
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
    },
    [gridInteractionsEnabled],
  );

  const getClosestInsertPosition = useCallback(() => {
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

    // Prefer side-by-side placement: scan every row from the top, trying each
    // column for a free slot before moving to the next row. Only fall past the
    // existing content once no gap fits.
    for (let y = 0; y <= maxExistingY; y += 1) {
      for (let x = 0; x <= GRID_COLS - NEW_PANEL_W; x += 1) {
        if (!collides(x, y)) {
          return { x, y };
        }
      }
    }

    return { x: 0, y: maxExistingY };
  }, [panels]);

  const addPanel = async (panelType: string) => {
    if (isLoadingLayout || !activeDashboardId) return;
    const { x, y } = getClosestInsertPosition();
    try {
      const panel = await api.post<Panel>("/api/layouts", {
        dashboard_id: activeDashboardId,
        panel_type: panelType,
        x,
        y,
        title: `${getPanelDefinition(panelType)?.label ?? "New"} Panel`,
      });
      setPanels((prev) => [...prev, panel]);
      triggerHighlight(panel.id);
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

  const triggerHighlight = useCallback((panelId: string) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);

    // Briefly clear highlight to ensure the CSS animation re-triggers even for same panel
    setHighlightedPanelId(null);

    highlightTimerRef.current = setTimeout(() => {
      setHighlightedPanelId(panelId);

      scrollTimerRef.current = setTimeout(() => {
        const el = document.getElementById(`panel-${panelId}`);
        if (el) {
          const target = el.closest(".react-grid-item") ?? el;
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 200);

      highlightTimerRef.current = setTimeout(() => {
        setHighlightedPanelId((curr) => (curr === panelId ? null : curr));
      }, 2200);
    }, 30);
  }, []);

  const addDuplicatedPanel = useCallback(
    (copy: Panel) => {
      setPanels((prev) => [...prev, copy]);
      triggerHighlight(copy.id);
      setToast({ msg: `Duplicated “${copy.title}”`, ok: true });
    },
    [triggerHighlight],
  );

  const handlePanelCopy = useCallback(
    (newPanelId: string, targetDashboardId: string) => {
      const targetDash = dashboards.find((d) => d.id === targetDashboardId);
      setToast({
        msg: `Copied to “${targetDash?.name ?? "dashboard"}”`,
        ok: true,
      });
      pendingHighlightRef.current = newPanelId;
      switchDashboard(targetDashboardId);
    },
    [dashboards, switchDashboard],
  );

  const handlePanelMove = useCallback(
    (panelId: string, targetDashboardId: string) => {
      const panel = panels.find((p) => p.id === panelId);
      removePanel(panelId);
      const targetDash = dashboards.find((d) => d.id === targetDashboardId);
      setToast({
        msg: `Moved “${panel?.title ?? "panel"}” to “${targetDash?.name ?? "dashboard"}”`,
        ok: true,
      });
      pendingHighlightRef.current = panelId;
      switchDashboard(targetDashboardId);
    },
    [panels, dashboards, switchDashboard],
  );

  const renderPanelWrapper = (panel: Panel) => (
    <PanelWrapper
      panel={panel}
      editMode={editMode}
      brokerStatuses={brokerStatuses}
      activeDashboardId={activeDashboardId}
      dashboards={dashboards}
      highlight={panel.id === highlightedPanelId}
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
      onDuplicate={addDuplicatedPanel}
      onCopy={handlePanelCopy}
      onMove={handlePanelMove}
      onConfigModalChange={handleConfigModalChange}
      onPickerConsumed={handlePickerConsumed}
    />
  );

  // Consume pending highlight when target dashboard's panels finish loading
  useEffect(() => {
    if (isLoadingLayout || panels.length === 0) return;
    if (pendingHighlightRef.current) {
      const targetId = pendingHighlightRef.current;
      if (panels.some((p) => p.id === targetId)) {
        pendingHighlightRef.current = null;
        triggerHighlight(targetId);
      }
    }
  }, [panels, isLoadingLayout, triggerHighlight]);

  // Handle direct URL query param highlight (e.g. from Explorer jump link)
  useEffect(() => {
    const targetPanelId = searchParams.get("panel");
    if (!targetPanelId || isLoadingLayout || panels.length === 0) return;
    if (panels.some((p) => p.id === targetPanelId)) {
      triggerHighlight(targetPanelId);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("panel");
          return next;
        },
        { replace: true },
      );
    }
  }, [
    searchParams,
    isLoadingLayout,
    panels,
    triggerHighlight,
    setSearchParams,
  ]);

  return (
    <>
      <div className="min-h-screen bg-base-200">
        {/* Grid */}
        <div className="p-4" ref={containerRef}>
          {dashboardsLoading || (hasDashboards && isLoadingLayout) ? (
            <div className="flex items-center justify-center h-64 text-base-content/60">
              <div className="text-center">
                <span className="loading loading-spinner loading-lg mb-4" />
                <p className="text-xl">Loading dashboard layout...</p>
              </div>
            </div>
          ) : !hasDashboards ? (
            <div className="flex items-center justify-center h-64 text-base-content/40">
              <div className="text-center">
                <p className="text-2xl mb-2">No dashboards yet</p>
                <p>
                  Open the dashboard selector in the navbar to create your first
                  one
                </p>
              </div>
            </div>
          ) : panels.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-base-content/40">
              <div className="text-center">
                <p className="text-2xl mb-2">No panels yet</p>
                {editMode ? (
                  <button
                    className="btn btn-primary btn-sm gap-1.5 mt-2"
                    onClick={() => setPanelLibraryOpen(true)}
                  >
                    <MdAdd className="text-base" />
                    Add panel
                  </button>
                ) : (
                  <p>Click "Edit" in the navbar to add panels</p>
                )}
              </div>
            </div>
          ) : isMobile ? (
            // Mobile: stacked single column, ordered by saved (y, x) position.
            <div className="flex flex-col gap-3">
              {[...panels]
                .sort((a, b) => a.y - b.y || a.x - b.x)
                .map((panel) => {
                  if (panel.panel_type === "separator") {
                    // A separator is a slim full-width divider on mobile. In
                    // edit mode it needs room to show its header (delete/config).
                    return (
                      <div
                        key={panel.id}
                        id={`panel-${panel.id}`}
                        className={`flex items-center justify-center ${editMode ? "h-16" : "h-6"}`}
                      >
                        {renderPanelWrapper(panel)}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={panel.id}
                      id={`panel-${panel.id}`}
                      style={{ height: MOBILE_PANEL_HEIGHT }}
                      className="w-full"
                    >
                      {renderPanelWrapper(panel)}
                    </div>
                  );
                })}
              {editMode && (
                <button
                  onClick={() => setPanelLibraryOpen(true)}
                  className="w-full h-24 rounded-box border-2 border-dashed border-base-300 flex items-center justify-center gap-2 text-base-content/60 hover:text-primary hover:border-primary"
                >
                  <MdAdd className="text-xl" />
                  <span className="text-sm font-medium">Add panel</span>
                </button>
              )}
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
                  <div
                    key={panel.id}
                    id={`panel-${panel.id}`}
                    className={
                      panel.panel_type === "separator" && !editMode
                        ? "flex items-center justify-center"
                        : ""
                    }
                  >
                    {renderPanelWrapper(panel)}
                  </div>
                ))}
              </RGL>
            </div>
          )}
        </div>
      </div>
      <PanelLibraryModal
        open={panelLibraryOpen}
        onClose={() => setPanelLibraryOpen(false)}
        onPick={(type) => addPanel(type)}
      />
      {toast && (
        <div className="toast toast-top toast-end z-50">
          <div
            className={`alert ${toast.ok ? "alert-success" : "alert-error"} text-xs py-2 px-3 shadow-lg`}
          >
            <span>{toast.msg}</span>
          </div>
        </div>
      )}
    </>
  );
}
