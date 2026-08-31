import { parseGaugePayload } from "./gaugeUtils";
import {
  deriveReadPath,
  hasToken,
  matchTemplate,
  migrateTemplate,
  parseLooseJson,
  renderPayload,
  resolvePath,
  templateFromValueKey,
} from "./payloadShape";

export interface ToggleShape {
  /** The exact bytes published for on. */
  onPayload?: string;
  /** The exact bytes published for off. */
  offPayload?: string;
  /** Read shape, with `{value}` marking the value to compare. */
  readTemplate?: string;
  /** Write shape, needed to recognise a panel's own bytes echoed back. */
  payloadTemplate?: string;
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
 * The read shape a stored toggle should open with. A panel saved with only a
 * dot path is drawn as the shape it was really describing, so the box says what
 * the panel actually reads — the gauge opens the same way.
 *
 * Blank stays blank: for a toggle that is a real answer, the whole payload,
 * which is what a device echoing `ON` on its state topic sends.
 */
export function toggleReadTemplate(config: {
  readTemplate?: string;
  valueKey?: string;
}): string {
  return config.readTemplate !== undefined
    ? migrateTemplate(config.readTemplate)
    : templateFromValueKey(config.valueKey);
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

  // Mirrors `readValue`: a stencil that did not line up still names the field
  // it was describing, so the path it implies is tried before the stored key.
  // Without this the panel and the modal's preview read the same message
  // differently — the preview has always had this fallback.
  const path =
    (template ? deriveReadPath(template) : null) ?? shape.valueKey?.trim();
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
 * What an incoming value can equal for one state.
 *
 * Two things count, because a toggle is read in two situations. A panel with no
 * read shape of its own sees the bytes it published come back, so the rendered
 * message is the reference; a panel that reads a different shape gets the chip's
 * contents, which is the configured value itself. Legacy configs stored the
 * whole message in `onPayload`, so that is read through the shape as well.
 *
 * All three describe the same state, so testing them together cannot cross the
 * two states' wires.
 */
function stateReferences(shape: ToggleShape, which: "on" | "off"): string[] {
  const configured =
    which === "on"
      ? (shape.onPayload ?? DEFAULT_ON_PAYLOAD)
      : (shape.offPayload ?? DEFAULT_OFF_PAYLOAD);
  const written = toggleWritePayloads(shape)[which];

  return [configured, extractPayloadValue(configured, shape), written]
    .map((ref) => ref.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolve an MQTT payload into a toggle position.
 *
 * Returns null when the payload maps to neither state, so the panel can show
 * "unknown" rather than guessing.
 */
export function parseToggleState(
  payload: string,
  shape: ToggleShape = {},
): boolean | null {
  const value = extractPayloadValue(payload, shape);
  if (value === "") return null;

  const lower = value.toLowerCase();
  const onRefs = stateReferences(shape, "on");
  const offRefs = stateReferences(shape, "off");

  if (onRefs.includes(lower)) return true;
  if (offRefs.includes(lower)) return false;

  // Fall back to the shared truthiness table (true/on/yes/online, numbers, ...)
  const parsed = parseGaugePayload(value);
  if (parsed.dataType === "boolean") return Boolean(parsed.parsedValue);
  if (parsed.dataType === "number") return Number(parsed.parsedValue) !== 0;

  return null;
}
