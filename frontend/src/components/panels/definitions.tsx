import {
  MdSpeed,
  MdListAlt,
  MdBarChart,
  MdSmartButton,
  MdInput,
  MdSchedule,
  MdNotes,
  MdHorizontalRule,
  MdImage,
} from "react-icons/md";
import { api } from "../../api/client";
import type { PanelDefinition } from "./types";
import GaugePanel, {
  GaugeConfigModal,
  type GaugeConfig,
} from "./GaugePanel";
import LogPanel, { LogConfigModal, type LogConfig } from "./LogPanel";
import BrokerStatsPanel, {
  BrokerStatsConfigModal,
  type BrokerStatsConfig,
} from "./BrokerStatsPanel";
import ButtonPanel, {
  ButtonConfigModal,
  type ButtonConfig,
} from "./ButtonPanel";
import InputPanel, {
  InputConfigModal,
  type InputConfig,
} from "./InputPanel";
import CronPanel, { CronConfigModal, type CronConfig } from "./CronPanel";
import TextPanel, { TextConfigModal, type TextConfig } from "./TextPanel";
import SeparatorPanel, {
  SeparatorConfigModal,
  type SeparatorConfig,
} from "./SeparatorPanel";
import ImagePanel, {
  ImageConfigModal,
  type ImageConfig,
} from "./ImagePanel";

export const gaugePanelDefinition: PanelDefinition<GaugeConfig> = {
  type: "gauge",
  label: "Gauge",
  category: "monitor",
  icon: MdSpeed,
  description:
    "Live numeric, boolean, or status gauge visualization with radial, bar, and value displays.",
  resolvePickedTopic: (_existing, picked) => picked,
  preview: (
    <div className="flex flex-col items-center justify-center h-full gap-1 p-2">
      <div className="relative flex items-center justify-center w-12 h-12">
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full transform -rotate-90"
        >
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            className="text-base-content/10"
          />
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray="251.327"
            strokeDashoffset="70"
            className="text-primary"
          />
        </svg>
        <span className="absolute text-[10px] font-bold font-mono text-base-content">
          24°C
        </span>
      </div>
      <span className="text-[10px] text-base-content/50 font-mono">
        sensor/temp
      </span>
    </div>
  ),
  Component: GaugePanel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConfigModal: GaugeConfigModal as any,
};

export const logPanelDefinition: PanelDefinition<LogConfig> = {
  type: "log",
  label: "Log",
  category: "monitor",
  icon: MdListAlt,
  description:
    "Streaming log of live incoming MQTT messages with pause/clear, QoS, and retained indicators.",
  preview: (
    <div className="flex flex-col h-full gap-1">
      <div className="flex gap-1 pb-1">
        <span className="btn btn-xs pointer-events-none">Clear</span>
        <span className="btn btn-xs pointer-events-none">Pause</span>
        <span className="text-xs text-base-content/50 ml-auto self-center">
          3 msgs
        </span>
      </div>
      <div className="flex-1 bg-neutral text-neutral-content rounded font-mono text-xs p-2 space-y-0.5">
        {[
          { topic: "sensor/temp", payload: "22.4" },
          { topic: "sensor/hum", payload: "61%" },
          { topic: "device/status", payload: "online" },
        ].map((m, i) => (
          <div key={i} className="leading-tight">
            <span className="text-neutral-content/70">[12:00:0{i}]</span>{" "}
            <span className="text-accent">{m.topic}</span>{" "}
            <span>{m.payload}</span>
          </div>
        ))}
      </div>
    </div>
  ),
  Component: LogPanel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConfigModal: LogConfigModal as any,
};

export const brokerStatsPanelDefinition: PanelDefinition<BrokerStatsConfig> = {
  type: "stats",
  label: "Stats",
  category: "monitor",
  icon: MdBarChart,
  description:
    "Real-time broker throughput statistics, message rates, topic breakdowns, and historical sparklines.",
  preview: (
    <div className="flex flex-col gap-2 h-full">
      <div className="grid grid-cols-2 gap-1">
        {[
          { label: "Msg/s", value: "4.2" },
          { label: "Total", value: "1.2k" },
          { label: "Topics", value: "8" },
          { label: "Data in", value: "3.1k" },
        ].map((s) => (
          <div key={s.label} className="bg-base-200 rounded p-1 text-center">
            <div className="text-xs text-base-content/50">{s.label}</div>
            <div className="text-sm font-bold">{s.value}</div>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 100 30" className="w-full opacity-60">
        <polyline
          points="0,28 20,20 40,22 60,10 80,14 100,6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-primary"
        />
      </svg>
    </div>
  ),
  Component: BrokerStatsPanel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConfigModal: BrokerStatsConfigModal as any,
};

export const buttonPanelDefinition: PanelDefinition<ButtonConfig> = {
  type: "button",
  label: "Button",
  category: "control",
  icon: MdSmartButton,
  description:
    "Interactive push button to publish a custom MQTT payload, with optional QoS, retain, and confirmation modal.",
  preview: (
    <div className="flex items-center justify-center h-full py-4">
      <button className="btn btn-primary btn-lg pointer-events-none">
        Click
      </button>
    </div>
  ),
  Component: ButtonPanel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConfigModal: ButtonConfigModal as any,
};

export const inputPanelDefinition: PanelDefinition<InputConfig> = {
  type: "input",
  label: "Input",
  category: "control",
  icon: MdInput,
  description:
    "Text area input to dynamically author and publish payload messages to MQTT topics.",
  isEmpty: (config) =>
    !config?.topic?.trim()
      ? {
          message: "No topic configured — open settings to add topic",
          actionLabel: "Configure Topic",
        }
      : null,
  preview: (
    <div className="flex flex-col gap-2 p-1 h-full">
      <textarea
        className="textarea textarea-bordered font-mono flex-1 resize-none w-full text-xs pointer-events-none"
        placeholder="Enter payload…"
        readOnly
        value=""
      />
      <button className="btn btn-sm btn-primary pointer-events-none">
        Publish
      </button>
    </div>
  ),
  Component: InputPanel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConfigModal: InputConfigModal as any,
};

export const cronPanelDefinition: PanelDefinition<CronConfig> = {
  type: "cron",
  label: "Cron",
  category: "control",
  icon: MdSchedule,
  description:
    "Scheduled automated MQTT publisher with cron expressions, countdown progress bar, and pause/resume switch.",
  isEmpty: (config) =>
    !config?.cron_expr?.trim()
      ? {
          message: "No schedule configured — open settings to set schedule",
          actionLabel: "Configure Schedule",
        }
      : null,
  onSaveConfig: async (panelId, config, brokerId) => {
    await api.post(`/api/cron/${panelId}`, {
      ...config,
      broker_id: brokerId,
    });
  },
  preview: (
    <div className="flex flex-col gap-3 p-1 h-full">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono bg-base-200 rounded px-2 py-1">
          every minute
        </span>
        <input
          type="checkbox"
          className="toggle toggle-primary toggle-sm pointer-events-none"
          readOnly
          checked
        />
      </div>
      <div className="flex flex-col items-center justify-center gap-1 flex-1">
        <div className="text-xs text-base-content/50">Next run in</div>
        <div className="text-xl font-bold font-mono">00:42</div>
        <progress
          className="progress progress-primary w-full"
          value={30}
          max="100"
        />
      </div>
    </div>
  ),
  Component: CronPanel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConfigModal: CronConfigModal as any,
};

export const textPanelDefinition: PanelDefinition<TextConfig> = {
  type: "text",
  label: "Text",
  category: "visual",
  icon: MdNotes,
  isVisual: true,
  description:
    "Rich formatted text, notes, headings, and instructions rendered with Markdown.",
  isEmpty: (config) =>
    !config?.markdown?.trim()
      ? {
          message: "Empty text panel — open settings to add content",
          actionLabel: "Edit Text",
        }
      : null,
  preview: (
    <div className="flex flex-col gap-1 p-2 h-full justify-center">
      <div className="h-2 w-2/3 bg-base-content/30 rounded" />
      <div className="h-1.5 w-full bg-base-content/15 rounded" />
      <div className="h-1.5 w-5/6 bg-base-content/15 rounded" />
      <div className="h-1.5 w-3/4 bg-base-content/15 rounded" />
    </div>
  ),
  Component: TextPanel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConfigModal: TextConfigModal as any,
};

export const separatorPanelDefinition: PanelDefinition<SeparatorConfig> = {
  type: "separator",
  label: "Separator",
  category: "visual",
  icon: MdHorizontalRule,
  isVisual: true,
  description:
    "Divider line with customizable horizontal or vertical orientation to visually structure dashboards.",
  getMinMaxConstraints: (config) => {
    const orient = config?.orientation ?? "horizontal";
    if (orient === "horizontal") {
      return { minW: 1, minH: 1, maxH: 1 };
    }
    return { minW: 1, minH: 1, maxW: 1 };
  },
  preview: (
    <div className="flex items-center justify-center h-full px-2">
      <div className="w-full h-0.5 bg-base-content/40 rounded-full" />
    </div>
  ),
  Component: SeparatorPanel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConfigModal: SeparatorConfigModal as any,
};

export const imagePanelDefinition: PanelDefinition<ImageConfig> = {
  type: "image",
  label: "Image",
  category: "visual",
  icon: MdImage,
  isVisual: true,
  description:
    "Static or web-hosted image, photo, or logo with built-in upload and preset gallery support.",
  isEmpty: (config) =>
    !config?.src?.trim()
      ? {
          message: "No image — open settings to choose one",
          actionLabel: "Choose Image",
        }
      : null,
  preview: (
    <div className="flex items-center justify-center h-full p-2">
      <div className="flex items-center justify-center w-full h-full bg-base-200 rounded">
        <MdImage className="text-3xl text-base-content/30" />
      </div>
    </div>
  ),
  Component: ImagePanel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConfigModal: ImageConfigModal as any,
};
