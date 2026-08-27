import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { MdMenu, MdEdit, MdAdd, MdKeyboardArrowUp } from "react-icons/md";
import DashboardSelector, { type Dashboard } from "./DashboardSelector";
import { useBrokerStatuses, type BrokerStatus } from "../hooks/useBrokers";
// Injected by docker/dev/docker-compose-dev.yml, one per worktree
const worktreeSlug = import.meta.env.VITE_WORKTREE_SLUG;

import packageJson from "../../package.json";

const ACTIVE_DASHBOARD_KEY = "mqtt_active_dashboard_id";
import { api } from "../api/client";

type AggregatedStatus = "CONNECTED" | "PARTIALLY CONNECTED" | "DISCONNECTED";

function computeAggregated(statuses: BrokerStatus[]): AggregatedStatus {
  const enabled = statuses.filter((s) => s.is_enabled);
  if (enabled.length === 0) return "DISCONNECTED";
  const connected = enabled.filter((s) => s.status === "CONNECTED").length;
  if (connected === enabled.length) return "CONNECTED";
  if (connected > 0) return "PARTIALLY CONNECTED";
  return "DISCONNECTED";
}

const NAV_LINKS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/explorer", label: "Explorer" },
  { to: "/config", label: "Configuration" },
];

/** Chip surface for the aggregated broker state, per the Claude Design mock. */
const aggChipClass: Record<AggregatedStatus, string> = {
  CONNECTED: "bg-base-200 border-base-300 hover:bg-base-300",
  "PARTIALLY CONNECTED": "bg-warning/10 border-warning/40 hover:bg-warning/20",
  DISCONNECTED: "bg-error/10 border-error/40 hover:bg-error/20",
};

const aggTextClass: Record<AggregatedStatus, string> = {
  CONNECTED: "text-base-content/70",
  "PARTIALLY CONNECTED": "text-warning",
  DISCONNECTED: "text-error",
};

/** Short summary of how many enabled brokers are currently connected. */
function brokerSummary(statuses: BrokerStatus[]): string {
  const enabled = statuses.filter((s) => s.is_enabled);
  if (enabled.length === 0) return "No brokers";
  const connected = enabled.filter((s) => s.status === "CONNECTED").length;
  if (connected === enabled.length) return "All connected";
  if (connected === 0) return "All brokers offline";
  return `${connected} of ${enabled.length} connected`;
}

const statusDot: Record<string, string> = {
  CONNECTED: "bg-success",
  CONNECTING: "bg-warning animate-pulse",
  DISCONNECTED: "bg-error",
  ERROR: "bg-error",
  DISABLED: "bg-neutral",
};

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const brokerStatuses = useBrokerStatuses();
  const [showCredits, setShowCredits] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [panelLibraryOpen, setPanelLibraryOpen] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [activeDashboardId, setActiveDashboardId] = useState<string>(() => {
    return localStorage.getItem(ACTIVE_DASHBOARD_KEY) ?? "";
  });
  const [dashboardsLoading, setDashboardsLoading] = useState(true);
  const [backendReady, setBackendReady] = useState(false);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const flyoutTriggerRef = useRef<HTMLButtonElement>(null);
  const healthRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDashboard = location.pathname === "/dashboard";

  // Health check with retry until backend responds
  useEffect(() => {
    const check = () =>
      api
        .get("/api/health")
        .then(() => {
          setBackendReady(true);
          if (healthRetryRef.current) {
            clearInterval(healthRetryRef.current);
            healthRetryRef.current = null;
          }
        })
        .catch(() => {});
    check();
    healthRetryRef.current = setInterval(check, 3000);
    return () => {
      if (healthRetryRef.current) clearInterval(healthRetryRef.current);
    };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target as Node)) {
        setFlyoutOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Navbar keyboard shortcuts: ⌘K/Ctrl+K opens the panel library, F hides the
  // bar, Esc closes the broker flyout.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.tagName === "SELECT" ||
        el?.isContentEditable === true;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (!onDashboard || !editMode) return;
        e.preventDefault();
        setFlyoutOpen(false);
        setPanelLibraryOpen((o) => !o);
        return;
      }
      if (e.key === "Escape") {
        setFlyoutOpen(false);
        return;
      }
      if (typing) return;
      if (e.key.toLowerCase() === "f" && onDashboard) {
        e.preventDefault();
        setFlyoutOpen(false);
        setNavHidden((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDashboard, editMode]);

  useEffect(() => {
    if (!backendReady) return;
    api
      .get<Dashboard[]>("/api/dashboards")
      .then((list) => {
        setDashboards(list);
        const stored = localStorage.getItem(ACTIVE_DASHBOARD_KEY);
        const valid = list.find((d) => d.id === stored);
        const defaultId = valid ? stored! : (list[0]?.id ?? "");
        setActiveDashboardId(defaultId);
        localStorage.setItem(ACTIVE_DASHBOARD_KEY, defaultId);
      })
      .catch(() => {})
      .finally(() => setDashboardsLoading(false));
  }, [backendReady]);

  const switchDashboard = (id: string) => {
    setActiveDashboardId(id);
    if (id) {
      localStorage.setItem(ACTIVE_DASHBOARD_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_DASHBOARD_KEY);
    }
  };

  const handleCreate = (d: Dashboard) => {
    setDashboards((prev) => [...prev, d]);
    switchDashboard(d.id);
  };

  const handleRename = (d: Dashboard) => {
    setDashboards((prev) => prev.map((x) => (x.id === d.id ? d : x)));
  };

  const handleDelete = (id: string) => {
    setDashboards((prev) => {
      const remaining = prev.filter((d) => d.id !== id);
      switchDashboard(remaining[0]?.id ?? "");
      return remaining;
    });
  };

  const showDashboardControls = onDashboard;
  const aggStatus = computeAggregated(brokerStatuses);
  const barHidden = navHidden && showDashboardControls;
  const visibleBrokers = brokerStatuses.slice(0, 6);

  return (
    <div className="min-h-screen flex flex-col">
      {showCredits && (
        <div className="modal modal-open">
          <div className="modal-box max-w-sm">
            <div className="flex items-center gap-3 mb-4">
              <img
                src="/logo.svg"
                alt="mqtt-dashboard"
                className="h-8 w-auto"
              />
              <div>
                <h3 className="font-bold text-lg leading-tight">
                  MQTT Dashboard
                </h3>
                <p className="text-xs text-base-content/60">
                  Version {packageJson.version}
                </p>
              </div>
            </div>

            <div>
              <p className="mb-2">
                This project was made by{" "}
                <a
                  href="https://github.com/jmischler72"
                  target="_blank"
                  rel="noreferrer"
                  className="link font-semibold"
                >
                  @jmischler72
                </a>{" "}
                and is open source on{" "}
                <a
                  href="https://github.com/jmischler72/mqtt-dashboard"
                  target="_blank"
                  rel="noreferrer"
                  className="link"
                >
                  GitHub
                </a>
                .
              </p>
              <p className="mb-2 text-base-content/70">
                Thanks for checking it out!
              </p>
            </div>

            {/* Worktree slug in dev environment */}
            {import.meta.env.DEV && worktreeSlug && (
              <div className="mt-4 pt-3 border-t border-base-300 flex items-center gap-2 text-xs">
                <span className="text-base-content/60">Worktree:</span>
                <span className="badge badge-sm badge-primary font-mono">
                  {worktreeSlug}
                </span>
              </div>
            )}

            <div className="modal-action">
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setShowCredits(false)}
              >
                Ok
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop"
            onClick={() => setShowCredits(false)}
          />
        </div>
      )}
      <div className="sticky top-0 z-40 relative">
        {barHidden && (
          /* Focus mode, per the Claude Design mock: the bar collapses to a thin
             strip that keeps the edit accent and broker health visible. */
          <button
            type="button"
            onMouseEnter={() => {
              peekTimerRef.current = setTimeout(() => setNavHidden(false), 260);
            }}
            onMouseLeave={() => {
              if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
            }}
            onClick={() => setNavHidden(false)}
            title="Show navbar (F)"
            aria-label="Show navbar"
            className="group relative w-full h-2.5 flex items-center justify-between px-4 bg-base-200 border-b border-base-300"
          >
            {editMode && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-0.5 bg-primary"
              />
            )}
            <span className="h-[3px] w-6 rounded-full bg-base-content/20 transition-colors group-hover:bg-base-content/40" />
            <span className="flex items-center gap-1">
              {visibleBrokers.map((bs) => (
                <span
                  key={bs.id}
                  className={`w-[5px] h-[5px] rounded-full ${statusDot[bs.status] ?? "bg-neutral"}`}
                />
              ))}
            </span>
          </button>
        )}
        <nav
          className={`navbar bg-base-100 border-b border-base-300 px-4 gap-2 ${barHidden ? "hidden" : ""}`}
        >
          {editMode && (
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-0.5 bg-primary"
            />
          )}
          <img
            src="/logo.svg"
            alt="mqtt-dashboard"
            className="h-8 w-auto mx-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => setShowCredits(!showCredits)}
          />

          {/* Mobile: nav links collapse into a hamburger dropdown */}
          <div className="dropdown sm:hidden">
            <button
              tabIndex={0}
              className="btn btn-sm btn-ghost"
              aria-label="Open navigation menu"
            >
              <MdMenu className="text-xl" />
            </button>
            <ul
              tabIndex={0}
              className="dropdown-content menu bg-base-100 border border-base-300 rounded-box z-50 mt-1 w-44 p-2 shadow"
            >
              {NAV_LINKS.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    className={({ isActive }) => (isActive ? "active" : "")}
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>

          {/* Desktop: inline nav links */}
          <div className="hidden sm:flex items-center gap-2">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `btn btn-sm btn-ghost ${isActive ? "btn-active" : ""}`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1 sm:gap-2 min-w-0">
            {showDashboardControls && !dashboardsLoading && (
              <DashboardSelector
                dashboards={dashboards}
                activeDashboardId={activeDashboardId}
                onSwitch={switchDashboard}
                onCreate={handleCreate}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            )}

            {showDashboardControls && (
              <>
                <div
                  aria-hidden="true"
                  className="hidden sm:block h-6 w-px bg-base-300 mx-1"
                />
                {editMode ? (
                  <>
                    <button
                      className="btn btn-sm btn-primary gap-1.5"
                      onClick={() => setPanelLibraryOpen(true)}
                      title="Add panel (⌘K)"
                    >
                      <MdAdd className="text-base" />
                      <span className="hidden sm:inline">Add panel</span>
                      <kbd className="kbd kbd-xs hidden md:inline-flex">⌘K</kbd>
                    </button>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => {
                        setEditMode(false);
                        setPanelLibraryOpen(false);
                      }}
                    >
                      Done
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-sm btn-outline gap-1.5"
                    onClick={() => setEditMode(true)}
                  >
                    <MdEdit className="text-base" />
                    <span className="hidden sm:inline">Edit layout</span>
                  </button>
                )}
              </>
            )}

            {/* Aggregated broker status with flyout */}
            <div
              aria-hidden="true"
              className="hidden sm:block h-6 w-px bg-base-300 mx-1"
            />
            <div
              className="relative shrink-0"
              ref={flyoutRef}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setFlyoutOpen(false);
                  flyoutTriggerRef.current?.focus();
                }
              }}
            >
              <button
                ref={flyoutTriggerRef}
                className={`h-8 shrink-0 flex items-center gap-2 pl-2.5 pr-2 rounded-lg border transition-colors ${aggChipClass[aggStatus]} ${flyoutOpen ? "brightness-95" : ""}`}
                onClick={() => setFlyoutOpen((o) => !o)}
                title="Broker status"
                aria-haspopup="menu"
                aria-expanded={flyoutOpen}
              >
                <span className="flex items-center gap-[3px]">
                  {visibleBrokers.length === 0 ? (
                    <span className="w-[5px] h-3 rounded-[2px] bg-neutral" />
                  ) : (
                    visibleBrokers.map((bs, i) => (
                      <span
                        key={bs.id}
                        className={`w-[5px] h-3 rounded-[2px] ${i >= 3 ? "hidden sm:block" : ""} ${statusDot[bs.status] ?? "bg-neutral"}`}
                      />
                    ))
                  )}
                  {brokerStatuses.length > visibleBrokers.length && (
                    <span className="hidden sm:inline text-[10px] leading-none text-base-content/40 tabular-nums">
                      +{brokerStatuses.length - visibleBrokers.length}
                    </span>
                  )}
                </span>
                <span
                  className={`hidden sm:inline text-xs tabular-nums ${aggTextClass[aggStatus]}`}
                >
                  {brokerSummary(brokerStatuses)}
                </span>
                <span
                  aria-hidden="true"
                  className="w-0 h-0 border-x-[3.5px] border-x-transparent border-t-4 border-t-base-content/50"
                />
              </button>

              {flyoutOpen && (
                <div
                  role="menu"
                  aria-label="Broker status"
                  className="absolute right-0 top-full mt-1 z-50 w-[min(18rem,calc(100vw-1rem))] bg-base-100 border border-base-300 rounded-box shadow-lg"
                >
                  <div className="flex items-center justify-between px-4 pt-3 pb-1">
                    <span className="text-xs uppercase tracking-wider text-base-content/50">
                      MQTT brokers
                    </span>
                    <span className="text-xs text-base-content/50">
                      {brokerStatuses.length} configured
                    </span>
                  </div>

                  {brokerStatuses.length === 0 ? (
                    <p className="text-xs text-base-content/50 px-4 pb-3">
                      No brokers configured
                    </p>
                  ) : (
                    <ul className="menu w-full p-2">
                      {brokerStatuses.map((bs) => (
                        <li key={bs.id} className="w-full min-w-0">
                          <button
                            role="menuitem"
                            className="!flex w-full min-w-0 items-center gap-2"
                            onClick={() => {
                              navigate(
                                `/config?broker=${encodeURIComponent(bs.id)}`,
                              );
                              setFlyoutOpen(false);
                              flyoutTriggerRef.current?.focus();
                            }}
                          >
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${statusDot[bs.status] ?? "bg-neutral"}`}
                            />
                            <span className="flex flex-col min-w-0 flex-1">
                              <span className="text-sm truncate">
                                {bs.name}
                              </span>
                              <span className="text-xs text-base-content/50 truncate">
                                {bs.status_error ??
                                  (bs.is_enabled ? "Enabled" : "Disabled")}
                              </span>
                            </span>
                            <span className="text-xs text-base-content/50 shrink-0">
                              {bs.status}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="border-t border-base-300">
                    <ul className="menu w-full p-2">
                      <li className="w-full min-w-0">
                        <button
                          role="menuitem"
                          className="!flex w-full min-w-0 items-center justify-between"
                          onClick={() => {
                            navigate("/config");
                            setFlyoutOpen(false);
                            flyoutTriggerRef.current?.focus();
                          }}
                        >
                          <span className="text-sm">Manage brokers</span>
                          <span className="text-xs text-base-content/40 shrink-0">
                            Configuration
                          </span>
                        </button>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </nav>

        {showDashboardControls && !barHidden && (
          <button
            onClick={() => setNavHidden(true)}
            title="Hide navbar (F)"
            aria-label="Hide navbar"
            className="absolute left-2 top-full flex items-center justify-center w-7 h-5 bg-base-100 border-l border-r border-b border-base-300 rounded-b-md text-base-content/60 hover:text-base-content"
          >
            <MdKeyboardArrowUp className="text-base" />
          </button>
        )}
      </div>

      {/* Focus mode still needs the edit controls: float them over the grid. */}
      {barHidden && editMode && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 h-11 pl-3.5 pr-1.5 rounded-full bg-base-100 border border-base-300 shadow-xl">
          <span className="flex items-center gap-2 pr-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span className="text-xs text-base-content/70">Editing</span>
          </span>
          <button
            className="btn btn-sm btn-primary rounded-full gap-1.5"
            onClick={() => setPanelLibraryOpen(true)}
            title="Add panel (⌘K)"
          >
            <MdAdd className="text-base" />
            Add panel
          </button>
          <button
            className="btn btn-sm btn-outline rounded-full"
            onClick={() => {
              setEditMode(false);
              setPanelLibraryOpen(false);
            }}
          >
            Done
          </button>
        </div>
      )}
      <main className="flex-1">
        {!backendReady ? (
          <div className="flex items-center justify-center h-64 text-base-content/60">
            <div className="text-center">
              <span className="loading loading-spinner loading-lg mb-4" />
              <p className="text-xl">Connecting to backend...</p>
            </div>
          </div>
        ) : (
          <Outlet
            context={{
              editMode,
              setEditMode,
              activeDashboardId,
              dashboardsLoading,
              hasDashboards: dashboards.length > 0,
              brokerStatuses,
              panelLibraryOpen,
              setPanelLibraryOpen,
            }}
          />
        )}
      </main>
    </div>
  );
}
