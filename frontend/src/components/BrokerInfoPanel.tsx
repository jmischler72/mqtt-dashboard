import React, { useEffect, useCallback, useState } from "react";
import { api } from "../api/client";

interface BrokerStats {
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
}

interface BrokerInfoPanelProps {
  brokerId: string;
  isConnected: boolean;
}

// Format uptime from seconds to human-readable format
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(" ");
}

// Format bytes to human-readable format
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Format large numbers with commas
function formatNumber(num: number): string {
  return num.toLocaleString();
}

export const BrokerInfoPanel: React.FC<BrokerInfoPanelProps> = ({
  brokerId,
  isConnected,
}) => {
  const [stats, setStats] = useState<BrokerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch broker info
  const fetchBrokerInfo = useCallback(async () => {
    if (!isConnected) return;

    setLoading(true);
    setError(null);
    try {
      const data = await api.getBrokerInfo(brokerId);
      setStats(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load broker info"
      );
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [brokerId, isConnected]);

  // Fetch on mount and set up polling
  useEffect(() => {
    if (!isConnected || !brokerId) return;

    fetchBrokerInfo();
    const interval = setInterval(fetchBrokerInfo, 5000);

    return () => clearInterval(interval);
  }, [brokerId, isConnected, fetchBrokerInfo]);

  if (!isConnected) {
    return (
      <div className="card bg-base-200 mt-4">
        <div className="card-body">
          <p className="text-sm text-gray-500">
            Broker info will appear when connected
          </p>
        </div>
      </div>
    );
  }

  if (loading && !stats) {
    return (
      <div className="card bg-base-200 mt-4">
        <div className="card-body">
          <div className="flex items-center gap-2">
            <span className="loading loading-spinner loading-sm"></span>
            <span className="text-sm">Loading broker information...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card bg-error/10 border border-error mt-4">
        <div className="card-body">
          <p className="text-sm text-error">{error}</p>
          <button
            className="btn btn-sm btn-outline btn-error mt-2 w-fit"
            onClick={fetchBrokerInfo}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="card bg-base-200 mt-4">
      <div className="card-body gap-4">
        <div className="flex justify-between items-center">
          <h3 className="card-title text-base">Broker Information</h3>
          <button
            className="btn btn-ghost btn-xs"
            onClick={fetchBrokerInfo}
            title="Refresh broker stats"
          >
            ↻
          </button>
        </div>

        {/* Version Row */}
        {stats.version && (
          <div className="flex justify-between border-b border-base-300 pb-2">
            <span className="text-sm font-medium">Version:</span>
            <span className="text-sm">{stats.version}</span>
          </div>
        )}

        {/* Uptime Row */}
        <div className="flex justify-between border-b border-base-300 pb-2">
          <span className="text-sm font-medium">Uptime:</span>
          <span className="text-sm">{formatUptime(stats.uptime)}</span>
        </div>

        {/* Connected Clients Row */}
        <div className="flex justify-between border-b border-base-300 pb-2">
          <span className="text-sm font-medium">Connected Clients:</span>
          <span className="text-sm badge badge-primary badge-outline">
            {stats.clients_connected}
          </span>
        </div>

        {/* Messages Sent/Received Row */}
        <div className="flex justify-between border-b border-base-300 pb-2">
          <span className="text-sm font-medium">Total Messages:</span>
          <span className="text-sm">
            ↑ {formatNumber(stats.messages_sent)} / ↓{" "}
            {formatNumber(stats.messages_received)}
          </span>
        </div>

        {/* 5-Minute Messages Row */}
        <div className="flex justify-between border-b border-base-300 pb-2">
          <span className="text-sm font-medium">Messages (5m):</span>
          <span className="text-sm">
            ↑ {formatNumber(stats.messages_5m_sent)} / ↓{" "}
            {formatNumber(stats.messages_5m_received)}
          </span>
        </div>

        {/* Memory Usage Row */}
        <div className="flex justify-between pb-2">
          <span className="text-sm font-medium">Memory:</span>
          <span className="text-sm">
            {formatBytes(stats.memory_used)} / {formatBytes(stats.memory_max)}
          </span>
        </div>

        {/* Last Updated */}
        <div className="text-xs text-gray-400 text-center mt-2">
          Updated {new Date(stats.updated_at).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
};
