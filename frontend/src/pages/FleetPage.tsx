import { useEffect, useMemo, useState } from "react";
import {
  MdRefresh,
  MdSearch,
  MdGridView,
  MdTableRows,
  MdHub,
  MdWifi,
  MdWifiOff,
  MdClose,
  MdDevices,
  MdHelpOutline,
  MdCheckCircle,
  MdInfo,
} from "react-icons/md";
import { api, type FleetDevice, type FleetTopology } from "../api/client";
import { useBrokerStatuses } from "../hooks/useBrokers";
import DeviceTopologyDiagram from "../components/fleet/DeviceTopologyDiagram";
import DeviceInspectorDrawer from "../components/fleet/DeviceInspectorDrawer";


export default function FleetPage() {
  const brokerStatuses = useBrokerStatuses();

  const [selectedBrokerId, setSelectedBrokerId] = useState<string>("");
  const [devices, setDevices] = useState<FleetDevice[]>([]);
  const [topology, setTopology] = useState<FleetTopology>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "table" | "topology">("grid");
  const [selectedDevice, setSelectedDevice] = useState<FleetDevice | null>(null);
  const [showDiscoveryGuide, setShowDiscoveryGuide] = useState(false);


  // Command drawer state
  const [sendingCmd, setSendingCmd] = useState(false);
  const [cmdStatus, setCmdStatus] = useState<string | null>(null);

  const autoSelectedBrokerId = useMemo(() => {

    const firstConnected = brokerStatuses.find(
      (b) => b.is_enabled && b.status === "CONNECTED",
    );
    if (firstConnected) return firstConnected.id;
    const firstEnabled = brokerStatuses.find((b) => b.is_enabled);
    if (firstEnabled) return firstEnabled.id;
    return brokerStatuses[0]?.id ?? "";
  }, [brokerStatuses]);

  const effectiveBrokerId = selectedBrokerId || autoSelectedBrokerId;

  const loadData = () => {
    if (!effectiveBrokerId) return;
    setLoading(true);
    Promise.all([
      api.getFleetDevices(effectiveBrokerId),
      api.getFleetTopology(effectiveBrokerId),
    ])
      .then(([devList, topoData]) => {
        setDevices(devList);
        setTopology(topoData);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [effectiveBrokerId]);

  // Keep selected device object synced if devices update
  useEffect(() => {
    if (selectedDevice) {
      const updated = devices.find((d) => d.id === selectedDevice.id);
      if (updated) setSelectedDevice(updated);
    }
  }, [devices]);

  const filteredDevices = useMemo(() => {
    return devices.filter((d) => {
      const matchesStatus =
        statusFilter === "all" || d.status === statusFilter;
      const matchesType =
        typeFilter === "all" || d.device_type === typeFilter;
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        d.name.toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q) ||
        (d.mac && d.mac.toLowerCase().includes(q)) ||
        (d.ip && d.ip.toLowerCase().includes(q)) ||
        (d.hardware && d.hardware.toLowerCase().includes(q)) ||
        (d.firmware && d.firmware.toLowerCase().includes(q)) ||
        d.base_topic.toLowerCase().includes(q);
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [devices, searchQuery, statusFilter, typeFilter]);




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
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-base-100 overflow-hidden">
      {/* ── Sub Navbar (Header Bar) ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-base-300 bg-base-100 shrink-0">
        <span className="text-sm font-medium text-base-content/60">Broker</span>
        <select
          className="select select-bordered select-sm"
          value={effectiveBrokerId}
          onChange={(e) => {
            setSelectedBrokerId(e.target.value);
            setSelectedDevice(null);
          }}
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


        {/* Search Bar */}
        <div className="relative">
          <MdSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/40 text-base" />
          <input
            type="text"
            placeholder="Search name, MAC, IP, topic..."
            className="input input-bordered input-sm pl-8 w-44 sm:w-56"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Status Filter Pills */}
        <div className="join">
          <button
            className={`join-item btn btn-xs ${statusFilter === "all" ? "btn-active" : "btn-ghost"
              }`}
            onClick={() => setStatusFilter("all")}
          >
            All ({devices.length})
          </button>
          <button
            className={`join-item btn btn-xs ${statusFilter === "online" ? "btn-success" : "btn-ghost"
              }`}
            onClick={() => setStatusFilter("online")}
          >
            Online ({devices.filter((d) => d.status === "online").length})
          </button>
          <button
            className={`join-item btn btn-xs ${statusFilter === "offline" ? "btn-error" : "btn-ghost"
              }`}
            onClick={() => setStatusFilter("offline")}
          >
            Offline ({devices.filter((d) => d.status === "offline").length})
          </button>
        </div>

        {/* Protocol Filter Selector */}
        <select
          className="select select-bordered select-xs text-xs font-medium"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">All Protocols</option>
          <option value="homeassistant">Home Assistant</option>
          <option value="homie">Homie IoT</option>
          <option value="esphome">ESPHome</option>
          <option value="tasmota">Tasmota</option>
          <option value="generic">Generic Telemetry</option>
        </select>


        {/* Right Action Group */}
        <div className="ml-auto flex items-center gap-2">
          <div className="join">
            <button
              className={`join-item btn btn-sm ${viewMode === "grid" ? "btn-primary" : "btn-ghost"
                }`}
              title="Grid View"
              onClick={() => setViewMode("grid")}
            >
              <MdGridView />
            </button>

            <button
              className={`join-item btn btn-sm ${viewMode === "table" ? "btn-primary" : "btn-ghost"
                }`}
              title="Table View"
              onClick={() => setViewMode("table")}
            >
              <MdTableRows />
            </button>
            <button
              className={`join-item btn btn-sm ${viewMode === "topology" ? "btn-primary" : "btn-ghost"
                }`}
              title="Topology Diagram View"
              onClick={() => setViewMode("topology")}
            >
              <MdHub />
            </button>
          </div>

          <button
            className="btn btn-sm btn-outline gap-1"
            onClick={loadData}
            title="Refresh Devices"
          >
            <MdRefresh className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

        </div>
      </div>


      {/* ── Main Content Area ── */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4">
          {loading && devices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-base-content/50">
              <span className="loading loading-spinner loading-lg mb-2" />
              <p>Discovering fleet devices...</p>
            </div>
          ) : filteredDevices.length === 0 && viewMode !== "topology" ? (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed border-base-300 rounded-box bg-base-200/40 text-center max-w-lg mx-auto my-12">
              <div className="p-3 bg-primary/10 rounded-full text-primary mb-3">
                <MdDevices className="text-3xl" />
              </div>
              <h3 className="text-base font-bold">No connected devices discovered</h3>
              <p className="text-xs text-base-content/70 mt-1 max-w-sm">
                To appear in Fleet Management, devices must use a recognized discovery protocol or send telemetry containing device specs.
              </p>
              <button
                onClick={() => setShowDiscoveryGuide(true)}
                className="btn btn-sm btn-outline btn-primary mt-4 gap-1"
              >
                <MdHelpOutline className="text-base" />
                How device discovery works
              </button>
            </div>

          ) : (
            <>
              {/* 1. GRID VIEW */}
              {viewMode === "grid" && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredDevices.map((dev) => {
                    const isSelected = selectedDevice?.id === dev.id;
                    const isOnline = dev.status === "online";

                    return (
                      <div
                        key={dev.id}
                        onClick={() => setSelectedDevice(dev)}
                        className={`card bg-base-100 border transition-all duration-150 cursor-pointer hover:shadow-md ${isSelected
                            ? "border-primary ring-2 ring-primary/30"
                            : "border-base-300 hover:border-base-400"
                          }`}
                      >
                        <div className="card-body p-4 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`w-3 h-3 rounded-full shrink-0 ${isOnline
                                      ? "bg-success shadow-[0_0_8px_rgba(34,197,94,0.6)]"
                                      : "bg-error"
                                    }`}
                                />
                                <h3 className="font-bold text-sm truncate" title={dev.name}>
                                  {dev.name}
                                </h3>
                              </div>
                              {getDeviceBadge(dev.device_type)}
                            </div>

                            <div className="text-xs font-mono text-base-content/60 space-y-1 mb-3">
                              {dev.mac && (
                                <div className="flex justify-between">
                                  <span className="text-base-content/40">MAC:</span>
                                  <span>{dev.mac}</span>
                                </div>
                              )}
                              {dev.ip && (
                                <div className="flex justify-between">
                                  <span className="text-base-content/40">IP:</span>
                                  <span>{dev.ip}</span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span className="text-base-content/40">Topic:</span>
                                <span className="truncate max-w-[140px] text-accent">
                                  {dev.base_topic}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-base-200 flex items-center justify-between text-xs text-base-content/50">
                            <div className="flex items-center gap-1">
                              {dev.rssi ? (
                                <span className="flex items-center gap-1 font-mono">
                                  <MdWifi className="text-success text-sm" />
                                  {dev.rssi} dBm
                                </span>
                              ) : (
                                <MdWifiOff className="text-base-content/30" />
                              )}
                            </div>
                            <span className="truncate">
                              {dev.topics.length} topics
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 2. TABLE VIEW */}
              {viewMode === "table" && (
                <div className="overflow-x-auto border border-base-300 rounded-box">
                  <table className="table table-sm w-full">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Name</th>
                        <th>Type</th>
                        <th>MAC Address</th>
                        <th>IP Address</th>
                        <th>RSSI</th>
                        <th>Firmware</th>
                        <th>Base Topic</th>
                        <th>Last Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDevices.map((dev) => {
                        const isSelected = selectedDevice?.id === dev.id;
                        const isOnline = dev.status === "online";

                        return (
                          <tr
                            key={dev.id}
                            onClick={() => setSelectedDevice(dev)}
                            className={`cursor-pointer hover:bg-base-200 ${isSelected ? "bg-base-200 font-medium" : ""
                              }`}
                          >
                            <td>
                              <span
                                className={`inline-block w-2.5 h-2.5 rounded-full ${isOnline ? "bg-success" : "bg-error"
                                  }`}
                              />
                            </td>
                            <td className="font-semibold">{dev.name}</td>
                            <td>{getDeviceBadge(dev.device_type)}</td>
                            <td className="font-mono text-xs">{dev.mac || "-"}</td>
                            <td className="font-mono text-xs">{dev.ip || "-"}</td>
                            <td className="font-mono text-xs">
                              {dev.rssi ? `${dev.rssi} dBm` : "-"}
                            </td>
                            <td className="text-xs">{dev.firmware || "-"}</td>
                            <td className="font-mono text-xs text-accent">
                              {dev.base_topic}
                            </td>
                            <td className="text-xs text-base-content/50">
                              {dev.last_seen ? new Date(dev.last_seen).toLocaleTimeString() : "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 3. TOPOLOGY DIAGRAM VIEW */}
              {viewMode === "topology" && (
                <DeviceTopologyDiagram
                  topology={topology}
                  selectedDeviceId={selectedDevice?.id}
                  onSelectDevice={(id) => {
                    const found = devices.find((d) => d.id === id);
                    if (found) setSelectedDevice(found);
                  }}
                />
              )}
            </>
          )}
        </div>

      {/* ── Slide-over Device Inspector Drawer ── */}
      {selectedDevice && (
        <DeviceInspectorDrawer
          device={selectedDevice}
          brokerId={effectiveBrokerId}
          onClose={() => setSelectedDevice(null)}
          onSendCommand={(topic, payload) => {
            setSendingCmd(true);
            setCmdStatus(null);
            return api
              .sendFleetCommand(effectiveBrokerId, topic, payload)
              .then(() => {
                setCmdStatus("Command sent successfully!");
              })
              .catch((err) => {
                setCmdStatus(`Failed: ${err.message}`);
              })
              .finally(() => setSendingCmd(false));
          }}
          sendingCommand={sendingCmd}
          commandStatus={cmdStatus}
        />
      )}


      </div>
      {/* ── Discovery Guide Modal ── */}
      {showDiscoveryGuide && (
        <div className="modal modal-open backdrop-blur-xs">
          <div className="modal-box max-w-xl">
            <div className="flex items-center justify-between pb-3 border-b border-base-300">
              <div className="flex items-center gap-2">
                <MdInfo className="text-xl text-primary" />
                <h3 className="font-bold text-base">How Device Discovery Works</h3>
              </div>
              <button
                className="btn btn-sm btn-circle btn-ghost"
                onClick={() => setShowDiscoveryGuide(false)}
              >
                <MdClose />
              </button>
            </div>

            <div className="py-4 text-xs space-y-4 text-base-content/80 leading-relaxed">
              <p>
                Fleet Management automatically detects physical IoT devices connected to your broker. To ensure accuracy and prevent temporary test topics from cluttering your fleet, devices are recognized strictly through formal discovery protocols or explicit device identity telemetry.
              </p>

              <div className="space-y-3">
                <div className="p-3 bg-base-200/60 rounded-lg border border-base-300">
                  <div className="flex items-center gap-2 font-semibold text-base-content mb-1">
                    <MdCheckCircle className="text-success text-sm" />
                    <span>1. Home Assistant Discovery (ESPHome, Tasmota, Zigbee2MQTT)</span>
                  </div>
                  <p className="text-[11px] text-base-content/70">
                    Devices publishing config schemas to <code className="bg-base-300 px-1 py-0.5 rounded text-accent font-mono">homeassistant/+/+/config</code> (such as ESPHome, Tasmota, or Zigbee2MQTT) are instantly discovered with full hardware, model, MAC, and firmware specs.
                  </p>
                </div>

                <div className="p-3 bg-base-200/60 rounded-lg border border-base-300">
                  <div className="flex items-center gap-2 font-semibold text-base-content mb-1">
                    <MdCheckCircle className="text-secondary text-sm" />
                    <span>2. Homie IoT Convention</span>
                  </div>
                  <p className="text-[11px] text-base-content/70">
                    Standardized nodes following Homie convention publish device specs to <code className="bg-base-300 px-1 py-0.5 rounded text-accent font-mono">homie/&lt;device_id&gt;/$name</code>, <code className="bg-base-300 px-1 py-0.5 rounded text-accent font-mono">$mac</code>, <code className="bg-base-300 px-1 py-0.5 rounded text-accent font-mono">$localip</code>, and <code className="bg-base-300 px-1 py-0.5 rounded text-accent font-mono">$state</code>.
                  </p>
                </div>

                <div className="p-3 bg-base-200/60 rounded-lg border border-base-300">
                  <div className="flex items-center gap-2 font-semibold text-base-content mb-1">
                    <MdCheckCircle className="text-info text-sm" />
                    <span>3. Structured Telemetry (JSON Device Specs)</span>
                  </div>
                  <p className="text-[11px] text-base-content/70">
                    Any JSON message payload containing explicit device identity attributes (such as <code className="bg-base-300 px-1 py-0.5 rounded text-accent font-mono font-bold">mac</code>, <code className="bg-base-300 px-1 py-0.5 rounded text-accent font-mono font-bold">ip</code>, <code className="bg-base-300 px-1 py-0.5 rounded text-accent font-mono font-bold">hardware</code>, <code className="bg-base-300 px-1 py-0.5 rounded text-accent font-mono font-bold">model</code>, or <code className="bg-base-300 px-1 py-0.5 rounded text-accent font-mono font-bold">firmware</code>) will be recognized as a fleet device.
                  </p>
                </div>
              </div>
            </div>

            <div className="modal-action pt-2 border-t border-base-300">
              <button className="btn btn-sm btn-primary" onClick={() => setShowDiscoveryGuide(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

