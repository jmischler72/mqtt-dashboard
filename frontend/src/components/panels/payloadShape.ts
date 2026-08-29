/**
 * One description of "how is the value packed into this payload?", used in both
 * directions: extracting a value out of an incoming message, and building the
 * payload to publish. Panels used to answer this three different ways (a flat
 * `valueKey` on the gauge, hand-typed JSON on the toggle, a placeholder
 * template on the slider); everything now goes through here.
 */

export type PayloadDataType = "number" | "boolean" | "string";

export interface ExtractedValue {
  value: string | number | boolean;
  dataType: PayloadDataType;
  raw: string;
}

/**
 * Keys devices commonly carry the interesting value in. Used to rank path
 * suggestions so the likely one is offered first.
 */
const COMMON_KEYS = [
  "val",
  "value",
  "temp",
  "temperature",
  "reading",
  "status",
  "state",
  "data",
];

/** Strings that read as booleans rather than as text. */
const TRUE_WORDS = ["true", "on", "yes", "online"];
const BOOL_WORDS = [...TRUE_WORDS, "false", "off", "no", "offline"];

/**
 * Walk a dot path (`data.value`, `items.0.temp`) through parsed JSON. Numeric
 * segments index into arrays. Returns `found: false` rather than undefined so
 * callers can tell "resolved to null" from "no such path".
 */
export function resolvePath(
  root: unknown,
  path: string,
): { found: boolean; value: unknown } {
  const segments = path
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) return { found: false, value: undefined };

  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return { found: false, value: undefined };
    }

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
      continue;
    }

    if (typeof current === "object") {
      const obj = current as Record<string, unknown>;
      if (!(segment in obj)) return { found: false, value: undefined };
      current = obj[segment];
      continue;
    }

    // Hit a scalar with path left to walk
    return { found: false, value: undefined };
  }

  return { found: true, value: current };
}

/** Coerce an already-unwrapped value into the panel-facing typed form. */
function coerceValue(target: unknown, raw: string): ExtractedValue {
  if (typeof target === "number") {
    return { value: target, dataType: "number", raw };
  }

  if (typeof target === "boolean") {
    return { value: target, dataType: "boolean", raw };
  }

  if (typeof target === "string") {
    const trimmed = target.trim();
    const lower = trimmed.toLowerCase();

    if (BOOL_WORDS.includes(lower)) {
      return { value: TRUE_WORDS.includes(lower), dataType: "boolean", raw };
    }

    const num = Number(trimmed);
    if (!isNaN(num) && trimmed !== "") {
      return { value: num, dataType: "number", raw };
    }

    return { value: trimmed, dataType: "string", raw };
  }

  return { value: String(target), dataType: "string", raw };
}

/**
 * `JSON.parse`, forgiving of the JSON-ish shapes devices actually publish:
 * unquoted object keys, single-quoted strings, a trailing comma. Firmware
 * written by hand emits these constantly, and a panel that refuses to read
 * `{temp:22}` while happily publishing it is just wrong.
 *
 * Strict JSON is tried first, so a well-formed payload is never touched by the
 * relaxations — they only run on text that has already failed to parse. They
 * are textual and therefore approximate (an apostrophe inside a double-quoted
 * string can defeat the single-quote rule); anything they cannot make sense of
 * comes back as undefined and is read as a whole raw payload, which is what
 * would have happened anyway.
 */
export function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Fall through to the relaxed attempt
  }

  const relaxed = text
    // {temp:22} → {"temp":22}
    .replace(/([{[,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
    // {'temp':'on'} → {"temp":"on"}
    .replace(/'([^'\\]*)'/g, '"$1"')
    // {"temp":22,} → {"temp":22}
    .replace(/,(\s*[}\]])/g, "$1");

  try {
    return JSON.parse(relaxed);
  } catch {
    return undefined;
  }
}

/**
 * Pull the value at `path` out of a payload.
 *
 * Without a path, or when the path does not resolve, the payload is read as a
 * whole — which for a JSON object means the raw text, matching what panels did
 * before paths existed.
 */
export function extractValue(payload: string, path?: string): ExtractedValue {
  const raw = payload;
  let target: unknown;

  const json = parseLooseJson(payload);

  if (json === undefined) {
    // Not JSON in any reading — treat as the raw payload
    target = payload;
  } else {
    const isArray = Array.isArray(json);
    const isObject = typeof json === "object" && json !== null && !isArray;
    const key = path?.trim();

    if (key && (isObject || isArray)) {
      const resolved = resolvePath(json, key);
      if (resolved.found) return coerceValue(resolved.value, raw);
    }

    // No path, or it did not resolve. An object reads as its raw text (there is
    // no single sensible value to show); anything else reads as the parsed
    // document — matching what panels did before paths existed.
    target = isObject ? payload : json;
  }

  return coerceValue(target, raw);
}

/**
 * The payload a panel publishes is written literally, exactly as it goes on the
 * wire, with a single token marking the one spot the panel's own value drops
 * into at publish time. Quoting the token is what decides the type: `"◆"` sends
 * text, a bare `◆` sends a number.
 */
export const VALUE_TOKEN = "\u25c6";

/**
 * What the token is called in the interface. The payload stores the character;
 * the editor draws it as a chip reading this, and every message about it uses
 * the same word so they describe the same thing the user can see.
 */
export const TOKEN_LABEL = "value";

/** Sentinel used to locate the token inside otherwise-valid JSON. */
const TOKEN_SENTINEL = "__mqtt_dashboard_token__";

export function hasToken(template: string): boolean {
  return template.includes(VALUE_TOKEN);
}

/**
 * True when the payload is nothing but the token, i.e. the panel publishes its
 * value on its own with nothing around it. A legitimate, common setup — a bare
 * slider or button — rather than a payload that happens to lack JSON.
 */
export function isBareToken(template: string): boolean {
  return template.trim() === VALUE_TOKEN;
}

/** True when the token is written inside quotes, i.e. published as text. */
export function isTokenQuoted(template: string): boolean {
  const at = template.indexOf(VALUE_TOKEN);
  if (at === -1) return false;
  return template[at - 1] === '"' && template[at + VALUE_TOKEN.length] === '"';
}

/** Publish-time substitution: the template with the value dropped in. */
export function renderPayload(
  template: string,
  value: string | number | boolean,
): string {
  return template.split(VALUE_TOKEN).join(String(value));
}

/**
 * The JSON path the token sits at, which is also where the value can be read
 * back from — the mark is both halves of the shape. Null when the template is
 * not JSON (the payload is the value) or has no token.
 */
export function deriveReadPath(template: string): string | null {
  if (!hasToken(template)) return null;

  // Make the template parseable by standing a string in for the token; a bare
  // token needs quotes added, a quoted one already has them.
  const parseable = isTokenQuoted(template)
    ? template.split(VALUE_TOKEN).join(TOKEN_SENTINEL)
    : template.split(VALUE_TOKEN).join(`"${TOKEN_SENTINEL}"`);

  const json = parseLooseJson(parseable);

  if (typeof json !== "object" || json === null) return null;

  const find = (node: unknown, prefix: string): string | null => {
    if (node === TOKEN_SENTINEL) return prefix;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const hit = find(node[i], prefix ? `${prefix}.${i}` : String(i));
        if (hit !== null) return hit;
      }
      return null;
    }

    if (typeof node === "object" && node !== null) {
      for (const [key, child] of Object.entries(node)) {
        const hit = find(child, prefix ? `${prefix}.${key}` : key);
        if (hit !== null) return hit;
      }
    }

    return null;
  };

  return find(json, "");
}

/**
 * Read the value straight out of a message, using the template as a stencil:
 * everything written before the token has to match, everything after it has to
 * match, and whatever sits in between is the value.
 *
 * This knows nothing about JSON — it reads `<set>21</set>`, `temp=21`, `21;ON`
 * and `{temp:21}` alike, because the user already described the shape when they
 * wrote the payload. Returns null when the message is not that shape, which is
 * the common case of a device reporting more than the panel publishes; those
 * fall back to the path-based read.
 *
 * A bare token anchors on nothing, so it deliberately does not match here — a
 * whole-message read is what the path branch already does.
 */
export function matchTemplate(
  template: string,
  message: string,
): string | null {
  const at = template.indexOf(VALUE_TOKEN);
  if (at === -1) return null;

  const prefix = template.slice(0, at).trimStart();
  const suffix = template.slice(at + VALUE_TOKEN.length).trimEnd();
  if (!prefix && !suffix) return null;

  const text = message.trim();
  if (text.length < prefix.length + suffix.length) return null;
  if (!text.startsWith(prefix) || !text.endsWith(suffix)) return null;

  const candidate = text.slice(prefix.length, text.length - suffix.length);

  // A suffix as generic as `}` matches a message carrying more than the
  // template describes, swallowing the extra fields into the value. What a
  // device reports is a scalar, so anything with structure in it means the
  // stencil caught the wrong span and the path-based read should handle it.
  if (/[{}[\],:"\n]/.test(candidate)) return null;

  return candidate;
}

/**
 * The panel's value, read out of an incoming message.
 *
 * The stencil is tried first: it is exact, needs no parser, and works for any
 * format the device speaks. Only when the message does not fit — extra fields,
 * a different key order, a shape the panel does not publish — does this fall
 * back to locating the value by path inside the parsed document.
 */
export function readValue(
  template: string | undefined,
  message: string,
  fallbackPath?: string,
): ExtractedValue {
  if (template) {
    const stencilled = matchTemplate(template, message);
    if (stencilled !== null) return coerceValue(stencilled, message);
  }

  const path = (template ? deriveReadPath(template) : null) ?? fallbackPath;
  return extractValue(message, path);
}

/**
 * Where a panel reads its value from. A panel whose device reports on a
 * different shape configures a read template of its own; otherwise incoming
 * messages are assumed to look like what the panel publishes, so the write
 * template's token marks the value both ways.
 *
 * Panels saved before templates existed have no token to mirror, so their
 * stored key still applies.
 */
export function effectiveReadTemplate(config: {
  payloadTemplate?: string;
  readTemplate?: string;
  separateRead?: boolean;
}): string | undefined {
  return config.separateRead && config.readTemplate
    ? config.readTemplate
    : config.payloadTemplate;
}

export function effectiveReadPath(config: {
  payloadTemplate?: string;
  readTemplate?: string;
  separateRead?: boolean;
  valueKey?: string;
}): string | undefined {
  const source =
    config.separateRead && config.readTemplate
      ? config.readTemplate
      : config.payloadTemplate;

  const derived = source ? deriveReadPath(source) : null;

  return derived ?? config.valueKey;
}

export interface PayloadCheck {
  /** The payload as configured, token included. */
  template: string;
  /**
   * False for panels with no runtime value (button, cron), where a token would
   * publish an empty hole instead of standing in for something.
   */
  acceptsToken?: boolean;
  /** "read" checks an incoming shape, where the token marks what to pull out. */
  mode?: "write" | "read";
}

/**
 * The payload problems that leave a panel unable to do its job, phrased for the
 * header badge and the modal's Save button. Returns null when the payload is
 * usable; advisory notes (plain text, an empty fixed payload) are not issues —
 * an empty publish is how a retained message gets cleared.
 */
export function payloadIssue({
  template,
  acceptsToken = true,
  mode = "write",
}: PayloadCheck): string | null {
  const token = hasToken(template);

  if (mode === "read") {
    return token
      ? null
      : `Read shape does not mark where the ${TOKEN_LABEL} sits`;
  }

  if (acceptsToken && !token) {
    return template.trim()
      ? `Payload has no ${TOKEN_LABEL} in it — every publish would send the same bytes`
      : "No payload configured";
  }

  if (!acceptsToken && token) {
    return `This panel has no ${TOKEN_LABEL} to send — remove it from the payload`;
  }

  // The bytes themselves are never judged: a payload that is not JSON, or is
  // JSON-shaped without parsing, is a device's business and not a broken panel.
  return null;
}

export interface TemplateLiteral {
  text: string;
  start: number;
  end: number;
}

/**
 * Value literals in the template, each of which the user can move the token
 * onto. Matches JSON values after a colon; a template that is a bare value with
 * no token counts as one literal so it can be marked too.
 */
export function findLiterals(template: string): TemplateLiteral[] {
  const out: TemplateLiteral[] = [];
  const re = /:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false)/g;

  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    const start = match.index + match[0].length - match[1].length;
    out.push({ text: match[1], start, end: start + match[1].length });
  }

  const trimmed = template.trim();
  if (out.length === 0 && trimmed !== "" && !hasToken(template)) {
    const start = template.indexOf(trimmed);
    out.push({ text: trimmed, start, end: start + trimmed.length });
  }

  return out.filter((lit) => !lit.text.includes(VALUE_TOKEN));
}

/**
 * Move the token onto `literal`. Only one token may exist, so wherever it was
 * gets a constant handed back — the value it held before it was marked.
 */
export function markLiteral(
  template: string,
  literal: TemplateLiteral,
  restore: string,
): { template: string; previous: string } {
  const quoted = literal.text.startsWith('"');
  const previous = quoted ? literal.text.slice(1, -1) : literal.text;

  let next =
    template.slice(0, literal.start) +
    (quoted ? `"${VALUE_TOKEN}"` : VALUE_TOKEN) +
    template.slice(literal.end);

  // Index of the token we just placed, so the older ones can be filled back in
  const keepAt = quoted ? literal.start + 1 : literal.start;

  const positions: number[] = [];
  let at = next.indexOf(VALUE_TOKEN);
  while (at !== -1) {
    positions.push(at);
    at = next.indexOf(VALUE_TOKEN, at + 1);
  }

  for (let i = positions.length - 1; i >= 0; i--) {
    if (positions[i] === keepAt) continue;
    next =
      next.slice(0, positions[i]) +
      restore +
      next.slice(positions[i] + VALUE_TOKEN.length);
  }

  return { template: next, previous };
}

/**
 * Drop the token, putting the constant it replaced back where it was.
 *
 * A payload that is *only* the token empties instead: there is no surrounding
 * message for a constant to sit in, and leaving one behind would silently turn
 * "publish my value" into "publish this one literal forever".
 */
export function clearToken(template: string, restore: string): string {
  if (isBareToken(template)) return "";
  return template.split(VALUE_TOKEN).join(restore);
}

/**
 * Put the token at a place the user picked, replacing whatever they had
 * selected. A selection of zero width is a caret, so this both inserts and
 * replaces depending on what they did.
 *
 * Only one token can exist, so a token already sitting elsewhere hands its spot
 * back to the constant it displaced — the same trade `clearToken` makes.
 * Returns where the caret belongs afterwards, just past the token.
 */
export function placeToken(
  template: string,
  start: number,
  end: number,
  restore = "",
): { template: string; caret: number } {
  const untoken = (part: string) => part.split(VALUE_TOKEN).join(restore);

  const before = untoken(template.slice(0, start));
  const after = untoken(template.slice(end));

  return {
    template: before + VALUE_TOKEN + after,
    caret: before.length + VALUE_TOKEN.length,
  };
}

/**
 * Leaf paths present in a JSON payload, likely candidates first, so the config
 * modals can offer them instead of making the user guess the shape.
 */
export function suggestPaths(payload: string, maxDepth = 3): string[] {
  const json = parseLooseJson(payload);

  if (typeof json !== "object" || json === null) return [];

  const paths: string[] = [];

  const walk = (node: unknown, prefix: string, depth: number) => {
    if (paths.length >= 24 || depth > maxDepth) return;

    if (Array.isArray(node)) {
      // Sampling the first element is enough to show the shape
      if (node.length > 0) walk(node[0], `${prefix}.0`, depth + 1);
      return;
    }

    if (typeof node === "object" && node !== null) {
      for (const [key, child] of Object.entries(node)) {
        const next = prefix ? `${prefix}.${key}` : key;
        if (typeof child === "object" && child !== null) {
          walk(child, next, depth + 1);
        } else {
          paths.push(next);
        }
      }
      return;
    }

    if (prefix) paths.push(prefix);
  };

  walk(json, "", 0);

  // Common names first, then shallower paths, then alphabetical for stability
  return paths.sort((a, b) => {
    const rank = (p: string) => {
      const leaf = p.split(".").pop() ?? p;
      const idx = COMMON_KEYS.indexOf(leaf.toLowerCase());
      return idx === -1 ? COMMON_KEYS.length : idx;
    };
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    const byDepth = a.split(".").length - b.split(".").length;
    if (byDepth !== 0) return byDepth;
    return a.localeCompare(b);
  });
}
