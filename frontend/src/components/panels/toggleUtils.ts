import { parseGaugePayload } from "./gaugeUtils";

export interface ToggleParseOptions {
  onPayload?: string;
  offPayload?: string;
  valueKey?: string;
}

export const DEFAULT_ON_PAYLOAD = "ON";
export const DEFAULT_OFF_PAYLOAD = "OFF";

/**
 * Pull the meaningful part out of a payload. With a valueKey set, a JSON object
 * payload is unwrapped to that key; everything else is returned trimmed as-is.
 */
export function extractPayloadValue(payload: string, valueKey?: string): string {
  if (!valueKey?.trim()) return payload.trim();

  try {
    const json = JSON.parse(payload);
    if (typeof json === "object" && json !== null && !Array.isArray(json)) {
      const key = valueKey.trim();
      if (key in json) {
        const target = (json as Record<string, unknown>)[key];
        return target === null || target === undefined
          ? ""
          : String(target).trim();
      }
    }
  } catch {
    // Not JSON — fall through to the raw payload
  }

  return payload.trim();
}

/**
 * Resolve an MQTT payload into a toggle position.
 * Returns null when the payload cannot be mapped to on/off, so the panel can
 * show "unknown" rather than guessing.
 */
export function parseToggleState(
  payload: string,
  options: ToggleParseOptions = {},
): boolean | null {
  const value = extractPayloadValue(payload, options.valueKey);
  if (value === "") return null;

  const onPayload = (options.onPayload ?? DEFAULT_ON_PAYLOAD).trim();
  const offPayload = (options.offPayload ?? DEFAULT_OFF_PAYLOAD).trim();
  const lower = value.toLowerCase();

  if (onPayload && lower === onPayload.toLowerCase()) return true;
  if (offPayload && lower === offPayload.toLowerCase()) return false;

  // Fall back to the shared truthiness table (true/on/yes/online, numbers, ...)
  const parsed = parseGaugePayload(value);
  if (parsed.dataType === "boolean") return Boolean(parsed.parsedValue);
  if (parsed.dataType === "number") return Number(parsed.parsedValue) !== 0;

  return null;
}
