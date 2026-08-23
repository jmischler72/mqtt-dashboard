import { useState } from "react";
import {
  MdClose,
  MdWifi,
  MdWifiOff,
  MdSend,
  MdContentCopy,
  MdCheck,
  MdMemory,
  MdTopic,
  MdPowerSettingsNew,
  MdReceiptLong,
} from "react-icons/md";
import { type FleetDevice } from "../../api/client";
import LogPanel from "../panels/LogPanel";


interface DeviceInspectorDrawerProps {
  device: FleetDevice | null;
  brokerId: string;
  onClose: () => void;
  onSendCommand: (topic: string, payload: string) => Promise<void>;
  sendingCommand: boolean;
  commandStatus: string | null;
}

export default function DeviceInspectorDrawer({
  device,
  brokerId,
  onClose,
  onSendCommand,
  sendingCommand,
  commandStatus,
}: DeviceInspectorDrawerProps) {

  const [customTopic, setCustomTopic] = useState("");
  const [customPayload, setCustomPayload] = useState("");
  const [copiedTopic, setCopiedTopic] = useState<string | null>(null);

  if (!device) return null;

  const effectiveTopic = customTopic || `${device.base_topic}/command`;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTopic(text);
    setTimeout(() => setCopiedTopic(null), 2000);
  };

  const getDeviceBadge = (type: string) => {
    switch (type) {
      case "esphome":
        return <span className="badge badge-info badge-sm">ESPHome</span>;
      case "homeassistant":
        return <span className="badge badge-primary badge-sm">Home Assistant</span>;
      case "homie":
        return <span className="badge badge-secondary badge-sm">Homie</span>;
      case "tasmota":
        return <span className="badge badge-warning badge-sm">Tasmota</span>;
      default:
        return <span className="badge badge-ghost badge-sm">Generic</span>;
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[450px] bg-base-100 shadow-2xl border-l border-base-300 flex flex-col transition-all duration-300">
      {/* ── Drawer Header ── */}
      <div className="flex items-center justify-between p-4 border-b border-base-300 bg-base-200/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-3 h-3 rounded-full shrink-0 ${
              device.status === "online" ? "bg-success" : "bg-error"
            }`}
          />
          <div className="min-w-0">
            <h2 className="font-bold text-base truncate">{device.name}</h2>
            <div className="flex items-center gap-2 text-xs text-base-content/60 font-mono">
              <span>{device.id}</span>
              {getDeviceBadge(device.device_type)}
            </div>
          </div>
        </div>

        <button
          className="btn btn-sm btn-circle btn-ghost"
          onClick={onClose}
          title="Close Inspector"
        >
          <MdClose className="text-lg" />
        </button>
      </div>

      {/* ── Scrollable Content Area ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
        {/* Hardware & Network Spec Card */}
        <div className="bg-base-200/60 rounded-xl p-3.5 border border-base-300 space-y-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-base-content text-sm pb-2 border-b border-base-300/80">
            <MdMemory className="text-primary text-base" />
            <span>Device Information</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div>
              <span className="text-base-content/50 block">Status</span>
              <div className="flex items-center gap-1 font-medium mt-0.5">
                {device.status === "online" ? (
                  <>
                    <MdWifi className="text-success" />
                    <span className="text-success font-semibold">Online</span>
                  </>
                ) : (
                  <>
                    <MdWifiOff className="text-error" />
                    <span className="text-error font-semibold">Offline</span>
                  </>
                )}
              </div>
            </div>

            {device.rssi !== undefined && (
              <div>
                <span className="text-base-content/50 block">Signal (RSSI)</span>
                <span className="font-mono font-medium">{device.rssi} dBm</span>
              </div>
            )}

            {device.ip && (
              <div>
                <span className="text-base-content/50 block">IP Address</span>
                <span className="font-mono text-accent font-medium">{device.ip}</span>
              </div>
            )}

            {device.mac && (
              <div>
                <span className="text-base-content/50 block">MAC Address</span>
                <span className="font-mono font-medium">{device.mac}</span>
              </div>
            )}

            {device.hardware && (
              <div className="col-span-2">
                <span className="text-base-content/50 block">Hardware / Model</span>
                <span className="font-medium text-base-content/90">{device.hardware}</span>
              </div>
            )}

            {device.firmware && (
              <div>
                <span className="text-base-content/50 block">Firmware</span>
                <span className="font-mono font-medium">{device.firmware}</span>
              </div>
            )}

            <div>
              <span className="text-base-content/50 block">Base Topic</span>
              <span className="font-mono text-primary font-medium truncate block">
                {device.base_topic}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Controls & Command Sender */}
        <div className="bg-base-200/60 rounded-xl p-3.5 border border-base-300 space-y-3">
          <div className="flex items-center gap-1.5 font-semibold text-base-content text-sm pb-2 border-b border-base-300/80">
            <MdPowerSettingsNew className="text-secondary text-base" />
            <span>Quick Controls & Command Sender</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-xs btn-outline btn-primary gap-1"
              disabled={sendingCommand}
              onClick={() => void onSendCommand(`${device.base_topic}/command`, "ping")}
            >
              Ping
            </button>
            <button
              className="btn btn-xs btn-outline btn-success gap-1"
              disabled={sendingCommand}
              onClick={() => void onSendCommand(`${device.base_topic}/command`, "on")}
            >
              Power ON
            </button>
            <button
              className="btn btn-xs btn-outline btn-error gap-1"
              disabled={sendingCommand}
              onClick={() => void onSendCommand(`${device.base_topic}/command`, "off")}
            >
              Power OFF
            </button>
          </div>

          <div className="space-y-2 pt-1">
            <div>
              <label className="text-[11px] font-medium text-base-content/60 block mb-1">
                Target Command Topic:
              </label>
              <input
                type="text"
                className="input input-bordered input-xs font-mono w-full"
                value={effectiveTopic}
                onChange={(e) => setCustomTopic(e.target.value)}
                placeholder={`${device.base_topic}/command`}
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-base-content/60 block mb-1">
                Payload String:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input input-bordered input-xs font-mono flex-1"
                  value={customPayload}
                  onChange={(e) => setCustomPayload(e.target.value)}
                  placeholder='e.g. {"state": "ON"} or "ping"'
                />
                <button
                  className="btn btn-xs btn-primary gap-1 shrink-0"
                  disabled={sendingCommand || !customPayload.trim()}
                  onClick={() => {
                    void onSendCommand(effectiveTopic, customPayload);
                  }}
                >
                  <MdSend />
                  Send
                </button>
              </div>
            </div>

            {commandStatus && (
              <p className="text-[11px] font-mono text-accent mt-1 bg-accent/10 p-2 rounded border border-accent/20">
                {commandStatus}
              </p>
            )}
          </div>
        </div>

        {/* ESPHome-Style Live & History Log Panel */}
        <div className="bg-base-200/60 rounded-xl p-3.5 border border-base-300 space-y-2 flex flex-col h-72">
          <div className="flex items-center justify-between pb-1.5 border-b border-base-300/80 shrink-0">
            <div className="flex items-center gap-1.5 font-semibold text-base-content text-sm">
              <MdReceiptLong className="text-warning text-base" />
              <span>Live Logs & Messages</span>
            </div>
            <span className="font-mono text-[10px] text-accent truncate max-w-[180px]">
              {device.base_topic}/#
            </span>
          </div>
          <div className="flex-1 overflow-hidden min-h-0 rounded-lg border border-base-300 bg-base-100">
            <LogPanel
              key={`${brokerId}:${device.base_topic}`}
              panelId={`fleet-${device.id}`}
              brokerId={brokerId}
              config={{
                topics: `${device.base_topic}/#`,
                maxMessages: 300,
                dateFormat: "full",
                showQos: true,
                showRetained: true,
              }}
            />
          </div>
        </div>


        {/* Discovered Topics List */}
        <div className="bg-base-200/60 rounded-xl p-3.5 border border-base-300 space-y-2.5">

          <div className="flex items-center justify-between pb-2 border-b border-base-300/80">
            <div className="flex items-center gap-1.5 font-semibold text-base-content text-sm">
              <MdTopic className="text-info text-base" />
              <span>Discovered Topics ({device.topics.length})</span>
            </div>
          </div>

          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {device.topics.map((t) => (
              <div
                key={t}
                className="flex items-center justify-between p-2 bg-base-100 rounded border border-base-300 group hover:border-primary/50 transition-colors"
              >
                <button
                  className="font-mono text-[11px] text-accent hover:underline text-left truncate flex-1 mr-2"
                  onClick={() => setCustomTopic(t)}
                  title="Click to set as command target topic"
                >
                  {t}
                </button>
                <button
                  className="btn btn-ghost btn-xs btn-square opacity-60 group-hover:opacity-100"
                  onClick={() => handleCopy(t)}
                  title="Copy topic"
                >
                  {copiedTopic === t ? (
                    <MdCheck className="text-success" />
                  ) : (
                    <MdContentCopy />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
