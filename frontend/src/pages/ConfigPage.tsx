import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../api/client";
import { useBrokerStatuses, type Broker } from "../hooks/useBrokers";
import { BrokerInfoPanel } from "../components/BrokerInfoPanel";

const statusDot: Record<string, string> = {
  CONNECTED: "bg-success",
  CONNECTING: "bg-warning animate-pulse",
  DISCONNECTED: "bg-error",
  ERROR: "bg-error",
  DISABLED: "bg-neutral",
};

// ─── Sortable list item ───────────────────────────────────────────────────────
function BrokerListItem({
  broker,
  status,
  isDefault,
  isSelected,
  onSelect,
  onToggle,
}: {
  broker: Broker;
  status: string;
  isDefault: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: broker.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-2 py-2 rounded cursor-pointer select-none ${isSelected ? "bg-base-300" : "hover:bg-base-200"}`}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab text-base-content/40 hover:text-base-content/70 touch-none"
        onClick={(e) => e.stopPropagation()}
      >
        ☰
      </span>

      {/* Status dot */}
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${statusDot[status] ?? "bg-neutral"}`}
      />

      {/* Name + default badge */}
      <span className="flex-1 text-sm truncate">{broker.name}</span>
      {isDefault && (
        <span className="badge badge-primary text-xs">Default</span>
      )}

      {/* Enable toggle */}
      <input
        type="checkbox"
        className="toggle toggle-sm toggle-primary no-drag"
        checked={broker.is_enabled}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onToggle(e.target.checked)}
      />
    </div>
  );
}

// ─── Blank form state ─────────────────────────────────────────────────────────
const emptyForm = () => ({
  name: "",
  host: "",
  port: "1883",
  client_id: "",
  username: "",
  password: "",
  is_enabled: true,
  auth_mode: "none",
  tls_enabled: false,
  tls_skip_verify: false,
  ca_cert: "",
  client_cert: "",
  client_key: "",
});

const toForm = (b: Broker) => ({
  name: b.name,
  host: b.host,
  port: String(b.port),
  client_id: b.client_id ?? "",
  username: b.username ?? "",
  password: "",
  is_enabled: b.is_enabled,
  auth_mode: b.auth_mode ?? "none",
  tls_enabled: b.tls_enabled ?? false,
  tls_skip_verify: b.tls_skip_verify ?? false,
  // Cert fields start empty; only sent when user provides new content
  ca_cert: "",
  client_cert: "",
  client_key: "",
});

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unexpected error";

// ─── CertField: textarea + file-upload for PEM content ───────────────────────
function CertField({
  label,
  fieldKey,
  placeholder,
  configured,
  value,
  onChange,
}: {
  label: string;
  fieldKey: string;
  placeholder: string;
  configured: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onChange((ev.target?.result as string) ?? "");
    reader.readAsText(file);
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  return (
    <fieldset className="fieldset p-0! border-0!">
      <div className="flex items-center justify-between mb-1">
        <legend className="fieldset-legend">{label}</legend>
        <button
          type="button"
          className="btn btn-xs btn-outline"
          onClick={() => inputRef.current?.click()}
        >
          Upload file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pem,.crt,.cer,.key"
          className="hidden"
          onChange={handleFile}
          data-testid={`file-upload-${fieldKey}`}
        />
      </div>
      <textarea
        className="textarea textarea-bordered w-full font-mono text-xs"
        rows={4}
        placeholder={
          configured ? "(configured — paste or upload to replace)" : placeholder
        }
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </fieldset>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ConfigPage() {
  const [searchParams] = useSearchParams();
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const brokerStatuses = useBrokerStatuses();
  const [retentionValue, setRetentionValue] = useState(24);
  const [retentionUnit, setRetentionUnit] = useState<"hours" | "days">("hours");
  const [showSysTopics, setShowSysTopics] = useState(false);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [historySize, setHistorySize] = useState<number | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<"brokers" | "general">("brokers");

  const requestedBrokerId = searchParams.get("broker");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const loadBrokers = useCallback(async () => {
    try {
      const list = await api.get<Broker[]>("/api/brokers");
      setBrokers(list);
      return list;
    } catch (error) {
      void error;
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    api
      .get<Broker[]>("/api/brokers")
      .then((list) => {
        if (cancelled) return;
        setBrokers(list);

        const enabled = list.filter((b) => b.is_enabled);
        const fallback = enabled[0] ?? list[0];
        const fromQuery = requestedBrokerId
          ? list.find((b) => b.id === requestedBrokerId)
          : null;
        const preferred = fromQuery ?? fallback;
        if (fromQuery) {
          setActiveTab("brokers");
        }
        if (!preferred) {
          setSelectedId(null);
          return;
        }

        setSelectedId(preferred.id);
        setIsEditingTitle(false);
        setForm(toForm(preferred));
      })
      .catch((error) => {
        void error;
      });

    return () => {
      cancelled = true;
    };
  }, [loadBrokers, requestedBrokerId]);

  useEffect(() => {
    api
      .get<{ retention_period_hours: number; show_sys_topics: boolean }>(
        "/api/settings",
      )
      .then((s) => {
        const h = s.retention_period_hours;
        if (h % 24 === 0) {
          setRetentionValue(h / 24);
          setRetentionUnit("days");
        } else {
          setRetentionValue(h);
          setRetentionUnit("hours");
        }
        setShowSysTopics(Boolean(s.show_sys_topics));
      })
      .catch((error) => {
        void error;
      });

    api
      .getHistorySize()
      .then(({ size_bytes }) => setHistorySize(size_bytes))
      .catch(() => setHistorySize(null));
  }, []);

  const handleClearHistory = async () => {
    setClearingHistory(true);
    try {
      await api.clearHistory();
      setHistorySize(0);
      setShowClearConfirm(false);
      showToast("History cleared");
    } catch {
      showToast("Failed to clear history", false);
    } finally {
      setClearingHistory(false);
    }
  };

  const handleSaveRetention = async () => {
    const hours =
      retentionUnit === "days" ? retentionValue * 24 : retentionValue;
    if (hours < 24) {
      showToast("Minimum retention is 24 hours", false);
      return;
    }
    setRetentionSaving(true);
    try {
      await api.put("/api/settings", {
        retention_period_hours: hours,
        show_sys_topics: showSysTopics,
      });
      showToast("Settings saved");
    } catch {
      showToast("Failed to save settings", false);
    } finally {
      setRetentionSaving(false);
    }
  };

  const statusById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of brokerStatuses) map.set(s.id, s.status);
    return map;
  }, [brokerStatuses]);

  const getBrokerStatus = (broker: Broker) => {
    if (!broker.is_enabled) return "DISABLED";
    return statusById.get(broker.id) ?? broker.status ?? "DISCONNECTED";
  };

  const handleAddNew = async () => {
    try {
      const created = await api.post<Broker>("/api/brokers", {
        name: "New Broker",
        host: "localhost",
        port: "1883",
        is_enabled: false,
        auth_mode: "none",
      });
      setBrokers((prev) => [...prev, created]);
      setSelectedId(created.id);
      setIsEditingTitle(false);
      setForm(toForm(created));
    } catch (error) {
      showToast(getErrorMessage(error), false);
    }
  };

  const handleSelect = (id: string) => {
    const selected = brokers.find((b) => b.id === id);
    setSelectedId(id);
    setIsEditingTitle(false);
    if (selected) {
      setForm(toForm(selected));
    }
  };

  const handleToggle = async (broker: Broker, enabled: boolean) => {
    try {
      const updated = await api.put<Broker>(`/api/brokers/${broker.id}`, {
        is_enabled: enabled,
      });
      setBrokers((prev) => prev.map((b) => (b.id === broker.id ? updated : b)));
      if (selectedId === broker.id) {
        setForm((prev) => ({ ...prev, is_enabled: updated.is_enabled }));
      }
    } catch (error) {
      showToast(getErrorMessage(error), false);
    }
  };

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      // Only send password/certs if non-empty (avoids clearing existing stored values)
      const payload: Record<string, unknown> = { ...form };
      if (!payload.password) delete payload.password;
      if (!payload.ca_cert) delete payload.ca_cert;
      if (!payload.client_cert) delete payload.client_cert;
      if (!payload.client_key) delete payload.client_key;
      const updated = await api.put<Broker>(
        `/api/brokers/${selectedId}`,
        payload,
      );
      setBrokers((prev) =>
        prev.map((b) => (b.id === selectedId ? updated : b)),
      );
      setIsEditingTitle(false);
      setForm(toForm(updated));
      if (updated.status === "ERROR" && updated.status_error) {
        showToast(`Connection failed: ${updated.status_error}`, false);
      } else {
        showToast("Broker saved");
      }
    } catch (error) {
      showToast(getErrorMessage(error), false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    const b = brokers.find((x) => x.id === selectedId);
    if (!confirm(`Delete broker "${b?.name}"?`)) return;
    try {
      await api.delete(`/api/brokers/${selectedId}`);
      const remaining = brokers.filter((x) => x.id !== selectedId);
      setBrokers(remaining);
      setIsEditingTitle(false);

      if (remaining.length === 0) {
        setSelectedId(null);
      } else {
        const enabled = remaining.filter((x) => x.is_enabled);
        const fallback = enabled[0] ?? remaining[0];
        setSelectedId(fallback.id);
        setForm(toForm(fallback));
      }
      showToast("Broker deleted");
    } catch (error) {
      showToast(getErrorMessage(error), false);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = brokers.findIndex((b) => b.id === active.id);
    const newIndex = brokers.findIndex((b) => b.id === over.id);
    const reordered = arrayMove(brokers, oldIndex, newIndex).map((b, i) => ({
      ...b,
      sort_order: i,
    }));
    setBrokers(reordered);

    try {
      await api.put("/api/brokers/reorder", {
        brokers: reordered.map((b) => ({ id: b.id, sort_order: b.sort_order })),
      });
    } catch (error) {
      showToast(getErrorMessage(error), false);
      loadBrokers(); // revert on failure
    }
  };

  const enabledBrokers = brokers.filter((b) => b.is_enabled);
  const disabledBrokers = brokers.filter((b) => !b.is_enabled);
  const defaultBrokerId = enabledBrokers[0]?.id;

  const f = (field: keyof typeof form) => ({
    value: form[field] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value })),
  });

  const selectedBroker = selectedId
    ? brokers.find((b) => b.id === selectedId)
    : null;
  const canShowForm = !!selectedBroker;
  const titleLabel = selectedBroker?.name ?? "Broker";
  const titleDisplay = form.name.trim() || titleLabel;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* ── Sub-navbar ───────────────────────────────────────── */}
      <div className="border-b border-base-300 bg-base-100 px-6 shrink-0">
        <div role="tablist" className="tabs tabs-bordered">
          <button
            role="tab"
            className={`tab ${activeTab === "brokers" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("brokers")}
          >
            Brokers
          </button>
          <button
            role="tab"
            className={`tab ${activeTab === "general" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("general")}
          >
            General
          </button>
        </div>
      </div>

      {/* ── Content row ─────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ──────────────────────────────────────────── */}
        {activeTab === "brokers" && (
          <aside className="w-64 shrink-0 border-r border-base-300 flex flex-col bg-base-100">
            <div className="p-3 border-b border-base-300">
              <button
                className="btn btn-sm btn-primary w-full"
                onClick={handleAddNew}
              >
                + Add New Broker
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                {/* Enabled section */}
                {enabledBrokers.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-base-content/50 uppercase tracking-wider px-2 py-1 mt-1">
                      Enabled
                    </p>
                    <SortableContext
                      items={enabledBrokers.map((b) => b.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {enabledBrokers.map((b) => (
                        <BrokerListItem
                          key={b.id}
                          broker={b}
                          status={getBrokerStatus(b)}
                          isDefault={b.id === defaultBrokerId}
                          isSelected={b.id === selectedId}
                          onSelect={() => handleSelect(b.id)}
                          onToggle={(en) => handleToggle(b, en)}
                        />
                      ))}
                    </SortableContext>
                  </>
                )}

                {/* Disabled section */}
                {disabledBrokers.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-base-content/50 uppercase tracking-wider px-2 py-1 mt-3">
                      Disabled
                    </p>
                    <SortableContext
                      items={disabledBrokers.map((b) => b.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {disabledBrokers.map((b) => (
                        <BrokerListItem
                          key={b.id}
                          broker={b}
                          status={getBrokerStatus(b)}
                          isDefault={false}
                          isSelected={b.id === selectedId}
                          onSelect={() => handleSelect(b.id)}
                          onToggle={(en) => handleToggle(b, en)}
                        />
                      ))}
                    </SortableContext>
                  </>
                )}

                {brokers.length === 0 && (
                  <p className="text-sm text-base-content/40 text-center py-8">
                    No brokers yet
                  </p>
                )}
              </DndContext>
            </div>
          </aside>
        )}

        {/* ── Detail / General form ────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto flex flex-col gap-6 my-6 px-6">
            {activeTab === "brokers" && !canShowForm ? (
              <div className="text-center py-8">
                <h2 className="text-2xl font-semibold mb-2">
                  No broker selected
                </h2>
                <p className="text-base-content/60 mb-4">
                  Create a broker from the sidebar to start connecting.
                </p>
                <button className="btn btn-primary" onClick={handleAddNew}>
                  + Add New Broker
                </button>
              </div>
            ) : activeTab === "brokers" ? (
              <div className="flex flex-col lg:flex-row gap-6 items-start">
                <div className="card bg-base-100 border border-base-300 shadow-sm flex-1 min-w-0">
                  <div className="card-body gap-4">
                    <div className="flex items-center justify-between gap-3">
                      {isEditingTitle ? (
                        <input
                          autoFocus
                          className="input input-bordered input-lg flex-1 font-semibold"
                          placeholder={titleLabel}
                          value={form.name}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                          onBlur={() => setIsEditingTitle(false)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") setIsEditingTitle(false);
                          }}
                        />
                      ) : (
                        <button
                          className="text-left hover:opacity-80 transition-opacity"
                          onClick={() => setIsEditingTitle(true)}
                          title="Click to rename broker"
                        >
                          <h2 className="text-2xl font-semibold">
                            {titleDisplay}
                          </h2>
                          <p className="text-xs text-base-content/50 mt-1">
                            Click title to rename
                          </p>
                        </button>
                      )}
                      <label className="label cursor-pointer gap-2 px-0 py-0 shrink-0">
                        <span className="label-text text-sm font-medium">
                          Enabled
                        </span>
                        <input
                          type="checkbox"
                          className="toggle toggle-primary toggle-sm"
                          checked={form.is_enabled}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              is_enabled: e.target.checked,
                            }))
                          }
                        />
                      </label>
                    </div>

                    <fieldset className="fieldset">
                      <legend className="fieldset-legend">Host</legend>
                      <input
                        className="input input-bordered w-full"
                        placeholder="localhost"
                        {...f("host")}
                      />
                    </fieldset>

                    <fieldset className="fieldset">
                      <legend className="fieldset-legend">Port</legend>
                      <input
                        className="input input-bordered w-full"
                        placeholder="1883"
                        {...f("port")}
                      />
                    </fieldset>

                    <fieldset className="fieldset">
                      <legend className="fieldset-legend">Client ID</legend>
                      <input
                        className="input input-bordered w-full"
                        placeholder="mqtt-dashboard"
                        {...f("client_id")}
                      />
                    </fieldset>

                    {/* ── TLS / SSL ─────────────────────────────────── */}
                    <div className="border border-base-300 rounded-lg p-3 flex flex-col gap-3">
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="font-medium text-sm">TLS / SSL</span>
                        <input
                          type="checkbox"
                          className="toggle toggle-primary toggle-sm"
                          checked={form.tls_enabled}
                          onChange={(e) => {
                            const enabled = e.target.checked;
                            setForm((prev) => ({
                              ...prev,
                              tls_enabled: enabled,
                              // Reset certificate auth when disabling TLS
                              auth_mode:
                                !enabled && prev.auth_mode === "certificate"
                                  ? "none"
                                  : prev.auth_mode,
                              // Suggest standard TLS port when enabling
                              port:
                                enabled && prev.port === "1883"
                                  ? "8883"
                                  : !enabled && prev.port === "8883"
                                    ? "1883"
                                    : prev.port,
                            }));
                          }}
                        />
                      </label>
                      {form.tls_enabled && (
                        <>
                          <CertField
                            label="CA Certificate (optional)"
                            fieldKey="ca_cert"
                            placeholder="-----BEGIN CERTIFICATE-----"
                            configured={!!selectedBroker?.has_ca_cert}
                            value={form.ca_cert}
                            onChange={(v) =>
                              setForm((prev) => ({ ...prev, ca_cert: v }))
                            }
                          />
                          <label className="flex items-center gap-2 cursor-pointer text-sm">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm checkbox-warning"
                              checked={form.tls_skip_verify}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  tls_skip_verify: e.target.checked,
                                }))
                              }
                            />
                            <span>Skip TLS verification</span>
                            {form.tls_skip_verify && (
                              <span className="text-warning text-xs">
                                (insecure — only for testing)
                              </span>
                            )}
                          </label>
                        </>
                      )}
                    </div>

                    {/* ── Authentication ────────────────────────────── */}
                    <div className="border border-base-300 rounded-lg p-3 flex flex-col gap-3">
                      <span className="font-medium text-sm">
                        Authentication
                      </span>
                      <div role="tablist" className="tabs tabs-box tabs-sm">
                        {(["none", "password", "certificate"] as const).map(
                          (mode) => {
                            const isCert = mode === "certificate";
                            const disabled = isCert && !form.tls_enabled;
                            const btn = (
                              <button
                                role="tab"
                                type="button"
                                className={`tab ${form.auth_mode === mode ? "tab-active" : ""} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                                disabled={disabled}
                                onClick={() =>
                                  !disabled &&
                                  setForm((prev) => ({
                                    ...prev,
                                    auth_mode: mode,
                                  }))
                                }
                              >
                                {mode === "none"
                                  ? "None"
                                  : mode === "password"
                                    ? "Username / Password"
                                    : "Client Certificate"}
                              </button>
                            );
                            return disabled ? (
                              <span
                                key={mode}
                                className="tooltip tooltip-bottom"
                                data-tip="Requires TLS to be enabled"
                              >
                                {btn}
                              </span>
                            ) : (
                              <React.Fragment key={mode}>{btn}</React.Fragment>
                            );
                          },
                        )}
                      </div>

                      {form.auth_mode === "none" && (
                        <p className="text-sm text-base-content/50">
                          Anonymous connection — no credentials sent.
                        </p>
                      )}

                      {form.auth_mode === "password" && (
                        <>
                          <fieldset className="fieldset p-0! border-0!">
                            <legend className="fieldset-legend">
                              Username (optional)
                            </legend>
                            <input
                              className="input input-bordered w-full"
                              placeholder="username"
                              {...f("username")}
                            />
                          </fieldset>
                          <fieldset className="fieldset p-0! border-0!">
                            <legend className="fieldset-legend">
                              Password (optional)
                            </legend>
                            <input
                              className="input input-bordered w-full"
                              type="password"
                              placeholder={
                                selectedId ? "(unchanged)" : "••••••"
                              }
                              {...f("password")}
                            />
                          </fieldset>
                        </>
                      )}

                      {form.auth_mode === "certificate" && (
                        <>
                          <CertField
                            label="Client Certificate"
                            fieldKey="client_cert"
                            placeholder="-----BEGIN CERTIFICATE-----"
                            configured={!!selectedBroker?.has_client_cert}
                            value={form.client_cert}
                            onChange={(v) =>
                              setForm((prev) => ({ ...prev, client_cert: v }))
                            }
                          />
                          <CertField
                            label="Client Key"
                            fieldKey="client_key"
                            placeholder="-----BEGIN PRIVATE KEY-----"
                            configured={!!selectedBroker?.has_client_cert}
                            value={form.client_key}
                            onChange={(v) =>
                              setForm((prev) => ({ ...prev, client_key: v }))
                            }
                          />
                        </>
                      )}
                    </div>

                    <div className="flex gap-2 mt-1">
                      <button
                        className="btn btn-primary flex-1"
                        onClick={handleSave}
                        disabled={saving}
                      >
                        {saving ? (
                          <span className="loading loading-spinner loading-xs" />
                        ) : null}
                        Save
                      </button>
                      {selectedId && (
                        <button
                          className="btn btn-error btn-outline"
                          onClick={handleDelete}
                        >
                          Delete
                        </button>
                      )}
                    </div>

                    {selectedBroker && (
                      <div className="flex flex-col gap-1 mt-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2.5 h-2.5 rounded-full ${statusDot[getBrokerStatus(selectedBroker)] ?? "bg-neutral"}`}
                          />
                          <span className="text-sm text-base-content/60">
                            {getBrokerStatus(selectedBroker)}
                          </span>
                        </div>
                        {getBrokerStatus(selectedBroker) === "ERROR" &&
                          selectedBroker.status_error && (
                            <p className="text-error text-xs">
                              {selectedBroker.status_error}
                            </p>
                          )}
                      </div>
                    )}
                  </div>
                </div>
                {selectedBroker && (
                  <div className="w-full lg:w-80 lg:shrink-0">
                    <BrokerInfoPanel
                      brokerId={selectedBroker.id}
                      isConnected={
                        getBrokerStatus(selectedBroker) === "CONNECTED"
                      }
                    />
                  </div>
                )}
              </div>
            ) : null}

            {activeTab === "general" && (
              <div className="card bg-base-100 border border-base-300 shadow-sm">
                <div className="card-body gap-4">
                  <h2 className="card-title text-lg">Data Retention</h2>
                  <fieldset className="fieldset">
                    <legend className="fieldset-legend">
                      Retention Period
                    </legend>
                    <div className="flex gap-2">
                      <input
                        className="input input-bordered w-24"
                        type="number"
                        min={1}
                        value={retentionValue}
                        onChange={(e) =>
                          setRetentionValue(Number(e.target.value))
                        }
                      />
                      <select
                        className="select select-bordered"
                        value={retentionUnit}
                        onChange={(e) =>
                          setRetentionUnit(e.target.value as "hours" | "days")
                        }
                      >
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                      </select>
                    </div>
                    {retentionUnit === "hours" && retentionValue < 24 && (
                      <p className="text-error text-xs mt-1">
                        Minimum retention is 24 hours.
                      </p>
                    )}
                    {retentionUnit === "days" && retentionValue < 1 && (
                      <p className="text-error text-xs mt-1">
                        Minimum retention is 1 day.
                      </p>
                    )}
                  </fieldset>
                  <p className="text-xs text-base-content/50">
                    Topic history older than this window is automatically purged
                    every 30 minutes.
                  </p>
                  <div className="divider" />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">History storage</p>
                      <p className="text-xs text-base-content/50">
                        {historySize === null ? "—" : formatBytes(historySize)}
                      </p>
                    </div>
                    <button
                      className="btn btn-sm btn-error btn-outline"
                      onClick={() => setShowClearConfirm(true)}
                      disabled={clearingHistory || historySize === 0}
                    >
                      Clear history
                    </button>
                  </div>
                  <div className="divider" />
                  <label className="label cursor-pointer justify-start gap-3 px-0 py-1">
                    <input
                      type="checkbox"
                      className="toggle toggle-primary"
                      checked={showSysTopics}
                      onChange={(e) => setShowSysTopics(e.target.checked)}
                    />
                    <span className="label-text font-medium">
                      Show $SYS topics in Explorer by default
                    </span>
                  </label>
                  <p className="text-xs text-base-content/50">
                    $SYS topics are stored in history and may use significant
                    disk space over time.
                  </p>
                  <div>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={handleSaveRetention}
                      disabled={retentionSaving}
                    >
                      {retentionSaving ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : null}
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
      {/* end content row */}

      {/* Toast */}
      {showClearConfirm && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Clear all history?</h3>
            <p className="py-4 text-sm text-base-content/70">
              This will permanently delete all stored MQTT message history. This
              action cannot be undone.
            </p>
            <div className="modal-action">
              <button
                className="btn btn-sm"
                onClick={() => setShowClearConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-sm btn-error"
                onClick={handleClearHistory}
                disabled={clearingHistory}
              >
                {clearingHistory ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : null}
                Clear history
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop"
            onClick={() => setShowClearConfirm(false)}
          />
        </div>
      )}
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
