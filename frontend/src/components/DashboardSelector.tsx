import { useRef, useState, useEffect } from "react";
import { MdSearch } from "react-icons/md";
import { api } from "../api/client";
import type { Panel } from "../pages/DashboardPage";
import {
  buildDashboardExport,
  exportDashboard,
  parseDashboardImport,
} from "../utils/dashboardIO";
import {
  DASHBOARD_TEMPLATES,
  templateToImportPayload,
  type DashboardTemplate,
} from "../data/dashboardTemplates";

export interface Dashboard {
  id: string;
  name: string;
  created_at: string;
}

interface Props {
  dashboards: Dashboard[];
  activeDashboardId: string;
  onSwitch: (id: string) => void;
  onCreate: (d: Dashboard) => void;
  onRename: (d: Dashboard) => void;
  onDelete: (id: string) => void;
}

export default function DashboardSelector({
  dashboards,
  activeDashboardId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createValue, setCreateValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Close kebab menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus rename input when modal opens
  useEffect(() => {
    if (renameOpen) {
      setTimeout(() => renameInputRef.current?.focus(), 50);
    }
  }, [renameOpen]);

  // Focus create input when modal opens
  useEffect(() => {
    if (createOpen) {
      setTimeout(() => createInputRef.current?.focus(), 50);
    }
  }, [createOpen]);

  const activeDashboard = dashboards.find((d) => d.id === activeDashboardId);

  const q = query.trim().toLowerCase();
  const visibleDashboards = q
    ? dashboards.filter((d) => d.name.toLowerCase().includes(q))
    : dashboards;

  const openMenu = () => {
    setQuery("");
    setMenuOpen((o) => !o);
  };

  const closeMenu = () => {
    setMenuOpen(false);
    menuTriggerRef.current?.focus();
  };

  const pick = (id: string) => {
    closeMenu();
    if (id !== activeDashboardId) onSwitch(id);
  };

  const handleDuplicate = async () => {
    if (!activeDashboard || busy) return;
    setMenuOpen(false);
    setBusy(true);
    try {
      const panels = await api.get<Panel[]>(
        `/api/layouts?dashboard_id=${activeDashboardId}`,
      );
      const envelope = buildDashboardExport(
        `${activeDashboard.name} copy`,
        panels,
      );
      const d = await api.post<Dashboard>("/api/dashboards/import", envelope);
      onCreate(d);
    } catch (error) {
      void error;
    }
    setBusy(false);
  };

  const openCreate = () => {
    setCreateValue("");
    setImportError(null);
    setCreateOpen(true);
    setMenuOpen(false);
  };

  const openImport = () => {
    setMenuOpen(false);
    importInputRef.current?.click();
  };

  const handleCreate = async () => {
    const name = createValue.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const d = await api.post<Dashboard>("/api/dashboards", { name });
      onCreate(d);
      setCreateOpen(false);
      setCreateValue("");
    } catch (error) {
      void error;
    }
    setBusy(false);
  };

  const handleUseTemplate = async (template: DashboardTemplate) => {
    if (busy) return;
    setBusy(true);
    setImportError(null);
    try {
      const d = await api.post<Dashboard>(
        "/api/dashboards/import",
        templateToImportPayload(template),
      );
      onCreate(d);
      setCreateOpen(false);
      setCreateValue("");
    } catch (error) {
      void error;
      setImportError("Failed to create from template.");
    }
    setBusy(false);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file || busy) return;
    setBusy(true);
    setImportError(null);
    try {
      const text = await file.text();
      const { name, panels } = parseDashboardImport(text);
      const d = await api.post<Dashboard>("/api/dashboards/import", {
        type: "mqtt-dashboard-export",
        version: 1,
        name,
        panels,
      });
      onCreate(d);
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Failed to import dashboard.",
      );
      // Surface the error inside the create modal so it's visible.
      setCreateOpen(true);
    }
    setBusy(false);
  };

  const handleExport = async () => {
    if (!activeDashboard) return;
    setMenuOpen(false);
    try {
      const panels = await api.get<Panel[]>(
        `/api/layouts?dashboard_id=${activeDashboardId}`,
      );
      exportDashboard(activeDashboard.name, panels);
    } catch (error) {
      void error;
    }
  };

  const handleRename = async () => {
    const name = renameValue.trim();
    if (!name || !activeDashboard || busy) return;
    setBusy(true);
    try {
      const d = await api.put<Dashboard>(
        `/api/dashboards/${activeDashboardId}`,
        { name },
      );
      onRename(d);
      setRenameOpen(false);
    } catch (error) {
      void error;
    }
    setBusy(false);
  };

  const handleDelete = async () => {
    if (!activeDashboard || busy) return;
    setBusy(true);
    try {
      await api.delete(`/api/dashboards/${activeDashboardId}`);
      onDelete(activeDashboardId);
      setDeleteOpen(false);
    } catch (error) {
      void error;
    }
    setBusy(false);
  };

  return (
    <>
      <div
        className="relative min-w-0"
        ref={menuRef}
        onKeyDown={(e) => {
          if (e.key === "Escape") closeMenu();
        }}
      >
        <button
          ref={menuTriggerRef}
          className={`h-8 max-w-full flex items-center gap-2 pl-3 pr-2 rounded-lg border text-[12.5px] font-medium transition-colors ${
            menuOpen
              ? "bg-base-300 border-base-content/20"
              : "bg-base-200 border-base-300 hover:bg-base-300"
          }`}
          onClick={openMenu}
          title="Dashboard options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span className="truncate max-w-[6rem] sm:max-w-[10rem]">
            {activeDashboard?.name ?? "No dashboard"}
          </span>
          <span
            aria-hidden="true"
            className="w-0 h-0 shrink-0 border-x-[3.5px] border-x-transparent border-t-4 border-t-base-content/50"
          />
        </button>

        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleImportFile}
        />

        {menuOpen && (
          <div
            role="menu"
            aria-label="Dashboard options"
            className="fixed inset-x-2 top-[4.25rem] sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-1 sm:w-72 z-50 bg-base-100 border border-base-300 rounded-box shadow-lg"
          >
            <div className="p-2 pb-1">
              <label className="input input-sm w-full">
                <MdSearch className="text-base opacity-50" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && visibleDashboards[0]) {
                      pick(visibleDashboards[0].id);
                    }
                  }}
                  placeholder="Find a dashboard"
                />
              </label>
            </div>

            <ul
              aria-label="Dashboards"
              className="menu w-full p-2 max-h-64 flex-nowrap overflow-y-auto"
            >
              {dashboards.length === 0 ? (
                <li className="px-2 py-1 text-xs text-base-content/50">
                  No dashboards yet
                </li>
              ) : visibleDashboards.length === 0 ? (
                <li className="px-2 py-1 text-xs text-base-content/50">
                  No dashboard matches “{query}”
                </li>
              ) : (
                visibleDashboards.map((d) => {
                  const active = d.id === activeDashboardId;
                  return (
                    <li key={d.id} className="w-full min-w-0">
                      <button
                        role="menuitem"
                        className={`!flex w-full min-w-0 items-center gap-2 ${active ? "menu-active" : ""}`}
                        onClick={() => pick(d.id)}
                      >
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            active ? "bg-success" : "bg-base-content/25"
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate text-left">
                          {d.name}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>

            <div className="border-t border-base-300" />
            <ul className="menu w-full p-2">
              <li>
                <button role="menuitem" onClick={openCreate}>
                  New dashboard
                </button>
              </li>
              <li className="w-full min-w-0">
                <button
                  role="menuitem"
                  className="!flex w-full min-w-0 items-center justify-between"
                  onClick={openImport}
                >
                  <span>Import from file…</span>
                  <span className="text-xs text-base-content/40 shrink-0">
                    .json
                  </span>
                </button>
              </li>
              {activeDashboard && (
                <>
                  <li>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setRenameValue(activeDashboard.name);
                        setRenameOpen(true);
                        setMenuOpen(false);
                      }}
                    >
                      Rename
                    </button>
                  </li>
                  <li className="w-full min-w-0">
                    <button
                      role="menuitem"
                      className="!flex w-full min-w-0 items-center justify-between gap-2"
                      onClick={handleExport}
                    >
                      <span className="min-w-0 flex-1 truncate text-left">
                        Export “{activeDashboard.name}”
                      </span>
                      <span className="text-xs text-base-content/40 shrink-0">
                        .json
                      </span>
                    </button>
                  </li>
                  <li>
                    <button
                      role="menuitem"
                      onClick={handleDuplicate}
                      disabled={busy}
                    >
                      Duplicate
                    </button>
                  </li>
                </>
              )}
            </ul>
            {activeDashboard && (
              <div className="border-t border-base-300">
                <ul className="menu w-full p-2">
                  <li
                    className="w-full min-w-0"
                    title={
                      dashboards.length <= 1
                        ? "You need at least one dashboard — create another before deleting this one"
                        : undefined
                    }
                  >
                    <button
                      role="menuitem"
                      className="!flex w-full min-w-0 items-center text-error"
                      onClick={() => {
                        setDeleteOpen(true);
                        setMenuOpen(false);
                      }}
                      disabled={dashboards.length <= 1}
                    >
                      <span className="min-w-0 flex-1 truncate text-left">
                        Delete “{activeDashboard.name}”…
                      </span>
                      {dashboards.length <= 1 && (
                        <span className="text-xs text-base-content/40 shrink-0">
                          Last one
                        </span>
                      )}
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create modal */}
      {createOpen && (
        <div className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="font-bold text-lg mb-4">New Dashboard</h3>
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Name</legend>
              <input
                ref={createInputRef}
                type="text"
                className="input input-sm w-full"
                placeholder="Dashboard name"
                value={createValue}
                onChange={(e) => setCreateValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setCreateOpen(false);
                }}
              />
            </fieldset>

            {importError && (
              <p className="text-error text-sm mt-2">{importError}</p>
            )}

            <div className="divider text-xs text-base-content/50">
              or start from a template
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DASHBOARD_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  className="text-left border border-base-300 rounded-box p-2.5 hover:bg-base-200 hover:border-primary transition-colors disabled:opacity-50"
                  onClick={() => handleUseTemplate(template)}
                  disabled={busy}
                >
                  <div className="font-semibold text-sm mb-0.5">
                    {template.name}
                  </div>
                  <div className="text-xs text-base-content/60 line-clamp-2">
                    {template.description}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-xs text-base-content/40 mt-2">
              Templates use your default broker — edit panels afterwards to set
              the right broker and topics.
            </p>

            <div className="modal-action">
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={handleCreate}
                disabled={!createValue.trim() || busy}
              >
                {busy ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  "Create"
                )}
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop"
            onClick={() => setCreateOpen(false)}
          />
        </div>
      )}

      {/* Rename modal */}
      {renameOpen && (
        <div className="modal modal-open">
          <div className="modal-box max-w-sm">
            <h3 className="font-bold text-lg mb-4">Rename Dashboard</h3>
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Name</legend>
              <input
                ref={renameInputRef}
                type="text"
                className="input input-sm w-full"
                placeholder="Dashboard name"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") setRenameOpen(false);
                }}
              />
            </fieldset>
            <div className="modal-action">
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={handleRename}
                disabled={!renameValue.trim() || busy}
              >
                {busy ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  "Save"
                )}
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop"
            onClick={() => setRenameOpen(false)}
          />
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteOpen && activeDashboard && (
        <div className="modal modal-open">
          <div className="modal-box max-w-sm">
            <h3 className="font-bold text-lg mb-2">Delete Dashboard</h3>
            <p className="text-sm text-base-content/70 mb-4">
              Delete <strong>{activeDashboard.name}</strong>? All panels in this
              dashboard will be permanently removed.
            </p>
            <div className="modal-action">
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setDeleteOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-sm btn-error"
                onClick={handleDelete}
                disabled={busy}
              >
                {busy ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  "Delete"
                )}
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop"
            onClick={() => setDeleteOpen(false)}
          />
        </div>
      )}
    </>
  );
}
