import { useMemo, useState } from "react";
import { MdAdd, MdRemove, MdRestartAlt } from "react-icons/md";
import { type FleetTopology } from "../../api/client";

interface DeviceTopologyDiagramProps {
  topology: FleetTopology;
  onSelectDevice?: (deviceId: string) => void;
  selectedDeviceId?: string;
}

export default function DeviceTopologyDiagram({
  topology,
  onSelectDevice,
  selectedDeviceId,
}: DeviceTopologyDiagramProps) {
  const [zoomScale, setZoomScale] = useState(1);

  const { nodesWithPos, linksWithPos } = useMemo(() => {
    const width = 800;
    const height = 500;
    const centerX = width / 2;
    const centerY = height / 2;

    const brokerNode = topology.nodes.find((n) => n.type === "broker");
    const otherNodes = topology.nodes.filter((n) => n.type !== "broker");

    const nodePositions: Record<string, { x: number; y: number }> = {};

    if (brokerNode) {
      nodePositions[brokerNode.id] = { x: centerX, y: centerY };
    }

    const radius = Math.min(width, height) * 0.35;
    const totalOthers = otherNodes.length;

    otherNodes.forEach((node, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(totalOthers, 1) - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      nodePositions[node.id] = { x, y };
    });

    const positionedNodes = topology.nodes.map((n) => ({
      ...n,
      pos: nodePositions[n.id] || { x: centerX, y: centerY },
    }));

    const positionedLinks = topology.links.map((l) => ({
      ...l,
      sourcePos: nodePositions[l.source] || { x: centerX, y: centerY },
      targetPos: nodePositions[l.target] || { x: centerX, y: centerY },
    }));

    return { nodesWithPos: positionedNodes, linksWithPos: positionedLinks };
  }, [topology]);

  const handleZoomIn = () => setZoomScale((prev) => Math.min(prev + 0.25, 2.0));
  const handleZoomOut = () => setZoomScale((prev) => Math.max(prev - 0.25, 0.5));
  const handleZoomReset = () => setZoomScale(1);

  if (topology.nodes.length <= 1) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-base-content/40 bg-base-200/50 rounded-box border border-base-300">
        <p className="text-lg font-medium">No device connections detected</p>
        <p className="text-sm mt-1">
          Devices will appear in the topology diagram as soon as MQTT messages are received.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden bg-base-200/30 rounded-box border border-base-300 p-4">
      {/* Zoom / Reset Controls overlay */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-base-100/90 backdrop-blur border border-base-300 rounded-lg p-1 shadow-sm">
        <button
          className="btn btn-xs btn-ghost btn-square"
          onClick={handleZoomIn}
          title="Zoom In"
        >
          <MdAdd className="text-base" />
        </button>
        <button
          className="btn btn-xs btn-ghost btn-square"
          onClick={handleZoomOut}
          title="Zoom Out"
        >
          <MdRemove className="text-base" />
        </button>
        <button
          className="btn btn-xs btn-ghost btn-square"
          onClick={handleZoomReset}
          title="Reset Zoom"
        >
          <MdRestartAlt className="text-base" />
        </button>
        <span className="text-[10px] font-mono text-base-content/60 px-1 border-l border-base-300">
          {Math.round(zoomScale * 100)}%
        </span>
      </div>

      <svg
        viewBox="0 0 800 500"
        className="w-full h-[480px] select-none transition-transform duration-300 ease-out"
        preserveAspectRatio="xMidYMid meet"
      >
        <g transform={`scale(${zoomScale})`} transform-origin="400 250">
          <defs>
            <linearGradient id="linkGradOnline" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgb(34 197 94)" stopOpacity="0.6" />
              <stop offset="100%" stopColor="rgb(34 197 94)" stopOpacity="0.2" />
            </linearGradient>
            <linearGradient id="linkGradOffline" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgb(239 68 68)" stopOpacity="0.5" />
              <stop offset="100%" stopColor="rgb(239 68 68)" stopOpacity="0.2" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Links */}
          {linksWithPos.map((link, idx) => {
            const isOnline = link.status === "online";
            return (
              <line
                key={idx}
                x1={link.sourcePos.x}
                y1={link.sourcePos.y}
                x2={link.targetPos.x}
                y2={link.targetPos.y}
                stroke={isOnline ? "#22c55e" : "#ef4444"}
                strokeWidth={isOnline ? 2 : 1.5}
                strokeDasharray={isOnline ? "6 4" : "4 4"}
                className={isOnline ? "animate-pulse" : ""}
                opacity={isOnline ? 0.7 : 0.4}
              />
            );
          })}

          {/* Nodes */}
          {nodesWithPos.map((node) => {
            const isBroker = node.type === "broker";
            const isGateway = node.type === "gateway";
            const isSelected = selectedDeviceId === node.id;
            const isOnline = node.status === "online";

            const nodeColor = isBroker
              ? "#3b82f6"
              : isGateway
              ? "#a855f7"
              : isOnline
              ? "#22c55e"
              : "#ef4444";

            return (
              <g
                key={node.id}
                transform={`translate(${node.pos.x}, ${node.pos.y})`}
                className={`cursor-pointer transition-all duration-200 ${
                  isSelected ? "filter drop-shadow-lg" : ""
                }`}
                onClick={() => {
                  if (!isBroker && onSelectDevice) {
                    onSelectDevice(node.id);
                  }
                }}
              >
                {/* Outer selection ring */}
                {isSelected && (
                  <circle
                    r={isBroker ? 32 : 24}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="3"
                    className="animate-pulse"
                  />
                )}

                {/* Status glow */}
                <circle
                  r={isBroker ? 26 : 18}
                  fill={nodeColor}
                  opacity={0.15}
                />

                {/* Core node circle */}
                <circle
                  r={isBroker ? 22 : 14}
                  fill={isBroker ? "#1d4ed8" : isGateway ? "#7e22ce" : "#1f2937"}
                  stroke={nodeColor}
                  strokeWidth={2.5}
                />

                {/* Icon / Symbol inside node */}
                <text
                  textAnchor="middle"
                  dy=".3em"
                  fill="#ffffff"
                  fontSize={isBroker ? 14 : 10}
                  fontWeight="bold"
                  className="pointer-events-none"
                >
                  {isBroker ? "MQTT" : isGateway ? "GW" : "DEV"}
                </text>

                {/* Label below node */}
                <text
                  y={isBroker ? 36 : 28}
                  textAnchor="middle"
                  fill="currentColor"
                  fontSize="11"
                  fontWeight={isSelected ? "bold" : "medium"}
                  className="fill-base-content"
                >
                  {node.label}
                </text>

                {/* Sub-label (IP or MAC if available) */}
                {(node.ip || node.mac) && (
                  <text
                    y={isBroker ? 48 : 40}
                    textAnchor="middle"
                    fontSize="9"
                    className="fill-base-content/50 font-mono"
                  >
                    {node.ip || node.mac}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend */}
      <div className="absolute bottom-3 right-3 bg-base-100/90 backdrop-blur border border-base-300 rounded-box p-2 text-xs flex items-center gap-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <span>Broker</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
          <span>Gateway</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-success" />
          <span>Online</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-error" />
          <span>Offline</span>
        </div>
      </div>
    </div>
  );
}

