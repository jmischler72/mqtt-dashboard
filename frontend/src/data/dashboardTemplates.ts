import type { DashboardImportPayload } from "../utils/dashboardIO";

/** A panel in a starter template. broker_id is omitted so import assigns the default broker. */
export interface TemplatePanel {
  title: string;
  panel_type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config_json: Record<string, unknown>;
}

export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  panels: TemplatePanel[];
}

/** Build the import payload for a template (no broker_id → default broker on import). */
export function templateToImportPayload(
  template: DashboardTemplate,
): DashboardImportPayload {
  return {
    name: template.name,
    panels: template.panels.map((p) => ({ ...p })),
  };
}

// Grid is 12 columns wide; default panels are ~4x4 (separators h=1).
export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    id: "home-automation",
    name: "Home Automation",
    description:
      "Light and switch controls, a manual publisher, and an activity log for a smart home.",
    panels: [
      {
        title: "Home",
        panel_type: "text",
        x: 0,
        y: 0,
        w: 12,
        h: 2,
        config_json: {
          markdown:
            "# 🏠 Home Automation\n\nControl your devices and watch activity live.",
        },
      },
      {
        title: "Living Room Light",
        panel_type: "button",
        x: 0,
        y: 2,
        w: 3,
        h: 3,
        config_json: {
          label: "Toggle Light",
          topic: "home/livingroom/light/set",
          payload: "TOGGLE",
          qos: 0,
          retain: false,
        },
      },
      {
        title: "All Lights Off",
        panel_type: "button",
        x: 3,
        y: 2,
        w: 3,
        h: 3,
        config_json: {
          label: "All Off",
          topic: "home/lights/set",
          payload: "OFF",
          qos: 0,
          retain: false,
        },
      },
      {
        title: "Custom Command",
        panel_type: "input",
        x: 6,
        y: 2,
        w: 6,
        h: 3,
        config_json: { topic: "home/command", qos: 0, retain: false },
      },
      {
        title: "Activity",
        panel_type: "log",
        x: 0,
        y: 5,
        w: 8,
        h: 5,
        config_json: {
          topics: "home/#",
          maxMessages: 100,
          dateFormat: "time",
          showQos: false,
          showRetained: false,
        },
      },
      {
        title: "Broker Stats",
        panel_type: "stats",
        x: 8,
        y: 5,
        w: 4,
        h: 5,
        config_json: {
          showStatTiles: true,
          showChart: true,
          showTopicBreakdown: false,
        },
      },
    ],
  },
  {
    id: "broker-monitoring",
    name: "Broker Monitoring",
    description:
      "Broker health stats, message-activity charts, and a $SYS log to keep an eye on your broker.",
    panels: [
      {
        title: "Broker Health",
        panel_type: "stats",
        x: 0,
        y: 0,
        w: 8,
        h: 6,
        config_json: {
          showStatTiles: true,
          showChart: true,
          showTopicBreakdown: true,
        },
      },
      {
        title: "$SYS Feed",
        panel_type: "log",
        x: 8,
        y: 0,
        w: 4,
        h: 6,
        config_json: {
          topics: "$SYS/#",
          maxMessages: 200,
          dateFormat: "time",
          showQos: true,
          showRetained: true,
        },
      },
    ],
  },
  {
    id: "device-control",
    name: "Device Control",
    description:
      "A control pad of buttons, a manual publisher, a scheduled heartbeat, and a status log.",
    panels: [
      {
        title: "Start",
        panel_type: "button",
        x: 0,
        y: 0,
        w: 3,
        h: 3,
        config_json: {
          label: "Start",
          topic: "device/1/cmd",
          payload: "START",
          qos: 1,
          retain: false,
        },
      },
      {
        title: "Stop",
        panel_type: "button",
        x: 3,
        y: 0,
        w: 3,
        h: 3,
        config_json: {
          label: "Stop",
          topic: "device/1/cmd",
          payload: "STOP",
          qos: 1,
          retain: false,
        },
      },
      {
        title: "Reset",
        panel_type: "button",
        x: 6,
        y: 0,
        w: 3,
        h: 3,
        config_json: {
          label: "Reset",
          topic: "device/1/cmd",
          payload: "RESET",
          qos: 1,
          retain: false,
        },
      },
      {
        title: "Set Value",
        panel_type: "input",
        x: 9,
        y: 0,
        w: 3,
        h: 3,
        config_json: { topic: "device/1/value", qos: 1, retain: false },
      },
      {
        title: "Heartbeat",
        panel_type: "cron",
        x: 0,
        y: 3,
        w: 4,
        h: 4,
        config_json: {
          cron_expr: "*/5 * * * *",
          topic: "device/1/ping",
          payload: "PING",
          qos: 0,
          retain: false,
          enabled: false,
        },
      },
      {
        title: "Device Status",
        panel_type: "log",
        x: 4,
        y: 3,
        w: 8,
        h: 4,
        config_json: {
          topics: "device/1/#",
          maxMessages: 100,
          dateFormat: "time",
          showQos: false,
          showRetained: false,
        },
      },
    ],
  },
  {
    id: "minimal-starter",
    name: "Minimal Starter",
    description: "A blank-slate starting point: a header, one log, and one button.",
    panels: [
      {
        title: "My Dashboard",
        panel_type: "text",
        x: 0,
        y: 0,
        w: 12,
        h: 2,
        config_json: {
          markdown: "# My Dashboard\n\nStart building — add panels in edit mode.",
        },
      },
      {
        title: "Messages",
        panel_type: "log",
        x: 0,
        y: 2,
        w: 8,
        h: 5,
        config_json: {
          topics: "#",
          maxMessages: 100,
          dateFormat: "time",
          showQos: false,
          showRetained: false,
        },
      },
      {
        title: "Publish",
        panel_type: "button",
        x: 8,
        y: 2,
        w: 4,
        h: 3,
        config_json: {
          label: "Send",
          topic: "test/topic",
          payload: "hello",
          qos: 0,
          retain: false,
        },
      },
    ],
  },
];
