import { useRef, useState, useEffect } from "react";
import { api } from "../api/client";

export interface Dashboard {
  id: string;
  name: string;
  created_at: string;
}

interface Props {
  dashboards: Dashboard[];
  activeDashboardId: string;
  editMode: boolean;
  onSwitch: (id: string) => void;
  onCreate: (d: Dashboard) => void;
  onRename: (d: Dashboard) => void;
  onDelete: (id: string) => void;
}

const CREATE_NEW = "__create_new__";

export default function DashboardSelector({
  dashboards,
  activeDashboardId,
  editMode,
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
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

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

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === CREATE_NEW) {
      setCreateValue("");
      setCreateOpen(true);
      // Reset the select visually back to the active one
      e.target.value = activeDashboardId;
    } else if (val !== activeDashboardId) {
      onSwitch(val);
    }
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
    } catch {}
    setBusy(false);
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
    } catch {}
    setBusy(false);
  };

  const handleDelete = async () => {
    if (!activeDashboard || busy) return;
    setBusy(true);
    try {
      await api.delete(`/api/dashboards/${activeDashboardId}`);
      onDelete(activeDashboardId);
      setDeleteOpen(false);
    } catch {}
    setBusy(false);
  };

  return (
    <>
      <div className="flex items-center gap-1">
        {/* Dashboard select */}
        <select
          className="select select-sm"
          value={activeDashboardId}
          onChange={handleSelectChange}
        >
          {dashboards.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value={CREATE_NEW}>＋ Create New Dashboard</option>
        </select>

        {/* Kebab menu — only in edit mode */}
        {editMode && activeDashboard && (
          <div className="relative" ref={menuRef}>
            <button
              className="btn btn-sm btn-ghost btn-square"
              onClick={() => setMenuOpen((o) => !o)}
              title="Dashboard options"
            >
              ⋮
            </button>
            {menuOpen && (
              <ul className="absolute top-full right-0 mt-1 bg-base-100 border border-base-300 rounded-box z-50 w-36 p-1 shadow">
                <li>
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-base-200 rounded text-sm"
                    onClick={() => {
                      setRenameValue(activeDashboard.name);
                      setRenameOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    Rename
                  </button>
                </li>
                <li>
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-base-200 rounded text-sm text-error"
                    onClick={() => {
                      setDeleteOpen(true);
                      setMenuOpen(false);
                    }}
                    disabled={dashboards.length <= 1}
                  >
                    Delete
                  </button>
                </li>
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Create modal */}
      {createOpen && (
        <div className="modal modal-open">
          <div className="modal-box max-w-sm">
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
