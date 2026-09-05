import {
  VALUE_TOKEN,
  extractValue,
  readValue,
  suggestPaths,
  templateFromValueKey,
} from "./payloadShape";

export interface GraphPoint {
  t: number;
  v: number;
}

export interface GraphSeries {
  topic: string;
  points: GraphPoint[];
}

export interface GraphBounds {
  minT: number;
  maxT: number;
  minV: number;
  maxV: number;
}

export type CurveType = "linear" | "step" | "smooth";

/** Tailwind/daisyUI class pairs used to colour each series consistently. */
export const SERIES_COLORS = [
  { stroke: "text-primary", swatch: "bg-primary" },
  { stroke: "text-secondary", swatch: "bg-secondary" },
  { stroke: "text-accent", swatch: "bg-accent" },
  { stroke: "text-info", swatch: "bg-info" },
  { stroke: "text-success", swatch: "bg-success" },
  { stroke: "text-warning", swatch: "bg-warning" },
  { stroke: "text-error", swatch: "bg-error" },
];

export function seriesColor(index: number) {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

export interface GraphShape {
  /** The read shape, with `{value}` marking the part to plot. */
  template?: string;
  /** Legacy dot path, still honoured for panels saved before shapes existed. */
  path?: string;
}

/**
 * Extract a plottable number from an MQTT payload. Booleans are mapped to 1/0
 * so on/off style topics can still be charted; text has no place on an axis and
 * yields null, which the caller drops rather than plotting as zero.
 */
export function parseNumericPayload(
  payload: string,
  shape: GraphShape = {},
): number | null {
  const { value, dataType } = readValue(
    shape.template?.trim() || undefined,
    payload,
    shape.path?.trim() || undefined,
  );
  if (dataType === "number") {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  if (dataType === "boolean") {
    return value ? 1 : 0;
  }
  return null;
}

/**
 * The first plottable value anywhere in a payload, for the explorer — which
 * charts whatever topic is clicked and has no shape to configure. A bare number
 * is taken as-is; a JSON document is searched by the same ranked paths the
 * config modal suggests, so `{"value": 21.4, ...}` charts its value rather than
 * being skipped as text.
 */
export function autoNumericPayload(payload: string): number | null {
  const direct = parseNumericPayload(payload);
  if (direct !== null) return direct;

  for (const path of suggestPaths(payload)) {
    const { value, dataType } = extractValue(payload, path);
    if (dataType === "number") {
      const num = Number(value);
      if (Number.isFinite(num)) return num;
    }
    if (dataType === "boolean") return value ? 1 : 0;
  }

  return null;
}

/**
 * The read shape a stored graph should open with — the same fallback chain the
 * gauge uses, so a panel saved with only a dot path is drawn as the shape it
 * was really describing.
 */
export function graphReadTemplate(config: {
  readTemplate?: string;
  valueKey?: string;
}): string {
  const stored =
    config.readTemplate !== undefined
      ? config.readTemplate
      : templateFromValueKey(config.valueKey);
  return stored.trim() || VALUE_TOKEN;
}

interface TrimOptions {
  maxPoints?: number;
  windowMs?: number;
  now?: number;
}

interface AppendOptions extends TrimOptions {
  /** Ignore new topics once this many lines are already plotted. */
  maxSeries?: number;
}

/** Drop points outside the time window and above the per-series point budget. */
export function trimPoints(
  points: GraphPoint[],
  { maxPoints = 200, windowMs = 0, now = Date.now() }: TrimOptions = {},
): GraphPoint[] {
  let next = points;
  if (windowMs > 0) {
    const cutoff = now - windowMs;
    next = next.filter((p) => p.t >= cutoff);
  }
  if (maxPoints > 0 && next.length > maxPoints) {
    next = next.slice(next.length - maxPoints);
  }
  return next;
}

/** Immutably append a point to the matching series, creating it when needed. */
export function appendPoint(
  series: GraphSeries[],
  topic: string,
  point: GraphPoint,
  options: AppendOptions = {},
): GraphSeries[] {
  const index = series.findIndex((s) => s.topic === topic);
  if (index === -1) {
    // A wildcard subscription can match hundreds of topics; keep the chart
    // readable by only plotting the first few that publish numbers.
    if (options.maxSeries !== undefined && series.length >= options.maxSeries) {
      return series;
    }
    return [...series, { topic, points: trimPoints([point], options) }];
  }
  const target = series[index];
  // Messages can arrive slightly out of order; keep points sorted by time so
  // the line never folds back on itself.
  const points = [...target.points, point];
  if (points.length > 1 && point.t < points[points.length - 2].t) {
    points.sort((a, b) => a.t - b.t);
  }
  const next = [...series];
  next[index] = { topic, points: trimPoints(points, options) };
  return next;
}

/** Apply the trim options to every series and drop the ones left empty. */
export function trimSeries(
  series: GraphSeries[],
  options: TrimOptions = {},
): GraphSeries[] {
  return series
    .map((s) => ({ topic: s.topic, points: trimPoints(s.points, options) }))
    .filter((s) => s.points.length > 0);
}

export function computeBounds(
  series: GraphSeries[],
  yMin?: number,
  yMax?: number,
): GraphBounds | null {
  let minT = Infinity;
  let maxT = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;

  for (const s of series) {
    for (const p of s.points) {
      if (p.t < minT) minT = p.t;
      if (p.t > maxT) maxT = p.t;
      if (p.v < minV) minV = p.v;
      if (p.v > maxV) maxV = p.v;
    }
  }

  if (!Number.isFinite(minT) || !Number.isFinite(minV)) return null;

  if (Number.isFinite(yMin as number)) minV = yMin as number;
  if (Number.isFinite(yMax as number)) maxV = yMax as number;

  if (maxV === minV) {
    // Flat series: open up a symmetric band so the line sits mid-chart.
    const pad = Math.abs(maxV) > 0 ? Math.abs(maxV) * 0.1 : 1;
    minV -= pad;
    maxV += pad;
  } else if (maxV < minV) {
    [minV, maxV] = [maxV, minV];
  }

  return { minT, maxT, minV, maxV };
}

export function projectX(
  t: number,
  bounds: GraphBounds,
  width: number,
): number {
  const span = bounds.maxT - bounds.minT;
  if (span <= 0) return width;
  return ((t - bounds.minT) / span) * width;
}

export function projectY(
  v: number,
  bounds: GraphBounds,
  height: number,
): number {
  const span = bounds.maxV - bounds.minV;
  if (span <= 0) return height / 2;
  const ratio = (v - bounds.minV) / span;
  return height - Math.min(Math.max(ratio, 0), 1) * height;
}

/** Build the SVG path data for one series in the given pixel box. */
export function buildLinePath(
  points: GraphPoint[],
  bounds: GraphBounds,
  width: number,
  height: number,
  curve: CurveType = "linear",
): string {
  if (points.length === 0) return "";
  const coords = points.map((p) => ({
    x: projectX(p.t, bounds, width),
    y: projectY(p.v, bounds, height),
  }));

  if (coords.length === 1) {
    const { x, y } = coords[0];
    return `M ${x} ${y} L ${x} ${y}`;
  }

  if (curve === "step") {
    let d = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) {
      d += ` L ${coords[i].x} ${coords[i - 1].y} L ${coords[i].x} ${coords[i].y}`;
    }
    return d;
  }

  if (curve === "smooth") {
    // Monotone cubic (Fritsch-Carlson): a plain Catmull-Rom overshoots on the
    // spiky, unevenly spaced points a sensor actually produces, drawing loops
    // and readings the device never sent. This one never leaves the interval
    // between two neighbouring values.
    const n = coords.length;
    const slopes: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = coords[i + 1].x - coords[i].x;
      slopes.push(dx === 0 ? 0 : (coords[i + 1].y - coords[i].y) / dx);
    }

    const tangents: number[] = new Array(n);
    tangents[0] = slopes[0];
    tangents[n - 1] = slopes[n - 2];
    for (let i = 1; i < n - 1; i++) {
      const before = slopes[i - 1];
      const after = slopes[i];
      // A local extremum flattens, which is what keeps the curve inside the
      // data; elsewhere the tangent is the average of the two slopes.
      tangents[i] = before * after <= 0 ? 0 : (before + after) / 2;
    }

    // Clamp each tangent so no segment can bulge past its own endpoints.
    for (let i = 0; i < n - 1; i++) {
      if (slopes[i] === 0) {
        tangents[i] = 0;
        tangents[i + 1] = 0;
        continue;
      }
      const a = tangents[i] / slopes[i];
      const b = tangents[i + 1] / slopes[i];
      const h = Math.hypot(a, b);
      if (h > 3) {
        tangents[i] = (3 / h) * a * slopes[i];
        tangents[i + 1] = (3 / h) * b * slopes[i];
      }
    }

    let d = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 0; i < n - 1; i++) {
      const dx = coords[i + 1].x - coords[i].x;
      const c1x = coords[i].x + dx / 3;
      const c1y = coords[i].y + (tangents[i] * dx) / 3;
      const c2x = coords[i + 1].x - dx / 3;
      const c2y = coords[i + 1].y - (tangents[i + 1] * dx) / 3;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${coords[i + 1].x} ${coords[i + 1].y}`;
    }
    return d;
  }

  return coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
}

/** Close a line path down to the baseline so it can be filled. */
export function buildAreaPath(
  linePath: string,
  points: GraphPoint[],
  bounds: GraphBounds,
  width: number,
  height: number,
): string {
  if (!linePath || points.length === 0) return "";
  const firstX = projectX(points[0].t, bounds, width);
  const lastX = projectX(points[points.length - 1].t, bounds, width);
  return `${linePath} L ${lastX} ${height} L ${firstX} ${height} Z`;
}

/** Evenly spaced value ticks between the bounds, rounded for display. */
export function valueTicks(bounds: GraphBounds, count = 4): number[] {
  const ticks: number[] = [];
  const steps = Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    ticks.push(bounds.minV + ((bounds.maxV - bounds.minV) * i) / steps);
  }
  return ticks;
}

export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "–";
  const abs = Math.abs(value);
  if (abs >= 10000) return value.toExponential(1);
  if (Number.isInteger(value)) return String(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

export function formatTimeLabel(t: number): string {
  const d = new Date(t);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Nearest point (by time) in a series, used for the hover crosshair. */
export function nearestPoint(
  points: GraphPoint[],
  t: number,
): GraphPoint | null {
  if (points.length === 0) return null;
  let best = points[0];
  let bestDist = Math.abs(best.t - t);
  for (let i = 1; i < points.length; i++) {
    const dist = Math.abs(points[i].t - t);
    if (dist < bestDist) {
      best = points[i];
      bestDist = dist;
    }
  }
  return best;
}
