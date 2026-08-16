import { useState } from "react";
import { RiSettings3Line, RiArrowRightSLine, RiArrowDownSLine } from "react-icons/ri";

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

  return (
    <div className="border border-base-300 bg-base-200/40 rounded-xl p-3.5 flex flex-col gap-3 transition-all">
      {/* Clickable Header */}
      <button
        type="button"
        className="flex items-center justify-between w-full text-left cursor-pointer group select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-1.5 font-medium text-xs text-base-content/80 group-hover:text-base-content transition-colors">
          {open ? (
            <RiArrowDownSLine className="text-sm shrink-0 text-base-content/60" />
          ) : (
            <RiArrowRightSLine className="text-sm shrink-0 text-base-content/60" />
          )}
          <RiSettings3Line className="text-accent text-sm shrink-0" />
          <span>MQTT Options</span>
        </div>
        <span className="badge badge-xs font-mono text-[10px] badge-ghost opacity-80">
          QoS {qos} · {retain ? "Retain ON" : "No retain"}
        </span>
      </button>

      {/* Collapsible Content */}
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-base-300/60">
          <fieldset className="fieldset p-0 border-0">
            <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
              QoS (Quality of Service)
            </legend>
            <select
              className="select select-bordered select-sm w-full font-medium"
              value={qos}
              onChange={(e) => onQosChange(Number(e.target.value))}
            >
              <option value={0}>0 – At most once</option>
              <option value={1}>1 – At least once</option>
              <option value={2}>2 – Exactly once</option>
            </select>
          </fieldset>

          <fieldset className="fieldset p-0 border-0 flex flex-col justify-end">
            <legend className="fieldset-legend font-medium text-xs text-base-content/80 mb-1">
              Retain Message
            </legend>
            <label className="flex items-center justify-between cursor-pointer p-1.5 px-3 rounded-lg border border-base-300 bg-base-100 h-9">
              <span className="text-xs font-medium text-base-content/80">
                Retain on broker
              </span>
              <input
                type="checkbox"
                className="toggle toggle-xs toggle-primary"
                checked={retain}
                onChange={(e) => onRetainChange(e.target.checked)}
              />
            </label>
          </fieldset>
        </div>
      )}
    </div>
  );
}
