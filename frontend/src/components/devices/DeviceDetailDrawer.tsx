import { useState, useEffect, useRef } from "react";
import {
  MdClose,
  MdSend,
  MdRefresh,
  MdContentCopy,
  MdCheck,
} from "react-icons/md";
import { RiRestartLine } from "react-icons/ri";
import { api, type Device } from "../../api/client";
import { useWebSocket } from "../../hooks/useWebSocket";

interface DeviceDetailDrawerProps {
  device: Device | null;
  brokerId: string;
  onClose: () => void;
  onRefreshDevice?: () => void;
}

interface LogEntry {
  timestamp: string;
  topic: string;
  payload: string;
  qos?: number;
  retained?: boolean;
  historical?: boolean;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function DeviceDetailDrawer({
  device,
  brokerId,
  onClose,
  onRefreshDevice,
}: DeviceDetailDrawerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const [customPayload, setCustomPayload] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{
    text: string;
    ok: boolean;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  const showFeedback = (text: string, ok = true) => {
    setFeedbackMsg({ text, ok });
    setTimeout(() => setFeedbackMsg(null), 3500);
  };

  const handleCopy = (field: string, text: string) => {
    if (!text || text === "—") return;
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Base topic pattern for logs
  const baseTopic = device?.base_topic || device?.id || "";
  const logTopicFilter = baseTopic ? `${baseTopic}/#` : "";

  // Load historical logs when device or broker changes
  useEffect(() => {
    if (!device?.id || !brokerId || !baseTopic) return;

    let cancelled = false;
    api
      .getExplorerHistory(brokerId, `${baseTopic}/#`)
      .then((records) => {
        if (cancelled) return;
        const initial: LogEntry[] = records.map((r) => ({
          timestamp: r.timestamp,
          topic: r.topic,
          payload: r.payload,
          qos: r.qos,
          retained: r.retained,
          historical: true,
        }));
        setLogs(initial);
      })
      .catch(() => {
        if (!cancelled) setLogs([]);
      });

    return () => {
      cancelled = true;
    };
  }, [device?.id, brokerId, baseTopic]);

  // Subscribe to live WebSocket messages for this device's topic tree
  const { subscribe } = useWebSocket({
    onMessage: (data) => {
      if (pausedRef.current) return;
      try {
        const msg = JSON.parse(data) as {
          topic: string;
          payload: string;
          timestamp?: string;
          qos?: number;
          retained?: boolean;
        };
        if (!msg.topic) return;

        // Check if message belongs to this device's namespace
        if (
          msg.topic === baseTopic ||
          msg.topic.startsWith(`${baseTopic}/`) ||
          (device?.id && msg.topic.startsWith(`${device.id}/`))
        ) {
          const entry: LogEntry = {
            timestamp: msg.timestamp || new Date().toISOString(),
            topic: msg.topic,
            payload: msg.payload,
            qos: msg.qos,
            retained: msg.retained,
            historical: false,
          };
          setLogs((prev) => [...prev.slice(-299), entry]);
        }
      } catch {
        // ignore malformed
      }
    },
  });

  useEffect(() => {
    if (!brokerId || !baseTopic) return;
    subscribe({
      panel_id: `device-logs-${device?.id}`,
      broker_id: brokerId,
      topics: [`${baseTopic}/#`, baseTopic],
    });
  }, [brokerId, baseTopic, device?.id, subscribe]);

  // Auto-scroll log box
  useEffect(() => {
    const el = logContainerRef.current;
    if (!el || paused || !shouldAutoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [logs, paused]);

  const handleLogScroll = () => {
    const el = logContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceToBottom <= 24;
  };

  const handleRestart = async () => {
    if (!device) return;
    setActionLoading("restart");
    try {
      const res = await api.restartDevice(brokerId, device.id);
      showFeedback(`Restart sent: ${res.topic}`);
      onRefreshDevice?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to restart";
      showFeedback(msg, false);
    } finally {
      setActionLoading(null);
    }
  };

  const handlePing = async () => {
    if (!device) return;
    setActionLoading("ping");
    try {
      const res = await api.pingDevice(brokerId, device.id);
      showFeedback(`Ping sent to ${res.topic}`);
      onRefreshDevice?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to ping";
      showFeedback(msg, false);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendCustom = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!device || !customPayload.trim()) return;

    setActionLoading("send");
    try {
      const res = await api.sendDeviceCommand(
        brokerId,
        device.id,
        customPayload.trim(),
      );
      showFeedback(`Sent to ${res.topic}`);
      setCustomPayload("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send command";
      showFeedback(msg, false);
    } finally {
      setActionLoading(null);
    }
  };

  if (!device) return null;

  const conventionBadgeClass: Record<string, string> = {
    homie: "badge-secondary",
    esphome: "badge-info",
    homeassistant: "badge-primary",
    tasmota: "badge-warning",
    generic: "badge-ghost",
  };

  const isOnline = device.status === "online";

  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 w-full sm:w-[460px] bg-base-100 border-l border-base-300 shadow-2xl flex flex-col transition-transform duration-200 ease-out"
      aria-label="Device Details Drawer"
    >
      {/* ── Header ────────────────────────────────────────── */}
      <div className="p-4 border-b border-base-300 flex items-center justify-between gap-3 shrink-0 bg-base-200/40">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`w-3 h-3 rounded-full shrink-0 ${
              isOnline ? "bg-success" : "bg-error"
            }`}
          />
          <div className="min-w-0">
            <h2 className="font-bold text-base leading-tight truncate">
              {device.name}
            </h2>
            <p className="text-xs text-base-content/60 font-mono truncate">
              ID: {device.id}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost btn-sm btn-circle text-base-content/60 hover:text-base-content"
          aria-label="Close details"
        >
          <MdClose className="text-lg" />
        </button>
      </div>

      {/* Feedback Toast Banner */}
      {feedbackMsg && (
        <div
          className={`px-4 py-2 text-xs font-semibold flex items-center justify-between ${
            feedbackMsg.ok
              ? "bg-success/20 text-success"
              : "bg-error/20 text-error"
          }`}
        >
          <span>{feedbackMsg.text}</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-circle h-4 w-4 min-h-0"
            onClick={() => setFeedbackMsg(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Scrollable Body ───────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 flex flex-col">
        {/* Device Properties Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs bg-base-200/50 p-3 rounded-lg border border-base-300 shrink-0">
          <div>
            <span className="text-[11px] text-base-content/50 uppercase font-semibold block">
              Type
            </span>
            <span
              className={`badge badge-sm font-semibold uppercase mt-0.5 ${
                conventionBadgeClass[device.convention] ?? "badge-ghost"
              }`}
            >
              {device.convention}
            </span>
          </div>

          <div>
            <span className="text-[11px] text-base-content/50 uppercase font-semibold block">
              Status
            </span>
            <span
              className={`font-bold mt-0.5 inline-block ${
                isOnline ? "text-success" : "text-error"
              }`}
            >
              {device.status.toUpperCase()}
            </span>
          </div>

          <div>
            <span className="text-[11px] text-base-content/50 uppercase font-semibold block">
              MAC Address
            </span>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="font-mono text-base-content/80 truncate">
                {device.mac_address || "—"}
              </span>
              {device.mac_address && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-circle h-5 w-5 min-h-0 text-base-content/40 hover:text-base-content"
                  onClick={() => handleCopy("mac", device.mac_address)}
                  title="Copy MAC"
                >
                  {copiedField === "mac" ? (
                    <MdCheck className="text-xs text-success" />
                  ) : (
                    <MdContentCopy className="text-xs" />
                  )}
                </button>
              )}
            </div>
          </div>

          <div>
            <span className="text-[11px] text-base-content/50 uppercase font-semibold block">
              IP Address
            </span>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="font-mono text-base-content/80 truncate">
                {device.ip_address || "—"}
              </span>
              {device.ip_address && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-circle h-5 w-5 min-h-0 text-base-content/40 hover:text-base-content"
                  onClick={() => handleCopy("ip", device.ip_address)}
                  title="Copy IP"
                >
                  {copiedField === "ip" ? (
                    <MdCheck className="text-xs text-success" />
                  ) : (
                    <MdContentCopy className="text-xs" />
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="col-span-2">
            <span className="text-[11px] text-base-content/50 uppercase font-semibold block">
              Hardware
            </span>
            <span className="font-medium text-base-content/80 truncate block mt-0.5">
              {device.hardware || "—"}
            </span>
          </div>

          {device.firmware && (
            <div className="col-span-2">
              <span className="text-[11px] text-base-content/50 uppercase font-semibold block">
                Firmware
              </span>
              <span className="font-mono text-base-content/70 truncate block mt-0.5">
                {device.firmware}
              </span>
            </div>
          )}

          {device.base_topic && (
            <div className="col-span-2">
              <span className="text-[11px] text-base-content/50 uppercase font-semibold block">
                Base Topic
              </span>
              <span className="font-mono text-[11px] text-accent truncate block mt-0.5">
                {device.base_topic}
              </span>
            </div>
          )}
        </div>

        {/* ── Device Logs & Status Messages ─────────────── */}
        <div className="flex-1 flex flex-col min-h-[260px] border border-base-300 rounded-lg overflow-hidden bg-base-100">
          <div className="px-3 py-2 border-b border-base-300 flex items-center justify-between gap-2 shrink-0 bg-base-200/30">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-base-content/70">
                Logs & Messages
              </span>
              <span className="badge badge-xs font-mono text-[10px] text-accent truncate max-w-[150px]">
                {logTopicFilter}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                className="btn btn-ghost btn-xs h-6 min-h-0 text-[11px]"
                onClick={() => setLogs([])}
              >
                Clear
              </button>
              <button
                type="button"
                className={`btn btn-xs h-6 min-h-0 text-[11px] ${
                  paused ? "btn-warning" : "btn-ghost"
                }`}
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? "Resume" : "Pause"}
              </button>
              <span className="text-[11px] text-base-content/50 ml-1 font-mono">
                {logs.length} msgs
              </span>
            </div>
          </div>

          <div
            ref={logContainerRef}
            onScroll={handleLogScroll}
            className="flex-1 overflow-y-auto bg-neutral text-neutral-content p-2.5 font-mono text-[11px] leading-relaxed space-y-1 select-text"
          >
            {logs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-neutral-content/40 text-xs">
                Waiting for device messages on {logTopicFilter}...
              </div>
            ) : (
              logs.map((m, i) => (
                <div
                  key={i}
                  className={`break-all ${m.historical ? "opacity-60" : ""}`}
                >
                  <span className="text-neutral-content/50 select-none">
                    [{formatTimestamp(m.timestamp)}]
                  </span>{" "}
                  <span className="text-accent">{m.topic}</span>
                  {m.qos !== undefined && (
                    <span className="text-neutral-content/40 ml-1">
                      Q{m.qos}
                    </span>
                  )}
                  {m.retained && (
                    <span className="text-warning ml-1 font-bold">R</span>
                  )}{" "}
                  <span className="text-neutral-content/90">{m.payload}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Actions Footer ─────────────────────────────────── */}
      <div className="p-3 border-t border-base-300 bg-base-200/50 shrink-0 space-y-2">
        {/* Remote Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-sm btn-outline flex-1 gap-1.5"
            onClick={handleRestart}
            disabled={actionLoading !== null}
          >
            <RiRestartLine
              className={`text-sm ${
                actionLoading === "restart" ? "animate-spin" : ""
              }`}
            />
            <span>Restart Node</span>
          </button>

          <button
            type="button"
            className="btn btn-sm btn-outline flex-1 gap-1.5"
            onClick={handlePing}
            disabled={actionLoading !== null}
          >
            <MdRefresh
              className={`text-sm ${
                actionLoading === "ping" ? "animate-spin" : ""
              }`}
            />
            <span>Ping Device</span>
          </button>
        </div>

        {/* Custom Payload Form */}
        <form onSubmit={handleSendCustom} className="flex items-center gap-2">
          <input
            type="text"
            className="input input-sm input-bordered flex-1 text-xs font-mono"
            placeholder="Custom payload..."
            value={customPayload}
            onChange={(e) => setCustomPayload(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-sm btn-primary gap-1"
            disabled={!customPayload.trim() || actionLoading !== null}
          >
            <MdSend className="text-xs" />
            <span>Send</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
