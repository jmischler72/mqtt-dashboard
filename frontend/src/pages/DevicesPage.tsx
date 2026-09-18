import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { MdSearch, MdRefresh, MdDevices } from "react-icons/md";
import {
  RiArrowUpLine,
  RiArrowDownLine,
  RiArrowUpDownLine,
  RiFilter3Line,
  RiFilter3Fill,
  RiExternalLinkLine,
} from "react-icons/ri";
import { api, type Device } from "../api/client";
import { useBrokerStatuses } from "../hooks/useBrokers";
import DeviceDetailDrawer from "../components/devices/DeviceDetailDrawer";

function formatTimeAgo(dateStr?: string): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  if (isNaN(diffMs) || diffMs < 0) return "just now";
  const s = Math.floor(diffMs / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

interface ColumnFilters {
  status: "all" | "online" | "offline";
  name: string;
  convention: string;
  ip: string;
  mac: string;
  hardware: string;
}

const DEFAULT_FILTERS: ColumnFilters = {
  status: "all",
  name: "",
  convention: "",
  ip: "",
  mac: "",
  hardware: "",
};

type SortKey =
  "status" | "name" | "convention" | "ip" | "mac" | "hardware" | "last_seen";

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

export default function DevicesPage() {
  const brokerStatuses = useBrokerStatuses();
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<ColumnFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortState>({ key: null, order: null });
  const [activeFilterCol, setActiveFilterCol] = useState<SortKey | null>(null);
  const [filterAnchorRect, setFilterAnchorRect] = useState<DOMRect | null>(
    null,
  );

  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const effectiveBrokerId = useMemo(() => {
    if (selectedBrokerId) return selectedBrokerId;
    const firstConnected = brokerStatuses.find(
      (b) => b.is_enabled && b.status === "CONNECTED",
    );
    if (firstConnected) return firstConnected.id;
    const firstEnabled = brokerStatuses.find((b) => b.is_enabled);
    if (firstEnabled) return firstEnabled.id;
    return brokerStatuses[0]?.id ?? "";
  }, [selectedBrokerId, brokerStatuses]);

  // Derive selectedDevice directly from devices array
  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );

  // Load devices
  const fetchDevices = useCallback(async () => {
    if (!effectiveBrokerId) {
      setDevices([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api.getDevices(effectiveBrokerId);
      setDevices(data);
    } catch {
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveBrokerId]);

  useEffect(() => {
    let cancelled = false;
    if (!effectiveBrokerId) {
      return;
    }

    api
      .getDevices(effectiveBrokerId)
      .then((data) => {
        if (!cancelled) setDevices(data);
      })
      .catch(() => {
        if (!cancelled) setDevices([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const interval = setInterval(() => {
      api
        .getDevices(effectiveBrokerId)
        .then((data) => {
          if (!cancelled) setDevices(data);
        })
        .catch(() => {});
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [effectiveBrokerId]);

  // Sorting handler
  const handleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, order: "asc" };
      if (prev.order === "asc") return { key, order: "desc" };
      return { key: null, order: null };
    });
  };

  const handleOpenFilter = (key: SortKey, e: React.MouseEvent<HTMLElement>) => {
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

  const handleResetAllFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSearchQuery("");
  };

  const isColFiltered = (key: SortKey): boolean => {
    switch (key) {
      case "status":
        return filters.status !== "all";
      case "name":
        return filters.name.trim() !== "";
      case "convention":
        return filters.convention.trim() !== "";
      case "ip":
        return filters.ip.trim() !== "";
      case "mac":
        return filters.mac.trim() !== "";
      case "hardware":
        return filters.hardware.trim() !== "";
      default:
        return false;
    }
  };

  const isAnyFilterActive =
    filters.status !== "all" ||
    filters.name.trim() !== "" ||
    filters.convention.trim() !== "" ||
    filters.ip.trim() !== "" ||
    filters.mac.trim() !== "" ||
    filters.hardware.trim() !== "";

  // Filter and Sort devices
  const displayedDevices = useMemo(() => {
    let result = [...devices];

    // Global Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.id.toLowerCase().includes(q) ||
          d.ip_address.toLowerCase().includes(q) ||
          d.mac_address.toLowerCase().includes(q) ||
          d.hardware.toLowerCase().includes(q) ||
          d.base_topic.toLowerCase().includes(q) ||
          d.convention.toLowerCase().includes(q),
      );
    }

    // Column Filters
    if (filters.status !== "all") {
      result = result.filter((d) => d.status === filters.status);
    }
    if (filters.name.trim()) {
      const q = filters.name.toLowerCase();
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q),
      );
    }
    if (filters.convention.trim()) {
      const q = filters.convention.toLowerCase();
      result = result.filter((d) => d.convention.toLowerCase() === q);
    }
    if (filters.ip.trim()) {
      const q = filters.ip.toLowerCase();
      result = result.filter((d) => d.ip_address.toLowerCase().includes(q));
    }
    if (filters.mac.trim()) {
      const q = filters.mac.toLowerCase();
      result = result.filter((d) => d.mac_address.toLowerCase().includes(q));
    }
    if (filters.hardware.trim()) {
      const q = filters.hardware.toLowerCase();
      result = result.filter((d) => d.hardware.toLowerCase().includes(q));
    }

    // Sorting
    if (sort.key && sort.order) {
      result.sort((a, b) => {
        let cmp = 0;
        switch (sort.key) {
          case "status":
            cmp = a.status.localeCompare(b.status);
            break;
          case "name":
            cmp = a.name.localeCompare(b.name);
            break;
          case "convention":
            cmp = a.convention.localeCompare(b.convention);
            break;
          case "ip":
            cmp = a.ip_address.localeCompare(b.ip_address);
            break;
          case "mac":
            cmp = a.mac_address.localeCompare(b.mac_address);
            break;
          case "hardware":
            cmp = a.hardware.localeCompare(b.hardware);
            break;
          case "last_seen":
            cmp =
              new Date(a.last_seen).getTime() - new Date(b.last_seen).getTime();
            break;
        }
        return sort.order === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [devices, searchQuery, filters, sort]);

  const conventionBadgeClass: Record<string, string> = {
    homie: "badge-secondary",
    esphome: "badge-info",
    homeassistant: "badge-primary",
    tasmota: "badge-warning",
    generic: "badge-ghost",
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-base-200/40">
      {/* ── Header bar ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-base-300 bg-base-100 shrink-0">
        <span className="text-sm font-medium text-base-content/60">Broker</span>
        <select
          className="select select-bordered select-sm"
          value={effectiveBrokerId}
          onChange={(e) => setSelectedBrokerId(e.target.value)}
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
          {searchQuery.trim() || isAnyFilterActive
            ? `${displayedDevices.length} of ${devices.length} devices`
            : `${devices.length} devices discovered`}
        </span>

        {/* Right side controls */}
        <div className="ml-auto flex items-center gap-3">
          {/* Active Filter Counter & Reset */}
          {(isAnyFilterActive || searchQuery) && (
            <div className="flex items-center gap-2">
              <span className="badge badge-sm badge-ghost text-xs">
                Showing {displayedDevices.length} of {devices.length}
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

          {/* Global Search Box */}
          <div className="relative w-64">
            <MdSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/40 text-sm pointer-events-none" />
            <input
              type="text"
              placeholder="Search name, MAC, IP, topic..."
              className="input input-sm input-bordered w-full pl-8 pr-7 text-xs"
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

          {/* Refresh / Rescan Action */}
          <div
            className="tooltip tooltip-left"
            data-tip="Refresh & Rescan Fleet"
          >
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-square"
              onClick={fetchDevices}
              disabled={loading}
            >
              <MdRefresh
                className={`text-base ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Content Area ──────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6 bg-base-200/40">
        <div className="card bg-base-100 border border-base-300 shadow-sm overflow-hidden w-full">
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr className="border-b border-base-300 text-xs bg-base-200/50">
                  {/* ── Status ─────────────────────── */}
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

                  {/* ── Device Name & ID ───────────── */}
                  <th className="py-2.5 px-4 min-w-[180px] border-r border-base-300">
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                        onClick={() => handleSort("name")}
                      >
                        <span>Device</span>
                        {sort.key === "name" ? (
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
                          isColFiltered("name")
                            ? "text-primary bg-primary/10"
                            : "text-base-content/40 hover:text-base-content"
                        }`}
                        onClick={(e) => handleOpenFilter("name", e)}
                        title="Filter by name or ID"
                      >
                        {isColFiltered("name") ? (
                          <RiFilter3Fill className="text-xs" />
                        ) : (
                          <RiFilter3Line className="text-xs" />
                        )}
                      </button>
                    </div>
                  </th>

                  {/* ── Convention ─────────────────── */}
                  <th className="py-2.5 px-4 w-32 border-r border-base-300">
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                        onClick={() => handleSort("convention")}
                      >
                        <span>Convention</span>
                        {sort.key === "convention" ? (
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
                          isColFiltered("convention")
                            ? "text-primary bg-primary/10"
                            : "text-base-content/40 hover:text-base-content"
                        }`}
                        onClick={(e) => handleOpenFilter("convention", e)}
                        title="Filter by convention"
                      >
                        {isColFiltered("convention") ? (
                          <RiFilter3Fill className="text-xs" />
                        ) : (
                          <RiFilter3Line className="text-xs" />
                        )}
                      </button>
                    </div>
                  </th>

                  {/* ── IP Address ─────────────────── */}
                  <th className="py-2.5 px-4 w-36 border-r border-base-300">
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                        onClick={() => handleSort("ip")}
                      >
                        <span>IP Address</span>
                        {sort.key === "ip" ? (
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
                          isColFiltered("ip")
                            ? "text-primary bg-primary/10"
                            : "text-base-content/40 hover:text-base-content"
                        }`}
                        onClick={(e) => handleOpenFilter("ip", e)}
                        title="Filter by IP"
                      >
                        {isColFiltered("ip") ? (
                          <RiFilter3Fill className="text-xs" />
                        ) : (
                          <RiFilter3Line className="text-xs" />
                        )}
                      </button>
                    </div>
                  </th>

                  {/* ── MAC Address ────────────────── */}
                  <th className="py-2.5 px-4 w-40 border-r border-base-300">
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                        onClick={() => handleSort("mac")}
                      >
                        <span>MAC Address</span>
                        {sort.key === "mac" ? (
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
                          isColFiltered("mac")
                            ? "text-primary bg-primary/10"
                            : "text-base-content/40 hover:text-base-content"
                        }`}
                        onClick={(e) => handleOpenFilter("mac", e)}
                        title="Filter by MAC"
                      >
                        {isColFiltered("mac") ? (
                          <RiFilter3Fill className="text-xs" />
                        ) : (
                          <RiFilter3Line className="text-xs" />
                        )}
                      </button>
                    </div>
                  </th>

                  {/* ── Hardware / Model ───────────── */}
                  <th className="py-2.5 px-4 min-w-[140px] border-r border-base-300">
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                        onClick={() => handleSort("hardware")}
                      >
                        <span>Hardware</span>
                        {sort.key === "hardware" ? (
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
                          isColFiltered("hardware")
                            ? "text-primary bg-primary/10"
                            : "text-base-content/40 hover:text-base-content"
                        }`}
                        onClick={(e) => handleOpenFilter("hardware", e)}
                        title="Filter by Hardware"
                      >
                        {isColFiltered("hardware") ? (
                          <RiFilter3Fill className="text-xs" />
                        ) : (
                          <RiFilter3Line className="text-xs" />
                        )}
                      </button>
                    </div>
                  </th>

                  {/* ── Last Seen ──────────────────── */}
                  <th className="py-2.5 px-4 w-28 border-r border-base-300">
                    <button
                      type="button"
                      className="flex items-center gap-1 font-semibold text-base-content/70 hover:text-base-content select-none group"
                      onClick={() => handleSort("last_seen")}
                    >
                      <span>Last Seen</span>
                      {sort.key === "last_seen" ? (
                        sort.order === "asc" ? (
                          <RiArrowUpLine className="text-primary text-sm shrink-0" />
                        ) : (
                          <RiArrowDownLine className="text-primary text-sm shrink-0" />
                        )
                      ) : (
                        <RiArrowUpDownLine className="text-base-content/20 group-hover:text-base-content/50 text-xs shrink-0" />
                      )}
                    </button>
                  </th>

                  {/* ── Actions ────────────────────── */}
                  <th className="py-2.5 px-3 w-16 text-center">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-base-200">
                {loading && devices.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-16 text-center text-xs text-base-content/50"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <span className="loading loading-spinner loading-sm" />
                        <span>Discovering devices...</span>
                      </div>
                    </td>
                  </tr>
                ) : devices.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-16 text-center text-xs text-base-content/50"
                    >
                      <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                        <MdDevices className="text-4xl text-base-content/30" />
                        <p className="text-base font-semibold text-base-content/70">
                          No devices discovered yet
                        </p>
                        <p className="text-xs text-base-content/50">
                          Connected devices publishing with Homie, ESPHome, Home
                          Assistant Discovery, or status topics will be
                          automatically discovered here.
                        </p>
                        <button
                          type="button"
                          className="btn btn-xs btn-primary mt-2 gap-1.5"
                          onClick={fetchDevices}
                        >
                          <MdRefresh className="text-xs" />
                          <span>Rescan Broker</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : displayedDevices.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-12 text-center text-xs text-base-content/50"
                    >
                      <p className="font-medium">No matching devices</p>
                      <p className="text-[11px] text-base-content/40 mt-1">
                        Try adjusting or clearing your search and filters.
                      </p>
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost text-primary mt-2"
                        onClick={handleResetAllFilters}
                      >
                        Reset filters
                      </button>
                    </td>
                  </tr>
                ) : (
                  displayedDevices.map((dev) => {
                    const isOnline = dev.status === "online";
                    const isSelected = selectedDeviceId === dev.id;

                    return (
                      <tr
                        key={dev.id}
                        onClick={() => setSelectedDeviceId(dev.id)}
                        className={`border-b border-base-200 hover:bg-base-200/50 cursor-pointer text-xs ${
                          isSelected ? "bg-primary/5" : ""
                        }`}
                      >
                        {/* Status */}
                        <td className="py-3 px-4 border-r border-base-200 font-medium">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isOnline ? "bg-success" : "bg-error"
                              }`}
                            />
                            <span
                              className={`font-semibold ${
                                isOnline ? "text-success" : "text-error"
                              }`}
                            >
                              {dev.status.toUpperCase()}
                            </span>
                          </div>
                        </td>

                        {/* Device Name & ID */}
                        <td className="py-3 px-4 border-r border-base-200">
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold text-sm text-base-content truncate">
                              {dev.name}
                            </span>
                            <span className="text-[11px] text-base-content/50 font-mono truncate">
                              {dev.id}
                            </span>
                          </div>
                        </td>

                        {/* Convention */}
                        <td className="py-3 px-4 border-r border-base-200">
                          <span
                            className={`badge badge-sm font-semibold uppercase ${
                              conventionBadgeClass[dev.convention] ??
                              "badge-ghost"
                            }`}
                          >
                            {dev.convention}
                          </span>
                        </td>

                        {/* IP Address */}
                        <td className="py-3 px-4 border-r border-base-200 font-mono text-[11px]">
                          {dev.ip_address || (
                            <span className="text-base-content/30">—</span>
                          )}
                        </td>

                        {/* MAC Address */}
                        <td className="py-3 px-4 border-r border-base-200 font-mono text-[11px]">
                          {dev.mac_address || (
                            <span className="text-base-content/30">—</span>
                          )}
                        </td>

                        {/* Hardware */}
                        <td className="py-3 px-4 border-r border-base-200 truncate max-w-[160px]">
                          {dev.hardware || (
                            <span className="text-base-content/30">—</span>
                          )}
                        </td>

                        {/* Last Seen */}
                        <td className="py-3 px-4 border-r border-base-200 text-base-content/60 tabular-nums">
                          <span title={dev.last_seen}>
                            {formatTimeAgo(dev.last_seen)}
                          </span>
                        </td>

                        {/* Action Button */}
                        <td
                          className="py-3 px-3 text-center"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDeviceId(dev.id);
                          }}
                        >
                          <div
                            className="tooltip tooltip-left"
                            data-tip="Inspect device details & logs"
                          >
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs btn-square text-base-content/50 hover:text-base-content"
                            >
                              <RiExternalLinkLine className="text-sm" />
                            </button>
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

      {/* ── Detail Side Drawer ─────────────────────────────── */}
      {selectedDevice && (
        <DeviceDetailDrawer
          key={selectedDevice.id}
          device={selectedDevice}
          brokerId={effectiveBrokerId}
          onClose={() => setSelectedDeviceId(null)}
          onRefreshDevice={fetchDevices}
        />
      )}

      {/* ── Column Filter Popovers ─────────────────────────── */}
      {/* 1. Status Filter Popover */}
      {activeFilterCol === "status" && (
        <FilterPopover
          anchorRect={filterAnchorRect}
          onClose={handleCloseFilter}
          width={200}
        >
          <div className="font-semibold text-base-content/70 mb-2">
            Filter Status
          </div>
          <div className="space-y-1">
            {(["all", "online", "offline"] as const).map((st) => (
              <label
                key={st}
                className="flex items-center gap-2 cursor-pointer py-1 px-1.5 rounded hover:bg-base-200 capitalize"
              >
                <input
                  type="radio"
                  name="statusFilter"
                  className="radio radio-xs radio-primary"
                  checked={filters.status === st}
                  onChange={() => {
                    setFilters((p) => ({ ...p, status: st }));
                    handleCloseFilter();
                  }}
                />
                <span>{st}</span>
              </label>
            ))}
          </div>
        </FilterPopover>
      )}

      {/* 2. Name Filter Popover */}
      {activeFilterCol === "name" && (
        <FilterPopover
          anchorRect={filterAnchorRect}
          onClose={handleCloseFilter}
          width={240}
        >
          <div className="font-semibold text-base-content/70 mb-2">
            Filter Device Name or ID
          </div>
          <input
            type="text"
            className="input input-xs input-bordered w-full font-mono text-xs"
            placeholder="Search name or ID..."
            value={filters.name}
            autoFocus
            onChange={(e) =>
              setFilters((p) => ({ ...p, name: e.target.value }))
            }
          />
          {filters.name && (
            <button
              type="button"
              className="btn btn-ghost btn-xs text-primary mt-2 w-full"
              onClick={() => setFilters((p) => ({ ...p, name: "" }))}
            >
              Clear Filter
            </button>
          )}
        </FilterPopover>
      )}

      {/* 3. Convention Filter Popover */}
      {activeFilterCol === "convention" && (
        <FilterPopover
          anchorRect={filterAnchorRect}
          onClose={handleCloseFilter}
          width={220}
        >
          <div className="font-semibold text-base-content/70 mb-2">
            Filter Convention
          </div>
          <div className="space-y-1">
            {[
              { id: "", label: "All Conventions" },
              { id: "homie", label: "Homie" },
              { id: "esphome", label: "ESPHome" },
              { id: "homeassistant", label: "Home Assistant" },
              { id: "tasmota", label: "Tasmota" },
              { id: "generic", label: "Generic" },
            ].map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 cursor-pointer py-1 px-1.5 rounded hover:bg-base-200"
              >
                <input
                  type="radio"
                  name="conventionFilter"
                  className="radio radio-xs radio-primary"
                  checked={filters.convention === c.id}
                  onChange={() => {
                    setFilters((p) => ({ ...p, convention: c.id }));
                    handleCloseFilter();
                  }}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </FilterPopover>
      )}

      {/* 4. IP Filter Popover */}
      {activeFilterCol === "ip" && (
        <FilterPopover
          anchorRect={filterAnchorRect}
          onClose={handleCloseFilter}
          width={220}
        >
          <div className="font-semibold text-base-content/70 mb-2">
            Filter IP Address
          </div>
          <input
            type="text"
            className="input input-xs input-bordered w-full font-mono text-xs"
            placeholder="e.g. 192.168"
            value={filters.ip}
            autoFocus
            onChange={(e) => setFilters((p) => ({ ...p, ip: e.target.value }))}
          />
          {filters.ip && (
            <button
              type="button"
              className="btn btn-ghost btn-xs text-primary mt-2 w-full"
              onClick={() => setFilters((p) => ({ ...p, ip: "" }))}
            >
              Clear Filter
            </button>
          )}
        </FilterPopover>
      )}

      {/* 5. MAC Filter Popover */}
      {activeFilterCol === "mac" && (
        <FilterPopover
          anchorRect={filterAnchorRect}
          onClose={handleCloseFilter}
          width={220}
        >
          <div className="font-semibold text-base-content/70 mb-2">
            Filter MAC Address
          </div>
          <input
            type="text"
            className="input input-xs input-bordered w-full font-mono text-xs"
            placeholder="e.g. 30:AE"
            value={filters.mac}
            autoFocus
            onChange={(e) => setFilters((p) => ({ ...p, mac: e.target.value }))}
          />
          {filters.mac && (
            <button
              type="button"
              className="btn btn-ghost btn-xs text-primary mt-2 w-full"
              onClick={() => setFilters((p) => ({ ...p, mac: "" }))}
            >
              Clear Filter
            </button>
          )}
        </FilterPopover>
      )}

      {/* 6. Hardware Filter Popover */}
      {activeFilterCol === "hardware" && (
        <FilterPopover
          anchorRect={filterAnchorRect}
          onClose={handleCloseFilter}
          width={220}
        >
          <div className="font-semibold text-base-content/70 mb-2">
            Filter Hardware / Model
          </div>
          <input
            type="text"
            className="input input-xs input-bordered w-full font-mono text-xs"
            placeholder="e.g. ESP32, Relay"
            value={filters.hardware}
            autoFocus
            onChange={(e) =>
              setFilters((p) => ({ ...p, hardware: e.target.value }))
            }
          />
          {filters.hardware && (
            <button
              type="button"
              className="btn btn-ghost btn-xs text-primary mt-2 w-full"
              onClick={() => setFilters((p) => ({ ...p, hardware: "" }))}
            >
              Clear Filter
            </button>
          )}
        </FilterPopover>
      )}
    </div>
  );
}
