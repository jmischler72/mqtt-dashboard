import { useEffect, useMemo, useState } from "react";
import { MdClose, MdSearch } from "react-icons/md";
import {
  getAllPanels,
  type PanelCategory,
  type PanelDefinition,
} from "./panels";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (panelType: string) => void;
}

type Filter = "all" | PanelCategory;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "monitor", label: "Monitor" },
  { id: "control", label: "Control" },
  { id: "visual", label: "Visual" },
];

function PanelLibraryModalInner({ onClose, onPick }: Omit<Props, "open">) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const counts = useMemo(() => {
    const all = getAllPanels();
    return {
      all: all.length,
      monitor: all.filter((p) => p.category === "monitor").length,
      control: all.filter((p) => p.category === "control").length,
      visual: all.filter((p) => p.category === "visual").length,
    } as Record<Filter, number>;
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return getAllPanels().filter((p) => {
      if (filter !== "all" && p.category !== filter) return false;
      if (!q) return true;
      return (
        p.label.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [query, filter]);

  const pick = (p: PanelDefinition) => {
    onPick(p.type);
    onClose();
  };

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 h-12 border-b border-base-300">
          <MdSearch className="text-base-content/60 text-lg" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search panels…"
            className="flex-1 bg-transparent outline-none text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && items.length > 0) pick(items[0]);
            }}
          />
          <button
            onClick={onClose}
            className="text-xs text-base-content/50 hover:text-base-content border border-base-300 rounded px-2 py-0.5"
            title="Close (Esc)"
          >
            ESC
          </button>
        </div>

        <div className="flex items-stretch min-h-[280px] max-h-[60vh]">
          <div className="w-36 shrink-0 border-r border-base-300 p-2 flex flex-col gap-1">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`flex items-center justify-between text-left px-2 py-1.5 rounded text-sm ${
                    active
                      ? "bg-primary/15 text-primary"
                      : "hover:bg-base-200 text-base-content/80"
                  }`}
                >
                  <span>{f.label}</span>
                  <span className="text-xs tabular-nums text-base-content/50">
                    {counts[f.id]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-auto p-2">
            {items.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-base-content/50">
                No panels match "{query}"
              </div>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {items.map((p) => {
                  const Icon = p.icon;
                  return (
                    <li key={p.type}>
                      <button
                        onClick={() => pick(p)}
                        className="w-full h-full flex flex-col items-start gap-2 p-3 rounded-lg border border-base-300 bg-base-200/40 hover:bg-base-200 hover:border-primary/60 text-left transition-colors"
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="w-8 h-8 rounded-md bg-base-100 border border-base-300 flex items-center justify-center shrink-0">
                            <Icon size={16} className="text-base-content/70" />
                          </span>
                          <span className="text-[9.5px] uppercase tracking-widest text-base-content/40">
                            {p.category}
                          </span>
                        </div>
                        <div className="flex flex-col leading-tight min-w-0 w-full">
                          <span className="text-[13px] font-medium truncate">
                            {p.label}
                          </span>
                          {p.description && (
                            <span className="text-[10.5px] text-base-content/55 line-clamp-2">
                              {p.description}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <button
          onClick={onClose}
          className="btn btn-sm btn-ghost btn-circle absolute top-2 right-2 sm:hidden"
          aria-label="Close"
        >
          <MdClose />
        </button>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}

export default function PanelLibraryModal({ open, onClose, onPick }: Props) {
  if (!open) return null;
  return <PanelLibraryModalInner onClose={onClose} onPick={onPick} />;
}
