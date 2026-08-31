import {
  VALUE_TOKEN,
  migrateTemplate,
  readValue,
  templateFromValueKey,
} from "./payloadShape";
import type { PayloadDataType } from "./payloadShape";

export interface ParsedResult {
  parsedValue: string | number | boolean;
  dataType: PayloadDataType;
  raw: string;
}

export interface GaugeShape {
  /** The read shape, with `{value}` marking the part to pull out. */
  template?: string;
  /** Legacy dot path, still honoured for panels saved before shapes existed. */
  path?: string;
}

/**
 * Read a displayable value out of a payload.
 *
 * Thin wrapper over the shared extractor: the shape's chip marks the value, and
 * a blank shape reads the whole payload.
 */
export function parseGaugePayload(
  payload: string,
  shape: GaugeShape = {},
): ParsedResult {
  const { value, dataType, raw } = readValue(
    shape.template?.trim() || undefined,
    payload,
    shape.path?.trim() || undefined,
  );
  return { parsedValue: value, dataType, raw };
}

/**
 * The read shape a stored gauge should open with. A panel saved with only a dot
 * path is drawn as the shape it was really describing, so the one chip explains
 * both the old config and the new one.
 *
 * Nothing stored at all falls back to the bare chip rather than an empty box:
 * "read the whole payload" is what a fresh gauge does, and the chip says so in
 * the same terms every other shape is written in.
 */
export function gaugeReadTemplate(config: {
  readTemplate?: string;
  valueKey?: string;
}): string {
  const stored =
    config.readTemplate !== undefined
      ? migrateTemplate(config.readTemplate)
      : templateFromValueKey(config.valueKey);
  return stored.trim() || VALUE_TOKEN;
}
