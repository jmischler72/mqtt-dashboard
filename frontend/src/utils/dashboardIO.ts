import type { Panel } from "../pages/DashboardPage";

export const EXPORT_TYPE = "mqtt-dashboard-export";
export const EXPORT_VERSION = 1;

/** A panel as it appears in an export envelope (install-specific ids stripped). */
export interface ExportPanel {
  title: string;
  panel_type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config_json: Record<string, unknown>;
  broker_id: string;
}

export interface DashboardExport {
  type: typeof EXPORT_TYPE;
  version: typeof EXPORT_VERSION;
  name: string;
  panels: ExportPanel[];
}

/** A single panel in an import payload (broker_id optional). */
export type ImportPanel = Omit<ExportPanel, "broker_id"> & {
  broker_id?: string;
};

/** Shape accepted by POST /api/dashboards/import. */
export interface DashboardImportPayload {
  type?: string;
  version?: number;
  name: string;
  panels: ImportPanel[];
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "dashboard";
}

/** Build the export envelope for a dashboard, stripping install-specific ids. */
export function buildDashboardExport(
  name: string,
  panels: Panel[],
): DashboardExport {
  return {
    type: EXPORT_TYPE,
    version: EXPORT_VERSION,
    name,
    panels: panels.map((p) => ({
      title: p.title,
      panel_type: p.panel_type,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      config_json: p.config_json,
      broker_id: p.broker_id,
    })),
  };
}

/** Serialize and trigger a browser download of the dashboard as JSON. */
export function exportDashboard(name: string, panels: Panel[]): void {
  const envelope = buildDashboardExport(name, panels);
  const blob = new Blob([JSON.stringify(envelope, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(name)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Parse and validate a dashboard export JSON string.
 * Throws an Error with a user-friendly message on invalid input.
 */
export function parseDashboardImport(text: string): {
  name: string;
  panels: ExportPanel[];
} {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }

  if (typeof data !== "object" || data === null) {
    throw new Error("File is not a valid dashboard export.");
  }
  const obj = data as Record<string, unknown>;

  if (obj.type !== EXPORT_TYPE) {
    throw new Error("This file is not an MQTT dashboard export.");
  }
  if (obj.version !== EXPORT_VERSION) {
    throw new Error(`Unsupported export version: ${String(obj.version)}.`);
  }
  if (typeof obj.name !== "string" || obj.name.trim() === "") {
    throw new Error("Export is missing a dashboard name.");
  }
  if (!Array.isArray(obj.panels)) {
    throw new Error("Export is missing its panels.");
  }

  const panels: ExportPanel[] = obj.panels.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new Error(`Panel ${i + 1} is malformed.`);
    }
    const p = raw as Record<string, unknown>;
    if (typeof p.panel_type !== "string" || p.panel_type === "") {
      throw new Error(`Panel ${i + 1} is missing its type.`);
    }
    return {
      title: typeof p.title === "string" ? p.title : "Panel",
      panel_type: p.panel_type,
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      w: Number(p.w) || 4,
      h: Number(p.h) || 4,
      config_json:
        typeof p.config_json === "object" && p.config_json !== null
          ? (p.config_json as Record<string, unknown>)
          : {},
      broker_id: typeof p.broker_id === "string" ? p.broker_id : "",
    };
  });

  return { name: obj.name, panels };
}
