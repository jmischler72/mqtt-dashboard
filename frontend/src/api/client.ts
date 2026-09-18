// Thin wrapper around fetch for API calls
const BASE = "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface ScheduledJob {
  panel_id: string;
  panel_title: string;
  panel_type: string;
  dashboard_id: string;
  dashboard_name: string;
  broker_id: string;
  broker_name: string;
  cron_expr: string;
  topic: string;
  payload: string;
  qos: number;
  retain: boolean;
  enabled: boolean;
  next_run?: string;
  prev_run?: string;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  getScheduledJobs: (enabledOnly = false) =>
    request<ScheduledJob[]>(`/api/cron${enabledOnly ? "?enabled=true" : ""}`),
  toggleCronJob: (panelId: string, enabled: boolean) =>
    request<{ enabled: boolean }>(
      `/api/cron/${encodeURIComponent(panelId)}/toggle`,
      {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      },
    ),
  getExplorerTree: (brokerId: string) =>
    request<string[]>(
      `/api/explorer/tree?broker_id=${encodeURIComponent(brokerId)}`,
    ),
  getExplorerHistory: (brokerId: string, topic: string) =>
    request<
      Array<{
        id: number;
        broker_id: string;
        topic: string;
        payload: string;
        timestamp: string;
        qos?: number;
        retained?: boolean;
      }>
    >(
      `/api/explorer/history?broker_id=${encodeURIComponent(brokerId)}&topic=${encodeURIComponent(topic)}`,
    ),
  getActivity: (
    brokerId: string,
    topic: string,
    rangeSeconds: number,
    buckets = 60,
  ) =>
    request<{
      bucket_seconds: number;
      buckets: { ts: number; count: number; bytes: number }[];
      total: number;
      total_bytes: number;
      topics: { topic: string; count: number; last_seen: string }[];
    }>(
      `/api/explorer/activity?broker_id=${encodeURIComponent(brokerId)}&topic=${encodeURIComponent(topic)}&range_seconds=${rangeSeconds}&buckets=${buckets}`,
    ),
  getHistorySize: () => request<{ size_bytes: number }>("/api/history/size"),
  clearHistory: () => request<void>("/api/history", { method: "DELETE" }),
  getBrokerInfo: (brokerId: string) =>
    request<{
      version: string;
      uptime: number;
      clients_connected: number;
      messages_sent: number;
      messages_received: number;
      messages_5m_sent: number;
      messages_5m_received: number;
      memory_used: number;
      memory_max: number;
      updated_at: string;
    }>(`/api/brokers/${encodeURIComponent(brokerId)}/info`),
  getDevices: (brokerId: string) =>
    request<Device[]>(`/api/devices?broker_id=${encodeURIComponent(brokerId)}`),
  getDevice: (brokerId: string, id: string) =>
    request<Device>(
      `/api/devices/${encodeURIComponent(id)}?broker_id=${encodeURIComponent(brokerId)}`,
    ),
  restartDevice: (brokerId: string, id: string) =>
    request<{ status: string; topic: string; payload: string }>(
      `/api/devices/${encodeURIComponent(id)}/restart?broker_id=${encodeURIComponent(brokerId)}`,
      { method: "POST" },
    ),
  pingDevice: (brokerId: string, id: string) =>
    request<{ status: string; topic: string; payload: string }>(
      `/api/devices/${encodeURIComponent(id)}/ping?broker_id=${encodeURIComponent(brokerId)}`,
      { method: "POST" },
    ),
  sendDeviceCommand: (
    brokerId: string,
    id: string,
    payload: string,
    topic?: string,
  ) =>
    request<{ status: string; topic: string; payload: string }>(
      `/api/devices/${encodeURIComponent(id)}/command?broker_id=${encodeURIComponent(brokerId)}`,
      { method: "POST", body: JSON.stringify({ payload, topic }) },
    ),
  rescanDevices: (brokerId: string) =>
    request<{ status: string }>(
      `/api/devices/rescan?broker_id=${encodeURIComponent(brokerId)}`,
      { method: "POST" },
    ),
};

export interface Device {
  id: string;
  broker_id: string;
  name: string;
  convention: string;
  status: "online" | "offline" | "unknown";
  ip_address: string;
  mac_address: string;
  hardware: string;
  firmware: string;
  base_topic: string;
  command_topic: string;
  attributes?: Record<string, unknown>;
  last_seen: string;
  created_at: string;
}
