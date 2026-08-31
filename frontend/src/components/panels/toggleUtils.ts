import { parseGaugePayload } from "./gaugeUtils";
import {
  hasToken,
  matchTemplate,
  migrateTemplate,
  parseLooseJson,
  renderPayload,
  resolvePath,
} from "./payloadShape";

export interface ToggleShape {
  /** The exact bytes published for on. */
  onPayload?: string;
  /** The exact bytes published for off. */
  offPayload?: string;
  /** Read shape, with `{value}` marking the value to compare. */
  readTemplate?: string;
  /** Legacy dot path, honoured when no shape marks the value. */
  valueKey?: string;
}

export const DEFAULT_ON_PAYLOAD = "ON";
export const DEFAULT_OFF_PAYLOAD = "OFF";

/**
 * The two payloads a stored toggle publishes: each state's value dropped into
 * the shared message template.
 *
 * A template of nothing but the chip publishes the value on its own, which is
 * both the default and what a config saved with its states written out in full
 * amounts to — so those keep publishing exactly the bytes they always did.
 */
export function toggleWritePayloads(config: {
  onPayload?: string;
  offPayload?: string;
  payloadTemplate?: string;
}): { on: string; off: string } {
  const on = config.onPayload ?? DEFAULT_ON_PAYLOAD;
  const off = config.offPayload ?? DEFAULT_OFF_PAYLOAD;
  const template = migrateTemplate(config.payloadTemplate);

  if (!template || !hasToken(template)) return { on, off };

  return {
    on: renderPayload(template, on),
    off: renderPayload(template, off),
  };
}

/**
 * Pull the part of a payload the toggle compares. The read shape's chip marks
 * it; without a shape the whole payload is the value, which is what a device
 * echoing `ON` on its own command topic sends.
 */
export function extractPayloadValue(
  payload: string,
  shape: Pick<ToggleShape, "readTemplate" | "valueKey"> = {},
): string {
  const template = shape.readTemplate?.trim();

  if (template && hasToken(template)) {
    const marked = matchTemplate(template, payload);
    if (marked !== null) return marked.trim();
  }

  const path = shape.valueKey?.trim();
  if (path) {
    // Deliberately not the typed extractor: the value is compared as text
    // against the configured payloads, so "ON" must stay "ON" rather than
    // being coerced into a boolean first.
    const json = parseLooseJson(payload);
    if (typeof json === "object" && json !== null) {
      const resolved = resolvePath(json, path);
      if (resolved.found) {
        const target = resolved.value;
        return target === null || target === undefined
          ? ""
          : String(target).trim();
      }
    }
  }

  return payload.trim();
}

/**
 * Resolve an MQTT payload into a toggle position.
 *
 * The incoming value is compared against the same part of the configured on and
 * off payloads — read through the same shape — so a device reporting
 * `{"state":"ON","rssi":-60}` still matches an on payload of `{"state":"ON"}`.
 * Returns null when the payload maps to neither, so the panel can show
 * "unknown" rather than guessing.
 */
export function parseToggleState(
  payload: string,
  shape: ToggleShape = {},
): boolean | null {
  const value = extractPayloadValue(payload, shape);
  if (value === "") return null;

  const onRef = extractPayloadValue(
    shape.onPayload ?? DEFAULT_ON_PAYLOAD,
    shape,
  );
  const offRef = extractPayloadValue(
    shape.offPayload ?? DEFAULT_OFF_PAYLOAD,
    shape,
  );
  const lower = value.toLowerCase();

  if (onRef && lower === onRef.toLowerCase()) return true;
  if (offRef && lower === offRef.toLowerCase()) return false;

  // Fall back to the shared truthiness table (true/on/yes/online, numbers, ...)
  const parsed = parseGaugePayload(value);
  if (parsed.dataType === "boolean") return Boolean(parsed.parsedValue);
  if (parsed.dataType === "number") return Number(parsed.parsedValue) !== 0;

  return null;
}
