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

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
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
      }>
    >(
      `/api/explorer/history?broker_id=${encodeURIComponent(brokerId)}&topic=${encodeURIComponent(topic)}`,
    ),
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
};
