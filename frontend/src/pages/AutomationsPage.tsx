import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  MdAutoMode,
  MdSearch,
  MdRefresh,
  MdContentCopy,
  MdCheck,
  MdLayers,
  MdSchedule,
} from "react-icons/md";
import {
  RiServerLine,
  RiHashtag,
  RiExternalLinkLine,
  RiArrowUpLine,
  RiArrowDownLine,
  RiArrowUpDownLine,
  RiFilter3Line,
  RiFilter3Fill,
} from "react-icons/ri";
import { api, type AutomationItem } from "../api/client";
import { PRESETS, describeCron } from "../components/panels/cronUtils";
import { formatConditionSummary } from "../components/panels/logicUtils";
import { VALUE_TOKEN, TOKEN_LABEL } from "../components/panels/payloadShape";

function renderPayloadWithChips(payload?: string, allowChips = true) {
  const oneLine = (payload || "").replace(/\s+/g, " ").trim();
  const normalized = oneLine.replace(/\{\{value\}\}/g, VALUE_TOKEN);
  if (!allowChips || !normalized.includes(VALUE_TOKEN)) {
    return oneLine;
  }
  return normalized.split(VALUE_TOKEN).map((chunk, index) => (
    <span key={index}>
      {index > 0 && (
        <span className="badge badge-primary badge-xs font-mono text-[10px] px-1.5 py-0 leading-none align-middle select-none mx-0.5">
          {TOKEN_LABEL}
        </span>
      )}
      {chunk}
    </span>
  ));
}

function getConditionsTooltip(job: AutomationItem): string {
  if (job.conditions && job.conditions.length > 0) {
    return job.conditions
      .map((c, idx) => {
        const topic = c.topic?.trim() || job.source_topic || "";
        const condWithTopic = { ...c, topic };
        return formatConditionSummary(condWithTopic, true, idx > 0);
      })
      .join("\n");
  }
  if (job.source_topic) {
    return `${job.source_topic} · any message`;
  }
  return "No conditions configured";
}

function formatCountdown(nextRunStr?: string, nowMs = Date.now()): string {
  if (!nextRunStr) return "—";
  const target = new Date(nextRunStr).getTime();
  if (isNaN(target) || target < 1000) return "—";
  const diff = target - nowMs;
  if (diff <= 0) return "due now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  const remainingS = s % 60;
  if (m < 60) return `in ${m}m ${remainingS}s`;
  const h = Math.floor(m / 60);
  const remainingM = m % 60;
  if (h < 24) return `in ${h}h ${remainingM}m`;
  const d = Math.floor(h / 24);
  return `in ${d}d ${h % 24}h`;
}

function formatExactTime(dateStr?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatSchedule(expr: string): string {
  const preset = PRESETS.find((p) => p.value === expr);
  if (preset) return preset.label;
  return describeCron(expr) ?? expr;
}

function formatTriggerMode(mode?: string): string {
  switch (mode) {
    case "every":
      return "Every match";
    case "count":
      return "Count match";
    case "sustained":
      return "Sustained";
    case "on_change":
    default:
      return "On change";
  }
}

function formatTimeAgo(dateStr?: string, nowMs = Date.now()): string {
  if (!dateStr) return "";
  const t = new Date(dateStr).getTime();
  if (isNaN(t) || t < 1000) return "";
  const diff = Math.max(0, nowMs - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

interface ColumnFilters {
  status: "all" | "active" | "paused";
  type: string;
  automation: string;
  topic: string;
  payload: string;
  qos: number | null;
  retain: boolean | null;
  triggerExecution: string;
  timing: "all" | "scheduled" | "soon";
  broker: string;
}

const DEFAULT_FILTERS: ColumnFilters = {
  status: "all",
  type: "all",
  automation: "",
  topic: "",
  payload: "",
  qos: null,
  retain: null,
  triggerExecution: "",
  timing: "all",
  broker: "",
};

type SortKey =
  | "status"
  | "type"
  | "automation"
  | "topic"
  | "payload"
  | "trigger_execution"
  | "broker";

type SortOrder = "asc" | "desc" | null;

interface SortState {
  key: SortKey | null;
  order: SortOrder;
}

interface PopoverProps {
  anchorRect: DOMRect | null;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}

function FilterPopover({
  anchorRect,
  onClose,
  children,
  width = 240,
}: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  if (!anchorRect) return null;

  const top = anchorRect.bottom + 6;
  let left = anchorRect.right - width;
  if (left < 8) left = 8;
  if (left + width > window.innerWidth - 8) {
    left = window.innerWidth - width - 8;
  }

  return createPortal(
    <div
      ref={popoverRef}
      style={{ position: "fixed", top, left, width, zIndex: 9999 }}
      className="bg-base-100 border border-base-300 rounded-box shadow-2xl p-3 text-xs"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export default function AutomationsPage() {
  const [jobs, setJobs] = useState<AutomationItem[]>([]);
  const [dashboards, setDashboards] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [selectedDashboardId, setSelectedDashboardId] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<ColumnFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortState>({ key: null, order: null });
  const [activeFilterCol, setActiveFilterCol] = useState<SortKey | null>(null);
  const [filterAnchorRect, setFilterAnchorRect] = useState<DOMRect | null>(
    null,
  );
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      const [data, dList] = await Promise.all([
        api.getAutomations(),
        api
          .get<Array<{ id: string; name: string }>>("/api/dashboards")
          .catch(() => []),
      ]);
      setJobs(data);
      if (dList.length > 0) setDashboards(dList);
    } catch {
      showToast("Failed to load automations", false);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getAutomations(),
      api
        .get<Array<{ id: string; name: string }>>("/api/dashboards")
        .catch(() => []),
    ])
      .then(([data, dList]) => {
        if (!cancelled) {
          setJobs(data);
          if (dList.length > 0) setDashboards(dList);
        }
      })
      .catch(() => {
        if (!cancelled) showToast("Failed to load automations", false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  // Clock tick every second for live countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleToggle = async (job: AutomationItem) => {
    const nextEnabled = !job.enabled;
    setTogglingIds((prev) => new Set(prev).add(job.panel_id));

    // Optimistic update
    setJobs((prev) =>
      prev.map((j) =>
        j.panel_id === job.panel_id ? { ...j, enabled: nextEnabled } : j,
      ),
    );

    try {
      await api.toggleAutomation(job.panel_id, nextEnabled);
      const updated = await api.getAutomations();
      setJobs(updated);
    } catch {
      // Rollback
      setJobs((prev) =>
        prev.map((j) =>
          j.panel_id === job.panel_id ? { ...j, enabled: job.enabled } : j,
        ),
      );
      showToast("Failed to update status", false);
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(job.panel_id);
        return next;
      });
    }
  };

  const handleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev.key !== key) {
        return { key, order: "asc" };
      }
      if (prev.order === "asc") {
        return { key, order: "desc" };
      }
      return { key: null, order: null };
    });
  };

  const handleOpenFilter = (
    key: SortKey,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    e.stopPropagation();
    if (activeFilterCol === key) {
      setActiveFilterCol(null);
      setFilterAnchorRect(null);
    } else {
      setActiveFilterCol(key);
      setFilterAnchorRect(e.currentTarget.getBoundingClientRect());
    }
  };

  const handleCloseFilter = () => {
    setActiveFilterCol(null);
    setFilterAnchorRect(null);
  };

  const isFilterActive = useMemo(() => {
    return (
      filters.status !== "all" ||
      filters.type !== "all" ||
      filters.automation.trim() !== "" ||
      filters.topic.trim() !== "" ||
      filters.payload.trim() !== "" ||
      filters.qos !== null ||
      filters.retain !== null ||
      filters.triggerExecution.trim() !== "" ||
      filters.timing !== "all" ||
      filters.broker !== ""
    );
  }, [filters]);

  const isColFiltered = (key: SortKey): boolean => {
    switch (key) {
      case "status":
        return filters.status !== "all";
      case "type":
        return filters.type !== "all";
      case "automation":
        return filters.automation.trim() !== "";
      case "topic":
        return filters.topic.trim() !== "";
      case "payload":
        return (
          filters.payload.trim() !== "" ||
          filters.qos !== null ||
          filters.retain !== null
        );
      case "trigger_execution":
        return (
          filters.triggerExecution.trim() !== "" || filters.timing !== "all"
        );
      case "broker":
        return filters.broker !== "";
      default:
        return false;
    }
  };

  const handleResetAllFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSearchQuery("");
    setSelectedDashboardId("all");
  };

  const availableDashboards = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of dashboards) {
      map.set(d.id, d.name);
    }
    for (const j of jobs) {
      if (j.dashboard_id && !map.has(j.dashboard_id)) {
        map.set(j.dashboard_id, j.dashboard_name || "Untitled Dashboard");
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dashboards, jobs]);

  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) {
      if (j.panel_type) set.add(j.panel_type);
    }
    return Array.from(set).sort();
  }, [jobs]);

  const brokerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) {
      if (j.broker_name) set.add(j.broker_name);
    }
    return Array.from(set).sort();
  }, [jobs]);

  const soonReferenceTime = filters.timing === "soon" ? currentTimeMs : 0;

  // Filter and Sort Pipeline
  const displayedJobs = useMemo(() => {
    let result = jobs.filter((job) => {
      // 0. Dashboard filter
      if (
        selectedDashboardId !== "all" &&
        job.dashboard_id !== selectedDashboardId
      ) {
        return false;
      }

      // 1. Global search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesGlobal =
          (job.target_topic || "").toLowerCase().includes(q) ||
          (Boolean(job.source_topic) &&
            job.source_topic!.toLowerCase().includes(q)) ||
          (Boolean(job.conditions) &&
            job.conditions!.some(
              (c) =>
                (c.topic && c.topic.toLowerCase().includes(q)) ||
                (c.value && c.value.toLowerCase().includes(q)),
            )) ||
          (job.panel_title || "").toLowerCase().includes(q) ||
          (job.dashboard_name || "").toLowerCase().includes(q) ||
          (job.broker_name || "").toLowerCase().includes(q) ||
          (job.panel_type || "").toLowerCase().includes(q) ||
          (job.trigger_summary || "").toLowerCase().includes(q) ||
          (job.trigger_detail || "").toLowerCase().includes(q) ||
          (Boolean(job.payload) && job.payload!.toLowerCase().includes(q));
        if (!matchesGlobal) return false;
      }

      // 2. Status filter
      if (filters.status === "active" && !job.enabled) return false;
      if (filters.status === "paused" && job.enabled) return false;

      // 3. Type filter
      if (
        filters.type !== "all" &&
        (job.panel_type || "").toLowerCase() !== filters.type.toLowerCase()
      ) {
        return false;
      }

      // 4. Automation filter
      if (filters.automation.trim()) {
        const qa = filters.automation.toLowerCase();
        const matchesAuto =
          (job.panel_title || "").toLowerCase().includes(qa) ||
          (job.dashboard_name || "").toLowerCase().includes(qa);
        if (!matchesAuto) return false;
      }

      // 5. Topic filter (target topic where sending)
      if (filters.topic.trim()) {
        const qt = filters.topic.toLowerCase();
        const matchesTopic = (job.target_topic || "").toLowerCase().includes(qt);
        if (!matchesTopic) return false;
      }

      // 6. Payload filter
      if (filters.payload.trim()) {
        const qp = filters.payload.toLowerCase();
        if (!(job.payload || "").toLowerCase().includes(qp)) return false;
      }
      if (filters.qos !== null && job.qos !== filters.qos) {
        return false;
      }
      if (filters.retain !== null && job.retain !== filters.retain) {
        return false;
      }

      // 7. Trigger & Execution filter
      if (filters.triggerExecution.trim()) {
        const qte = filters.triggerExecution.toLowerCase();
        const matchesTE =
          (job.trigger_summary || "").toLowerCase().includes(qte) ||
          (job.trigger_detail || "").toLowerCase().includes(qte) ||
          (Boolean(job.status_detail) &&
            job.status_detail!.toLowerCase().includes(qte));
        if (!matchesTE) return false;
      }
      if (filters.timing === "scheduled") {
        if (!job.enabled) return false;
        if (job.trigger_type === "schedule" && !job.next_run) return false;
      } else if (filters.timing === "soon") {
        if (!job.enabled || !job.next_run) return false;
        const diffMs = new Date(job.next_run).getTime() - soonReferenceTime;
        if (diffMs > 5 * 60 * 1000 || diffMs < 0) return false;
      }

      // 8. Broker filter
      if (filters.broker && job.broker_name !== filters.broker) {
        return false;
      }

      return true;
    });

    // Sort
    if (sort.key && sort.order) {
      const dir = sort.order === "asc" ? 1 : -1;
      result = [...result].sort((a, b) => {
        switch (sort.key) {
          case "status": {
            const valA = a.enabled ? 1 : 0;
            const valB = b.enabled ? 1 : 0;
            return (valA - valB) * dir;
          }
          case "type":
            return (a.panel_type || "").localeCompare(b.panel_type || "") * dir;
          case "automation": {
            const strA = `${a.panel_title || ""} ${a.dashboard_name || ""}`.toLowerCase();
            const strB = `${b.panel_title || ""} ${b.dashboard_name || ""}`.toLowerCase();
            return strA.localeCompare(strB) * dir;
          }
          case "topic": {
            return (
              (a.target_topic || "").localeCompare(b.target_topic || "") * dir
            );
          }
          case "payload":
            return (a.payload || "").localeCompare(b.payload || "") * dir;
          case "trigger_execution": {
            const strA =
              `${a.trigger_summary || ""} ${a.trigger_detail || ""}`.toLowerCase();
            const strB =
              `${b.trigger_summary || ""} ${b.trigger_detail || ""}`.toLowerCase();
            return strA.localeCompare(strB) * dir;
          }
          case "broker":
            return (
              (a.broker_name || "").localeCompare(b.broker_name || "") * dir
            );
          default:
            return 0;
        }
      });
    }

    return result;
  }, [
    jobs,
    searchQuery,
    filters,
    sort,
    selectedDashboardId,
    soonReferenceTime,
  ]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-base-200/40">
      {/* ── Header bar ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-base-300 bg-base-100 shrink-0">
        <span className="text-sm font-medium text-base-content/60">
          Dashboard
        </span>
        <select
          className="select select-bordered select-sm"
          value={selectedDashboardId}
          onChange={(e) => setSelectedDashboardId(e.target.value)}
        >
          <option value="all">All Dashboards</option>
          {availableDashboards.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-base-content/40">
          {searchQuery.trim() || isFilterActive || selectedDashboardId !== "all"
            ? `${displayedJobs.length} of ${jobs.length} automations`
            : `${jobs.length} automations configured`}
        </span>

        {/* Right side controls */}
        <div className="ml-auto flex items-center gap-3">
          {/* Active filter badge & reset */}
          {(isFilterActive || searchQuery || selectedDashboardId !== "all") && (
            <div className="flex items-center gap-2">
              <span className="badge badge-sm badge-ghost text-xs">
                Showing {displayedJobs.length} of {jobs.length}
              </span>
              <button
                type="button"
                className="btn btn-xs btn-ghost text-primary hover:bg-primary/10"
                onClick={handleResetAllFilters}
              >
                Reset filters
              </button>
            </div>
          )}

          {/* Global Search */}
          <div className="relative w-64">
            <MdSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/40 text-sm pointer-events-none" />
            <input
              type="text"
              className="input input-sm input-bordered w-full pl-8 pr-7 text-xs"
              placeholder="Search all columns..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-circle absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 min-h-0 text-base-content/50 hover:text-base-content"
                onClick={() => setSearchQuery("")}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Refresh Action */}
          <div className="tooltip tooltip-left" data-tip="Refresh automations">
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-square"
              onClick={handleRefresh}
              disabled={loading}
            >
              <MdRefresh
                className={`text-base ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Content ────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6 bg-base-200/40">
        <div className="card bg-base-100 border border-base-300 shadow-sm overflow-hidden w-full">
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr className="border-b border-base-300 text-xs bg-base-200/50">
                  {/* ── Column 0: Go to Dashboard ──────── */}
                  <th className="w-10 text-center py-2.5 px-3 border-r border-base-300">
                    <span className="sr-only">Go to dashboard</span>
                  </th>

                  {/* ── Column 1: Status ────────────────── */}
                  <th className="py-2.5 px-4 w-24 border-r border-base-300">
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                        onClick={() => handleSort("status")}
                      >
                        <span>Status</span>
                        {sort.key === "status" ? (
                          sort.order === "asc" ? (
                            <RiArrowUpLine className="text-primary text-sm shrink-0" />
                          ) : (
                            <RiArrowDownLine className="text-primary text-sm shrink-0" />
                          )
                        ) : (
                          <RiArrowUpDownLine className="text-base-content/20 group-hover:text-base-content/50 text-xs shrink-0" />
                        )}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-ghost btn-xs btn-circle h-6 w-6 min-h-0 ${
                          isColFiltered("status")
                            ? "text-primary bg-primary/10"
                            : "text-base-content/40 hover:text-base-content"
                        }`}
                        onClick={(e) => handleOpenFilter("status", e)}
                        title="Filter by status"
                      >
                        {isColFiltered("status") ? (
                          <RiFilter3Fill className="text-xs" />
                        ) : (
                          <RiFilter3Line className="text-xs" />
                        )}
                      </button>
                    </div>
                  </th>

                  {/* ── Column 2: Type (NEW) ────────────── */}
                  <th className="py-2.5 px-4 w-28 min-w-[100px] border-r border-base-300">
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                        onClick={() => handleSort("type")}
                      >
                        <span>Type</span>
                        {sort.key === "type" ? (
                          sort.order === "asc" ? (
                            <RiArrowUpLine className="text-primary text-sm shrink-0" />
                          ) : (
                            <RiArrowDownLine className="text-primary text-sm shrink-0" />
                          )
                        ) : (
                          <RiArrowUpDownLine className="text-base-content/20 group-hover:text-base-content/50 text-xs shrink-0" />
                        )}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-ghost btn-xs btn-circle h-6 w-6 min-h-0 ${
                          isColFiltered("type")
                            ? "text-primary bg-primary/10"
                            : "text-base-content/40 hover:text-base-content"
                        }`}
                        onClick={(e) => handleOpenFilter("type", e)}
                        title="Filter by type"
                      >
                        {isColFiltered("type") ? (
                          <RiFilter3Fill className="text-xs" />
                        ) : (
                          <RiFilter3Line className="text-xs" />
                        )}
                      </button>
                    </div>
                  </th>

                  {/* ── Column 3: Automation ────────────── */}
                  <th className="py-2.5 px-4 min-w-[150px] border-r border-base-300">
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                        onClick={() => handleSort("automation")}
                      >
                        <span>Automation</span>
                        {sort.key === "automation" ? (
                          sort.order === "asc" ? (
                            <RiArrowUpLine className="text-primary text-sm shrink-0" />
                          ) : (
                            <RiArrowDownLine className="text-primary text-sm shrink-0" />
                          )
                        ) : (
                          <RiArrowUpDownLine className="text-base-content/20 group-hover:text-base-content/50 text-xs shrink-0" />
                        )}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-ghost btn-xs btn-circle h-6 w-6 min-h-0 ${
                          isColFiltered("automation")
                            ? "text-primary bg-primary/10"
                            : "text-base-content/40 hover:text-base-content"
                        }`}
                        onClick={(e) => handleOpenFilter("automation", e)}
                        title="Filter by name or dashboard"
                      >
                        {isColFiltered("automation") ? (
                          <RiFilter3Fill className="text-xs" />
                        ) : (
                          <RiFilter3Line className="text-xs" />
                        )}
                      </button>
                    </div>
                  </th>

                  {/* ── Column 4: Topic ─────────────────── */}
                  <th className="py-2.5 px-4 min-w-[180px] border-r border-base-300">
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                        onClick={() => handleSort("topic")}
                      >
                        <span>Topic</span>
                        {sort.key === "topic" ? (
                          sort.order === "asc" ? (
                            <RiArrowUpLine className="text-primary text-sm shrink-0" />
                          ) : (
                            <RiArrowDownLine className="text-primary text-sm shrink-0" />
                          )
                        ) : (
                          <RiArrowUpDownLine className="text-base-content/20 group-hover:text-base-content/50 text-xs shrink-0" />
                        )}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-ghost btn-xs btn-circle h-6 w-6 min-h-0 ${
                          isColFiltered("topic")
                            ? "text-primary bg-primary/10"
                            : "text-base-content/40 hover:text-base-content"
                        }`}
                        onClick={(e) => handleOpenFilter("topic", e)}
                        title="Filter by topic"
                      >
                        {isColFiltered("topic") ? (
                          <RiFilter3Fill className="text-xs" />
                        ) : (
                          <RiFilter3Line className="text-xs" />
                        )}
                      </button>
                    </div>
                  </th>

                  {/* ── Column 5: Payload ───────────────── */}
                  <th className="py-2.5 px-4 min-w-[200px] flex-1 border-r border-base-300">
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                        onClick={() => handleSort("payload")}
                      >
                        <span>Payload</span>
                        {sort.key === "payload" ? (
                          sort.order === "asc" ? (
                            <RiArrowUpLine className="text-primary text-sm shrink-0" />
                          ) : (
                            <RiArrowDownLine className="text-primary text-sm shrink-0" />
                          )
                        ) : (
                          <RiArrowUpDownLine className="text-base-content/20 group-hover:text-base-content/50 text-xs shrink-0" />
                        )}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-ghost btn-xs btn-circle h-6 w-6 min-h-0 ${
                          isColFiltered("payload")
                            ? "text-primary bg-primary/10"
                            : "text-base-content/40 hover:text-base-content"
                        }`}
                        onClick={(e) => handleOpenFilter("payload", e)}
                        title="Filter payload and flags"
                      >
                        {isColFiltered("payload") ? (
                          <RiFilter3Fill className="text-xs" />
                        ) : (
                          <RiFilter3Line className="text-xs" />
                        )}
                      </button>
                    </div>
                  </th>

                  {/* ── Column 6: Trigger & Execution (NEW) ── */}
                  <th className="py-2.5 px-4 min-w-[220px] border-r border-base-300">
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                        onClick={() => handleSort("trigger_execution")}
                      >
                        <span>Trigger & Execution</span>
                        {sort.key === "trigger_execution" ? (
                          sort.order === "asc" ? (
                            <RiArrowUpLine className="text-primary text-sm shrink-0" />
                          ) : (
                            <RiArrowDownLine className="text-primary text-sm shrink-0" />
                          )
                        ) : (
                          <RiArrowUpDownLine className="text-base-content/20 group-hover:text-base-content/50 text-xs shrink-0" />
                        )}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-ghost btn-xs btn-circle h-6 w-6 min-h-0 ${
                          isColFiltered("trigger_execution")
                            ? "text-primary bg-primary/10"
                            : "text-base-content/40 hover:text-base-content"
                        }`}
                        onClick={(e) =>
                          handleOpenFilter("trigger_execution", e)
                        }
                        title="Filter trigger and execution details"
                      >
                        {isColFiltered("trigger_execution") ? (
                          <RiFilter3Fill className="text-xs" />
                        ) : (
                          <RiFilter3Line className="text-xs" />
                        )}
                      </button>
                    </div>
                  </th>

                  {/* ── Column 7: Broker ────────────────── */}
                  <th className="py-2.5 px-4 min-w-[130px]">
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                        onClick={() => handleSort("broker")}
                      >
                        <span>Broker</span>
                        {sort.key === "broker" ? (
                          sort.order === "asc" ? (
                            <RiArrowUpLine className="text-primary text-sm shrink-0" />
                          ) : (
                            <RiArrowDownLine className="text-primary text-sm shrink-0" />
                          )
                        ) : (
                          <RiArrowUpDownLine className="text-base-content/20 group-hover:text-base-content/50 text-xs shrink-0" />
                        )}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-ghost btn-xs btn-circle h-6 w-6 min-h-0 ${
                          isColFiltered("broker")
                            ? "text-primary bg-primary/10"
                            : "text-base-content/40 hover:text-base-content"
                        }`}
                        onClick={(e) => handleOpenFilter("broker", e)}
                        title="Filter by broker"
                      >
                        {isColFiltered("broker") ? (
                          <RiFilter3Fill className="text-xs" />
                        ) : (
                          <RiFilter3Line className="text-xs" />
                        )}
                      </button>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-base-200">
                {loading && jobs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-16 text-center text-xs text-base-content/50"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <span className="loading loading-spinner loading-sm" />
                        <span>Loading automations...</span>
                      </div>
                    </td>
                  </tr>
                ) : jobs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-16 text-center text-xs text-base-content/50"
                    >
                      <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                        <MdAutoMode className="text-4xl text-base-content/30" />
                        <p className="text-base font-semibold text-base-content/70">
                          No automations configured
                        </p>
                        <p className="text-xs text-base-content/50">
                          Create a Cron or Logic panel on any dashboard to
                          automate MQTT messages.
                        </p>
                        <Link
                          to="/dashboard"
                          className="btn btn-xs btn-primary mt-2 gap-1.5"
                        >
                          <MdLayers className="text-xs" />
                          <span>Go to Dashboards</span>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ) : displayedJobs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <p className="text-sm font-medium text-base-content/60">
                          No matching automations
                        </p>
                        <p className="text-xs text-base-content/40">
                          Try adjusting or clearing your column filters
                        </p>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost text-primary mt-1"
                          onClick={handleResetAllFilters}
                        >
                          Reset all filters
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  displayedJobs.map((job) => {
                    const isToggling = togglingIds.has(job.panel_id);
                    const targetTopics = (job.target_topic || "")
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean);

                    return (
                      <tr
                        key={job.panel_id}
                        className={`hover:bg-base-200/50 ${
                          !job.enabled ? "opacity-60" : ""
                        }`}
                      >
                        {/* 0. Go to Panel */}
                        <td className="align-middle text-center py-3 px-3">
                          <div
                            className="tooltip tooltip-right"
                            data-tip="Go to panel"
                          >
                            <Link
                              to={`/dashboard?dashboard=${encodeURIComponent(
                                job.dashboard_id,
                              )}&panel=${encodeURIComponent(job.panel_id)}`}
                              className="btn btn-ghost btn-xs btn-square"
                              aria-label="Go to panel"
                            >
                              <RiExternalLinkLine className="text-sm" />
                            </Link>
                          </div>
                        </td>

                        {/* 1. Status dot + toggle */}
                        <td className="text-center align-middle py-3 px-4">
                          <div
                            className="tooltip tooltip-right inline-flex items-center gap-1.5"
                            data-tip={
                              job.enabled ? "Active — click to pause" : "Paused"
                            }
                          >
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                job.enabled ? "bg-success" : "bg-neutral"
                              }`}
                            />
                            <input
                              type="checkbox"
                              className="toggle toggle-xs toggle-primary"
                              checked={job.enabled}
                              disabled={isToggling}
                              onChange={() => handleToggle(job)}
                            />
                          </div>
                        </td>

                        {/* 2. Type Column */}
                        <td className="align-middle py-3 px-4">
                          {job.panel_type === "cron" ? (
                            <span className="badge badge-sm badge-ghost font-mono text-[10px] gap-1 shrink-0">
                              <MdSchedule className="text-xs text-base-content/60" />
                              CRON
                            </span>
                          ) : job.panel_type === "logic" ? (
                            <span className="badge badge-sm badge-warning/20 text-warning border-warning/30 font-mono text-[10px] gap-1 shrink-0">
                              <MdAutoMode className="text-xs" />
                              LOGIC
                            </span>
                          ) : (
                            <span className="badge badge-sm badge-neutral font-mono text-[10px] shrink-0 uppercase">
                              {job.panel_type}
                            </span>
                          )}
                        </td>

                        {/* 3. Automation Name & Dashboard */}
                        <td className="align-middle py-3 px-4">
                          <div className="flex flex-col gap-0.5 min-w-[140px]">
                            {(() => {
                              const cleanTitle = (
                                job.panel_title || "Untitled"
                              ).replace(
                                /\s*\((enabled|disabled|active|paused)\)/i,
                                "",
                              );
                              return (
                                <span
                                  className="font-bold text-sm text-base-content truncate max-w-[220px]"
                                  title={cleanTitle}
                                >
                                  {cleanTitle}
                                </span>
                              );
                            })()}
                            <span className="text-[11px] text-base-content/50 flex items-center gap-1">
                              <MdLayers className="text-xs shrink-0" />
                              <span
                                className="truncate max-w-[170px]"
                                title={job.dashboard_name}
                              >
                                {job.dashboard_name || "Default"}
                              </span>
                            </span>
                          </div>
                        </td>

                        {/* 4. Topic */}
                        <td className="align-middle py-3 px-4 max-w-[220px]">
                          <div className="flex flex-col gap-1 min-w-0">
                            {targetTopics.length > 0 ? (
                              targetTopics.map((t, idx) => (
                                <div
                                  key={idx}
                                  className="inline-flex items-center gap-1 font-mono text-xs max-w-full min-w-0"
                                >
                                  <Link
                                    to={`/explorer?topic=${encodeURIComponent(t)}${
                                      job.broker_id
                                        ? `&broker=${encodeURIComponent(
                                            job.broker_id,
                                          )}`
                                        : ""
                                    }`}
                                    className="inline-flex items-center gap-1 font-mono text-xs text-accent font-medium max-w-full min-w-0 hover:underline group"
                                    title={`Topic: "${t}" in Explorer`}
                                  >
                                    <RiHashtag className="text-xs text-base-content/40 group-hover:text-accent shrink-0" />
                                    <span className="truncate">{t}</span>
                                  </Link>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs btn-square h-4 w-4 min-h-0 text-base-content/40 hover:text-base-content shrink-0"
                                    title="Copy topic"
                                    onClick={() =>
                                      handleCopy(
                                        `topic-${job.panel_id}-${idx}`,
                                        t,
                                      )
                                    }
                                  >
                                    {copiedId ===
                                    `topic-${job.panel_id}-${idx}` ? (
                                      <MdCheck className="text-success text-xs" />
                                    ) : (
                                      <MdContentCopy className="text-[10px]" />
                                    )}
                                  </button>
                                </div>
                              ))
                            ) : (
                              <span className="text-[11px] text-base-content/30 italic">
                                (none)
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 5. Payload */}
                        <td className="align-middle py-3 px-4 max-w-[240px]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="badge badge-xs badge-neutral font-mono shrink-0"
                              title={`QoS ${job.qos}`}
                            >
                              Q{job.qos}
                            </span>
                            {job.retain && (
                              <span
                                className="badge badge-xs badge-warning font-mono shrink-0"
                                title="Retained message"
                              >
                                R
                              </span>
                            )}
                            {job.payload ? (
                              <div
                                className="flex items-center gap-1 bg-base-200/70 px-2 py-0.5 rounded font-mono text-[11px] text-base-content/80 min-w-0 flex-1 overflow-hidden"
                                title={job.payload}
                              >
                                <span className="truncate flex-1 block">
                                  {renderPayloadWithChips(
                                    job.payload,
                                    job.panel_type !== "cron",
                                  )}
                                </span>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-xs btn-square h-4 w-4 min-h-0 text-base-content/40 hover:text-base-content shrink-0"
                                  title="Copy payload"
                                  onClick={() =>
                                    handleCopy(
                                      `payload-${job.panel_id}`,
                                      job.payload || "",
                                    )
                                  }
                                >
                                  {copiedId === `payload-${job.panel_id}` ? (
                                    <MdCheck className="text-success text-xs" />
                                  ) : (
                                    <MdContentCopy className="text-[10px]" />
                                  )}
                                </button>
                              </div>
                            ) : (
                              <span className="text-[11px] text-base-content/30 italic">
                                (empty)
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 6. Trigger & Execution (Unified generalized column) */}
                        <td className="align-middle py-3 px-4 min-w-[220px]">
                          {job.panel_type === "cron" ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5 text-xs font-medium">
                                <MdSchedule className="text-xs text-base-content/50 shrink-0" />
                                <span>
                                  {formatSchedule(
                                    job.trigger_summary || job.trigger_detail,
                                  )}
                                </span>
                                <span className="font-mono text-[10px] text-base-content/40">
                                  ({job.trigger_detail})
                                </span>
                              </div>
                              {job.enabled && job.next_run ? (
                                <div
                                  className="tooltip tooltip-top text-left"
                                  data-tip={`Exact: ${formatExactTime(
                                    job.next_run,
                                  )}${
                                    job.last_run
                                      ? ` | Last: ${formatExactTime(
                                          job.last_run,
                                        )}`
                                      : ""
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5 text-[11px]">
                                    <span className="text-primary font-medium">
                                      Next:{" "}
                                      {formatCountdown(
                                        job.next_run,
                                        currentTimeMs,
                                      )}
                                    </span>
                                    <span className="text-[10px] text-base-content/40">
                                      ({formatExactTime(job.next_run)})
                                    </span>
                                  </div>
                                </div>
                              ) : (
                                <span className="badge badge-xs badge-neutral w-fit">
                                  paused
                                </span>
                              )}
                            </div>
                          ) : job.panel_type === "logic" ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5 text-xs font-medium">
                                <MdAutoMode className="text-xs text-warning shrink-0" />
                                <span>
                                  {formatTriggerMode(job.trigger_summary)}
                                </span>
                                <div
                                  className="tooltip tooltip-top before:whitespace-pre-line before:max-w-xs before:text-left before:font-mono before:text-[11px]"
                                  data-tip={getConditionsTooltip(job)}
                                >
                                  <span
                                    className="badge badge-xs badge-ghost font-mono text-[10px] cursor-help"
                                    title={getConditionsTooltip(job)}
                                  >
                                    {job.trigger_detail}
                                  </span>
                                </div>
                              </div>
                              {job.enabled ? (
                                <div
                                  className="tooltip tooltip-top text-left"
                                  data-tip={
                                    job.last_run
                                      ? `Last fired: ${new Date(
                                          job.last_run,
                                        ).toLocaleString()}${
                                          job.run_count
                                            ? ` (${job.run_count} run${job.run_count > 1 ? "s" : ""})`
                                            : ""
                                        }`
                                      : "Waiting for trigger event"
                                  }
                                >
                                  <div className="flex items-center gap-1.5 text-[11px]">
                                    {job.last_run ? (
                                      <span className="text-[10px] text-base-content/50">
                                        Fired{" "}
                                        {formatTimeAgo(
                                          job.last_run,
                                          currentTimeMs,
                                        )}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-base-content/30 italic">
                                        Never fired
                                      </span>
                                    )}
                                    {job.status_detail &&
                                      job.status_detail !== "idle" &&
                                      job.status_detail !== "fired" && (
                                        <span className="text-[10px] text-warning font-mono">
                                          · {job.status_detail}
                                        </span>
                                      )}
                                  </div>
                                </div>
                              ) : (
                                <span className="badge badge-xs badge-neutral w-fit">
                                  paused
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1 text-xs font-medium">
                                <span>
                                  {job.trigger_summary || job.panel_type}
                                </span>
                                {job.trigger_detail &&
                                  (job.conditions &&
                                  job.conditions.length > 0 ? (
                                    <div
                                      className="tooltip tooltip-top before:whitespace-pre-line before:max-w-xs before:text-left before:font-mono before:text-[11px]"
                                      data-tip={getConditionsTooltip(job)}
                                    >
                                      <span
                                        className="badge badge-xs badge-ghost font-mono text-[10px] cursor-help"
                                        title={getConditionsTooltip(job)}
                                      >
                                        {job.trigger_detail}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="badge badge-xs badge-ghost font-mono text-[10px]">
                                      {job.trigger_detail}
                                    </span>
                                  ))}
                              </div>
                              {job.enabled ? (
                                <span className="badge badge-xs badge-ghost font-mono text-[9px] w-fit">
                                  active
                                </span>
                              ) : (
                                <span className="badge badge-xs badge-neutral w-fit">
                                  paused
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* 7. Broker */}
                        <td className="align-middle py-3 px-4">
                          <div className="flex items-center gap-1 text-xs text-base-content/70 min-w-[120px]">
                            <RiServerLine className="text-xs text-base-content/40 shrink-0" />
                            <span
                              className="truncate max-w-[130px]"
                              title={job.broker_name}
                            >
                              {job.broker_name || "Default"}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* ── Portaled Filter Popover ── */}
      {activeFilterCol && (
        <FilterPopover
          anchorRect={filterAnchorRect}
          onClose={handleCloseFilter}
          width={
            activeFilterCol === "payload"
              ? 260
              : activeFilterCol === "trigger_execution"
                ? 260
                : 220
          }
        >
          {activeFilterCol === "status" && (
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-semibold text-base-content/50 uppercase tracking-wider text-[10px] px-1">
                Status
              </span>
              {(["all", "active", "paused"] as const).map((st) => (
                <label
                  key={st}
                  className="flex items-center gap-2 p-1 rounded hover:bg-base-200 cursor-pointer capitalize"
                >
                  <input
                    type="radio"
                    name="filter-status"
                    className="radio radio-xs radio-primary"
                    checked={filters.status === st}
                    onChange={() =>
                      setFilters((p) => ({
                        ...p,
                        status: st,
                      }))
                    }
                  />
                  <span>{st}</span>
                </label>
              ))}
            </div>
          )}

          {activeFilterCol === "type" && (
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-semibold text-base-content/50 uppercase tracking-wider text-[10px] px-1">
                Automation Type
              </span>
              {["all", ...availableTypes].map((t) => (
                <label
                  key={t}
                  className="flex items-center gap-2 p-1 rounded hover:bg-base-200 cursor-pointer capitalize"
                >
                  <input
                    type="radio"
                    name="filter-type"
                    className="radio radio-xs radio-primary"
                    checked={filters.type === t}
                    onChange={() =>
                      setFilters((p) => ({
                        ...p,
                        type: t,
                      }))
                    }
                  />
                  <span>{t === "all" ? "All Types" : t.toUpperCase()}</span>
                </label>
              ))}
            </div>
          )}

          {activeFilterCol === "automation" && (
            <div className="flex flex-col gap-2 text-xs">
              <span className="font-semibold text-base-content/50 uppercase tracking-wider text-[10px]">
                Filter Automation
              </span>
              <input
                type="text"
                className="input input-xs input-bordered w-full"
                placeholder="Search title or dashboard..."
                value={filters.automation}
                onChange={(e) =>
                  setFilters((p) => ({
                    ...p,
                    automation: e.target.value,
                  }))
                }
                autoFocus
              />
              {filters.automation && (
                <button
                  type="button"
                  className="btn btn-xs btn-ghost text-error self-end"
                  onClick={() => setFilters((p) => ({ ...p, automation: "" }))}
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {activeFilterCol === "topic" && (
            <div className="flex flex-col gap-2 text-xs">
              <span className="font-semibold text-base-content/50 uppercase tracking-wider text-[10px]">
                Filter Topic
              </span>
              <input
                type="text"
                className="input input-xs input-bordered w-full font-mono"
                placeholder="e.g. test/..."
                value={filters.topic}
                onChange={(e) =>
                  setFilters((p) => ({
                    ...p,
                    topic: e.target.value,
                  }))
                }
                autoFocus
              />
              {filters.topic && (
                <button
                  type="button"
                  className="btn btn-xs btn-ghost text-error self-end"
                  onClick={() => setFilters((p) => ({ ...p, topic: "" }))}
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {activeFilterCol === "payload" && (
            <div className="flex flex-col gap-2 text-xs">
              <span className="font-semibold text-base-content/50 uppercase tracking-wider text-[10px]">
                Filter Payload
              </span>
              <input
                type="text"
                className="input input-xs input-bordered w-full font-mono"
                placeholder="Payload text..."
                value={filters.payload}
                onChange={(e) =>
                  setFilters((p) => ({
                    ...p,
                    payload: e.target.value,
                  }))
                }
                autoFocus
              />

              {/* QoS filter */}
              <div className="flex items-center justify-between pt-1 border-t border-base-200">
                <span className="text-[11px] text-base-content/60">QoS</span>
                <div className="join">
                  <button
                    type="button"
                    className={`join-item btn btn-xs ${filters.qos === null ? "btn-active btn-primary" : "btn-ghost"}`}
                    onClick={() => setFilters((p) => ({ ...p, qos: null }))}
                  >
                    Any
                  </button>
                  {[0, 1, 2].map((q) => (
                    <button
                      key={q}
                      type="button"
                      className={`join-item btn btn-xs ${filters.qos === q ? "btn-active btn-primary" : "btn-ghost"}`}
                      onClick={() => setFilters((p) => ({ ...p, qos: q }))}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Retain filter */}
              <div className="flex items-center justify-between pt-1 border-t border-base-200">
                <span className="text-[11px] text-base-content/60">Retain</span>
                <div className="join">
                  <button
                    type="button"
                    className={`join-item btn btn-xs ${filters.retain === null ? "btn-active btn-primary" : "btn-ghost"}`}
                    onClick={() => setFilters((p) => ({ ...p, retain: null }))}
                  >
                    Any
                  </button>
                  <button
                    type="button"
                    className={`join-item btn btn-xs ${filters.retain === true ? "btn-active btn-primary" : "btn-ghost"}`}
                    onClick={() =>
                      setFilters((p) => ({
                        ...p,
                        retain: true,
                      }))
                    }
                  >
                    Retained
                  </button>
                </div>
              </div>

              {(filters.payload ||
                filters.qos !== null ||
                filters.retain !== null) && (
                <button
                  type="button"
                  className="btn btn-xs btn-ghost text-error self-end mt-1"
                  onClick={() =>
                    setFilters((p) => ({
                      ...p,
                      payload: "",
                      qos: null,
                      retain: null,
                    }))
                  }
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {activeFilterCol === "trigger_execution" && (
            <div className="flex flex-col gap-2 text-xs">
              <span className="font-semibold text-base-content/50 uppercase tracking-wider text-[10px]">
                Filter Trigger & Execution
              </span>
              <input
                type="text"
                className="input input-xs input-bordered w-full font-mono"
                placeholder="Search trigger, conditions, mode..."
                value={filters.triggerExecution}
                onChange={(e) =>
                  setFilters((p) => ({
                    ...p,
                    triggerExecution: e.target.value,
                  }))
                }
                autoFocus
              />

              <div className="flex flex-col gap-1 pt-1 border-t border-base-200">
                <span className="font-semibold text-base-content/50 uppercase tracking-wider text-[10px] px-1">
                  Execution State
                </span>
                {(
                  [
                    { id: "all", label: "All" },
                    { id: "scheduled", label: "Scheduled / Active" },
                    { id: "soon", label: "Due soon (< 5m)" },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.id}
                    className="flex items-center gap-2 p-1 rounded hover:bg-base-200 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="filter-timing"
                      className="radio radio-xs radio-primary"
                      checked={filters.timing === opt.id}
                      onChange={() =>
                        setFilters((p) => ({
                          ...p,
                          timing: opt.id,
                        }))
                      }
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>

              {(filters.triggerExecution || filters.timing !== "all") && (
                <button
                  type="button"
                  className="btn btn-xs btn-ghost text-error self-end mt-1"
                  onClick={() =>
                    setFilters((p) => ({
                      ...p,
                      triggerExecution: "",
                      timing: "all",
                    }))
                  }
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {activeFilterCol === "broker" && (
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-semibold text-base-content/50 uppercase tracking-wider text-[10px] px-1">
                Filter by Broker
              </span>
              <label className="flex items-center gap-2 p-1 rounded hover:bg-base-200 cursor-pointer">
                <input
                  type="radio"
                  name="filter-broker"
                  className="radio radio-xs radio-primary"
                  checked={filters.broker === ""}
                  onChange={() =>
                    setFilters((p) => ({
                      ...p,
                      broker: "",
                    }))
                  }
                />
                <span>All Brokers</span>
              </label>
              {brokerOptions.map((bName) => (
                <label
                  key={bName}
                  className="flex items-center gap-2 p-1 rounded hover:bg-base-200 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="filter-broker"
                    className="radio radio-xs radio-primary"
                    checked={filters.broker === bName}
                    onChange={() =>
                      setFilters((p) => ({
                        ...p,
                        broker: bName,
                      }))
                    }
                  />
                  <span className="truncate">{bName}</span>
                </label>
              ))}
            </div>
          )}
        </FilterPopover>
      )}

      {/* ── Toast notification ── */}
      {toast && (
        <div className="toast toast-bottom toast-end z-50">
          <div
            className={`alert ${toast.ok ? "alert-success" : "alert-error"} text-xs py-2 px-3 shadow-lg`}
          >
            <span>{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}
