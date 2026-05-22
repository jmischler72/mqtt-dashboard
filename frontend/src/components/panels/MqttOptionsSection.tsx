import { useState } from "react";
import { RiArrowDownSLine, RiArrowRightSLine } from "react-icons/ri";

interface Props {
  qos: number;
  retain: boolean;
  onQosChange: (qos: number) => void;
  onRetainChange: (retain: boolean) => void;
}

export default function MqttOptionsSection({
  qos,
  retain,
  onQosChange,
  onRetainChange,
}: Props) {
  const [open, setOpen] = useState(false);

  const summary = `QoS ${qos} · ${retain ? "Retain on" : "No retain"}`;

  return (
    <div className="border border-base-300 rounded-btn text-sm">
      <button
        type="button"
        className="flex items-center gap-1 w-full px-2 py-1 text-base-content/60 hover:text-base-content transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <RiArrowDownSLine className="shrink-0" />
        ) : (
          <RiArrowRightSLine className="shrink-0" />
        )}
        <span className="font-mono text-xs">{summary}</span>
      </button>
      {open && (
        <div className="flex gap-4 px-3 pb-2 pt-1 flex-wrap">
          <label className="flex items-center gap-2">
            <span className="text-xs text-base-content/70">QoS</span>
            <select
              className="select select-xs select-bordered"
              value={qos}
              onChange={(e) => onQosChange(Number(e.target.value))}
            >
              <option value={0}>0 – At most once</option>
              <option value={1}>1 – At least once</option>
              <option value={2}>2 – Exactly once</option>
            </select>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-base-content/70">Retain</span>
            <input
              type="checkbox"
              className="toggle toggle-xs toggle-primary"
              checked={retain}
              onChange={(e) => onRetainChange(e.target.checked)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
