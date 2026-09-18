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
import { api, type ScheduledJob } from "../api/client";
import { PRESETS, describeCron } from "../components/panels/cronUtils";

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

interface ColumnFilters {
  status: "all" | "active" | "paused";
  automation: string;
  topic: string;
  payload: string;
  qos: number | null;
  retain: boolean | null;
  schedule: string;
  nextRun: "all" | "scheduled" | "soon";
  broker: string;
}

const DEFAULT_FILTERS: ColumnFilters = {
  status: "all",
  automation: "",
  topic: "",
  payload: "",
  qos: null,
  retain: null,
  schedule: "",
  nextRun: "all",
  broker: "",
};

type SortKey =
  | "status"
  | "automation"
  | "topic"
  | "payload"
  | "schedule"
  | "next_run"
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
  // Ensure within window bounds with 8px margin
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
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
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
        api.getScheduledJobs(),
        api.getDashboards().catch(() => []),
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
      api.getScheduledJobs(),
      api.getDashboards().catch(() => []),
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

  const handleToggle = async (job: ScheduledJob) => {
    const nextEnabled = !job.enabled;
    setTogglingIds((prev) => new Set(prev).add(job.panel_id));

    // Optimistic update
    setJobs((prev) =>
      prev.map((j) =>
        j.panel_id === job.panel_id ? { ...j, enabled: nextEnabled } : j,
      ),
    );

    try {
      await api.toggleCronJob(job.panel_id, nextEnabled);
      const updated = await api.getScheduledJobs();
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
      filters.automation.trim() !== "" ||
      filters.topic.trim() !== "" ||
      filters.payload.trim() !== "" ||
      filters.qos !== null ||
      filters.retain !== null ||
      filters.schedule.trim() !== "" ||
      filters.nextRun !== "all" ||
      filters.broker !== ""
    );
  }, [filters]);

  const isColFiltered = (key: SortKey): boolean => {
    switch (key) {
      case "status":
        return filters.status !== "all";
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
      case "schedule":
        return filters.schedule.trim() !== "";
      case "next_run":
        return filters.nextRun !== "all";
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

  const brokerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) {
      if (j.broker_name) set.add(j.broker_name);
    }
    return Array.from(set).sort();
  }, [jobs]);

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
          job.topic.toLowerCase().includes(q) ||
          job.panel_title.toLowerCase().includes(q) ||
          job.dashboard_name.toLowerCase().includes(q) ||
          job.broker_name.toLowerCase().includes(q) ||
          job.cron_expr.toLowerCase().includes(q) ||
          job.payload.toLowerCase().includes(q);
        if (!matchesGlobal) return false;
      }

      // 2. Status filter
      if (filters.status === "active" && !job.enabled) return false;
      if (filters.status === "paused" && job.enabled) return false;

      // 3. Automation filter
      if (filters.automation.trim()) {
        const qa = filters.automation.toLowerCase();
        const matchesAuto =
          job.panel_title.toLowerCase().includes(qa) ||
          job.dashboard_name.toLowerCase().includes(qa);
        if (!matchesAuto) return false;
      }

      // 4. Topic filter
      if (filters.topic.trim()) {
        const qt = filters.topic.toLowerCase();
        if (!job.topic.toLowerCase().includes(qt)) return false;
      }

      // 5. Payload filter
      if (filters.payload.trim()) {
        const qp = filters.payload.toLowerCase();
        if (!job.payload.toLowerCase().includes(qp)) return false;
      }

      // 6. QoS filter
      if (filters.qos !== null && job.qos !== filters.qos) {
        return false;
      }

      // 7. Retain filter
      if (filters.retain !== null && job.retain !== filters.retain) {
        return false;
      }

      // 8. Schedule filter
      if (filters.schedule.trim()) {
        const qs = filters.schedule.toLowerCase();
        const matchesSched =
          job.cron_expr.toLowerCase().includes(qs) ||
          formatSchedule(job.cron_expr).toLowerCase().includes(qs);
        if (!matchesSched) return false;
      }

      // 9. Next run filter
      if (filters.nextRun === "scheduled") {
        if (!job.enabled || !job.next_run) return false;
      } else if (filters.nextRun === "soon") {
        if (!job.enabled || !job.next_run) return false;
        const diffMs = new Date(job.next_run).getTime() - currentTimeMs;
        if (diffMs > 5 * 60 * 1000 || diffMs < 0) return false;
      }

      // 10. Broker filter
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
          case "automation": {
            const strA = `${a.panel_title} ${a.dashboard_name}`.toLowerCase();
            const strB = `${b.panel_title} ${b.dashboard_name}`.toLowerCase();
            return strA.localeCompare(strB) * dir;
          }
          case "topic":
            return a.topic.localeCompare(b.topic) * dir;
          case "payload":
            return a.payload.localeCompare(b.payload) * dir;
          case "schedule":
            return a.cron_expr.localeCompare(b.cron_expr) * dir;
          case "next_run": {
            const timeA =
              a.enabled && a.next_run
                ? new Date(a.next_run).getTime()
                : dir === 1
                  ? Infinity
                  : -Infinity;
            const timeB =
              b.enabled && b.next_run
                ? new Date(b.next_run).getTime()
                : dir === 1
                  ? Infinity
                  : -Infinity;
            return (timeA - timeB) * dir;
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
  }, [jobs, searchQuery, filters, sort, currentTimeMs, selectedDashboardId]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-base-200/40">
      {/* ── Header bar ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-base-300 bg-base-100 shrink-0">
        <span className="text-sm font-medium text-base-content/60">Dashboard</span>
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
                    {/* ── Column: Go to Dashboard ──────── */}
                    <th className="w-10 text-center py-2.5 px-3 border-r border-base-300">
                      <span className="sr-only">Go to dashboard</span>
                    </th>

                    {/* ── Column: Status ────────────────── */}
                    <th className="py-2.5 px-4 w-28 border-r border-base-300">
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

                    {/* ── Column: Automation ────────────── */}
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

                    {/* ── Column: Topic ─────────────────── */}
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

                    {/* ── Column: Payload ───────────────── */}
                    <th className="py-2.5 px-4 min-w-[220px] flex-1 border-r border-base-300">
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

                    {/* ── Column: Schedule ──────────────── */}
                    <th className="py-2.5 px-4 min-w-[140px] border-r border-base-300">
                      <div className="flex items-center justify-between gap-1">
                        <button
                          type="button"
                          className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                          onClick={() => handleSort("schedule")}
                        >
                          <span>Schedule</span>
                          {sort.key === "schedule" ? (
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
                            isColFiltered("schedule")
                              ? "text-primary bg-primary/10"
                              : "text-base-content/40 hover:text-base-content"
                          }`}
                          onClick={(e) => handleOpenFilter("schedule", e)}
                          title="Filter schedule expression"
                        >
                          {isColFiltered("schedule") ? (
                            <RiFilter3Fill className="text-xs" />
                          ) : (
                            <RiFilter3Line className="text-xs" />
                          )}
                        </button>
                      </div>
                    </th>

                    {/* ── Column: Next Run ──────────────── */}
                    <th className="py-2.5 px-4 min-w-[130px] border-r border-base-300">
                      <div className="flex items-center justify-between gap-1">
                        <button
                          type="button"
                          className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                          onClick={() => handleSort("next_run")}
                        >
                          <span>Next Run</span>
                          {sort.key === "next_run" ? (
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
                            isColFiltered("next_run")
                              ? "text-primary bg-primary/10"
                              : "text-base-content/40 hover:text-base-content"
                          }`}
                          onClick={(e) => handleOpenFilter("next_run", e)}
                          title="Filter next run timing"
                        >
                          {isColFiltered("next_run") ? (
                            <RiFilter3Fill className="text-xs" />
                          ) : (
                            <RiFilter3Line className="text-xs" />
                          )}
                        </button>
                      </div>
                    </th>

                    {/* ── Column: Broker ────────────────── */}
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
                            Create a Cron panel on any dashboard to automate periodic MQTT
                            messages.
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
                      const topicList = job.topic
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
                          {/* Go to Panel */}
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

                          {/* Status dot + toggle */}
                          <td className="text-center align-middle py-3 px-4">
                            <div
                              className="tooltip tooltip-right inline-flex items-center gap-1.5"
                              data-tip={
                                job.enabled
                                  ? "Active — click to pause"
                                  : "Paused"
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

                          {/* Automation Name & Dashboard */}
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

                          {/* Topic (Separate Column with Truncation) */}
                          <td className="align-middle py-3 px-4 max-w-[200px]">
                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                              {topicList.map((t, idx) => (
                                <div
                                  key={idx}
                                  className="inline-flex items-center gap-1 font-mono text-xs max-w-full min-w-0"
                                >
                                  <Link
                                    to={`/explorer?topic=${encodeURIComponent(t)}${
                                      job.broker_id
                                        ? `&broker=${encodeURIComponent(job.broker_id)}`
                                        : ""
                                    }`}
                                    className="inline-flex items-center gap-1 font-mono text-xs text-accent font-medium max-w-full min-w-0 hover:underline group"
                                    title={`Show "${t}" in Explorer`}
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
                              ))}
                            </div>
                          </td>

                          {/* Payload (Separate Column with QoS/Retain Flags next to it & Ellipsis) */}
                          <td className="align-middle py-3 px-4 max-w-[280px]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {/* QoS flag next to payload */}
                              <span
                                className="badge badge-xs badge-neutral font-mono shrink-0"
                                title={`QoS ${job.qos}`}
                              >
                                Q{job.qos}
                              </span>

                              {/* Retain flag next to payload */}
                              {job.retain && (
                                <span
                                  className="badge badge-xs badge-warning font-mono shrink-0"
                                  title="Retained message"
                                >
                                  R
                                </span>
                              )}

                              {/* Payload snippet with Ellipsis */}
                              {job.payload ? (
                                <div
                                  className="flex items-center gap-1 bg-base-200/70 px-2 py-0.5 rounded font-mono text-[11px] text-base-content/80 min-w-0 flex-1 overflow-hidden"
                                  title={job.payload}
                                >
                                  <span className="truncate flex-1 block">
                                    {job.payload}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs btn-square h-4 w-4 min-h-0 text-base-content/40 hover:text-base-content shrink-0"
                                    title="Copy payload"
                                    onClick={() =>
                                      handleCopy(
                                        `payload-${job.panel_id}`,
                                        job.payload,
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

                          {/* Schedule */}
                          <td className="align-middle py-3 px-4">
                            <div className="flex flex-col gap-0.5 min-w-[130px]">
                              <div className="flex items-center gap-1 text-xs font-medium">
                                <MdSchedule className="text-xs text-base-content/50 shrink-0" />
                                <span>{formatSchedule(job.cron_expr)}</span>
                              </div>
                              <span className="font-mono text-[10px] text-base-content/40 pl-4">
                                {job.cron_expr}
                              </span>
                            </div>
                          </td>

                          {/* Next Run */}
                          <td className="align-middle whitespace-nowrap py-3 px-4">
                            {job.enabled && job.next_run ? (
                              <div
                                className="tooltip tooltip-top text-left"
                                data-tip={`Exact: ${formatExactTime(job.next_run)}${
                                  job.prev_run
                                    ? ` | Prev: ${formatExactTime(job.prev_run)}`
                                    : ""
                                }`}
                              >
                                <span className="text-primary font-medium text-xs block">
                                  {formatCountdown(job.next_run, currentTimeMs)}
                                </span>
                                <span className="text-[10px] text-base-content/40 block">
                                  {formatExactTime(job.next_run)}
                                </span>
                              </div>
                            ) : (
                              <span className="badge badge-xs badge-neutral">
                                paused
                              </span>
                            )}
                          </td>

                          {/* Broker */}
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

      {/* ── Portaled Filter Popover (Mounts in document.body to avoid table clipping & overflow) ── */}
      {activeFilterCol && (
        <FilterPopover
          anchorRect={filterAnchorRect}
          onClose={handleCloseFilter}
          width={
            activeFilterCol === "payload"
              ? 260
              : activeFilterCol === "broker"
                ? 220
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

          {activeFilterCol === "schedule" && (
            <div className="flex flex-col gap-2 text-xs">
              <span className="font-semibold text-base-content/50 uppercase tracking-wider text-[10px]">
                Filter Schedule
              </span>
              <input
                type="text"
                className="input input-xs input-bordered w-full font-mono"
                placeholder="e.g. * * * * * or hourly"
                value={filters.schedule}
                onChange={(e) =>
                  setFilters((p) => ({
                    ...p,
                    schedule: e.target.value,
                  }))
                }
                autoFocus
              />
              {filters.schedule && (
                <button
                  type="button"
                  className="btn btn-xs btn-ghost text-error self-end"
                  onClick={() => setFilters((p) => ({ ...p, schedule: "" }))}
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {activeFilterCol === "next_run" && (
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-semibold text-base-content/50 uppercase tracking-wider text-[10px] px-1">
                Next Execution
              </span>
              {(
                [
                  { id: "all", label: "All" },
                  { id: "scheduled", label: "Scheduled only" },
                  { id: "soon", label: "Due soon (< 5m)" },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.id}
                  className="flex items-center gap-2 p-1 rounded hover:bg-base-200 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="filter-nextrun"
                    className="radio radio-xs radio-primary"
                    checked={filters.nextRun === opt.id}
                    onChange={() =>
                      setFilters((p) => ({
                        ...p,
                        nextRun: opt.id,
                      }))
                    }
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          )}

          {activeFilterCol === "broker" && (
            <div className="flex flex-col gap-1 text-xs max-h-48 overflow-y-auto">
              <span className="font-semibold text-base-content/50 uppercase tracking-wider text-[10px] px-1">
                Broker
              </span>
              <label className="flex items-center gap-2 p-1 rounded hover:bg-base-200 cursor-pointer">
                <input
                  type="radio"
                  name="filter-broker"
                  className="radio radio-xs radio-primary"
                  checked={filters.broker === ""}
                  onChange={() => setFilters((p) => ({ ...p, broker: "" }))}
                />
                <span>All brokers</span>
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

      {/* Toast notifications */}
      {toast && (
        <div className="toast toast-top toast-end z-50">
          <div
            className={`alert ${toast.ok ? "alert-success" : "alert-error"}`}
          >
            <span>{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}
