import { readValue } from "./payloadShape";

export const DEFAULT_MIN = 0;
export const DEFAULT_MAX = 100;
export const DEFAULT_STEP = 1;

export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

/**
 * Fall back to the defaults for anything missing or non-finite, and keep the
 * range usable: an inverted or empty range would make the track undraggable.
 */
export function normalizeRange(config: {
  min?: number;
  max?: number;
  step?: number;
}): SliderRange {
  const min = Number.isFinite(config.min) ? Number(config.min) : DEFAULT_MIN;
  const rawMax = Number.isFinite(config.max) ? Number(config.max) : DEFAULT_MAX;
  const max = rawMax > min ? rawMax : min + 1;

  const rawStep = Number.isFinite(config.step)
    ? Number(config.step)
    : DEFAULT_STEP;
  const step = rawStep > 0 ? rawStep : DEFAULT_STEP;

  return { min, max, step };
}

/**
 * Snap a value onto the configured range. Steps are counted from `min` so a
 * range like 10..30 step 5 yields 10/15/20/…, and the result is rounded to the
 * step's own precision to avoid 0.30000000000000004 showing up in a payload.
 */
export function clampToRange(value: number, range: SliderRange): number {
  const { min, max, step } = range;
  if (!Number.isFinite(value)) return min;
  if (value <= min) return min;
  if (value >= max) return max;

  const snapped = min + Math.round((value - min) / step) * step;
  const decimals = decimalsOf(step);
  const rounded = Number(snapped.toFixed(decimals));

  return Math.min(max, Math.max(min, rounded));
}

function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * Read a slider position out of an incoming payload, using the panel's own
 * payload shape to find it. Returns null when the payload holds no number, so
 * the panel can show "unknown" instead of snapping the handle to an invented
 * position.
 */
export function parseSliderValue(
  payload: string,
  shape: { template?: string } = {},
): number | null {
  const { value, dataType } = readValue(shape.template, payload);
  if (dataType !== "number") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Position as a 0..1 fraction of the range, for the filled track. */
export function valueToFraction(value: number, range: SliderRange): number {
  const span = range.max - range.min;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (value - range.min) / span));
}
