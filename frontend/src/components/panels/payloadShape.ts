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
  // A key that contains a dot is one field, not a path: panels saved before
  // paths existed stored exactly that, so an exact hit on the whole string is
  // taken before it is split up.
  if (typeof root === "object" && root !== null && !Array.isArray(root)) {
    const flat = root as Record<string, unknown>;
    // Own keys only: `toString` is on every object, and a shape naming one of
    // those would report a fit on any message and hand back a function.
    if (Object.prototype.hasOwnProperty.call(flat, path)) {
      return { found: true, value: flat[path] };
    }
  }

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
      if (!Object.prototype.hasOwnProperty.call(obj, segment)) {
        return { found: false, value: undefined };
      }
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

  // An object or an array reached through a path is not a value a panel can
  // draw, but `String(...)` would render it as the useless `[object Object]`.
  // Its own JSON at least shows what the device actually sent.
  return { value: jsonish(target), dataType: "string", raw };
}

/** True for something a panel can show as-is: not an object, not an array. */
function isScalar(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

/** A value's own JSON, falling back to `String` for anything unserialisable. */
function jsonish(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
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
export const VALUE_TOKEN = "{value}";

/**
 * The token panels were saved with before it had a name the user could read.
 * Still recognised on load so a dashboard written by an older build keeps
 * working; `migrateTemplate` is what turns it into the current spelling.
 */
export const LEGACY_VALUE_TOKEN = "\u25c6";

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

/** A number, the commonest thing a device puts where the chip sits. */
const NUMBER = "-?\\d+(?:\\.\\d+)?";

/**
 * An unquoted run of value characters. It stops at anything that carries
 * structure — a brace, a bracket, a quote, a comma — because a value that
 * appears to contain those is not a value: it is the stencil having slid over
 * a nested object, and `{"data":{"temp":21.5}}` read through `{"data":<chip>}`
 * would otherwise come back as the truncated fragment `{"temp":21.5`. Colons
 * stay legal so a time like `12:30:00` still reads as one value.
 */
const BARE = '[^,{}\\[\\]"\\s]+';

/** Escape a literal so it can be spliced into a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read the value straight out of a message, using the template as a stencil:
 * the text written *before* the token is what identifies the field, and
 * whatever sits immediately after it is the value.
 *
 * Deliberately lenient about the tail. A device that publishes
 * `{"temp":21.4,"battery":{"pct":92}}` should still be read by the shape
 * `{"temp":{value}}` — the user described the field they care about, not the
 * whole document — so the trailing template text is tried first and then
 * dropped. This knows nothing about JSON, which is the point: `temp=21`,
 * `<set>21</set>` and `random: 21.4 (ok)` all work the same way.
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

  const head = template.slice(0, at).trimStart();
  const tail = template.slice(at + VALUE_TOKEN.length).trimEnd();
  if (!head && !tail) return null;

  const text = message.trim();
  const unquote = (found: string) =>
    found.startsWith('"') && found.endsWith('"') ? found.slice(1, -1) : found;

  // With text after the chip to anchor on, the last alternative may be lazy:
  // it stops as soon as the template's own tail lines up again, which is what
  // reads `21` out of `<set>21</set>`.
  if (tail) {
    const strict = text.match(
      new RegExp(
        escapeRegExp(head) +
          `("[^"]*"|${NUMBER}|${BARE}?)` +
          escapeRegExp(tail),
      ),
    );
    if (strict) return unquote(strict[1]);
  }

  // The tail did not line up — the device appended fields the shape does not
  // describe — so anchor on the head alone and take the value sitting there.
  // The bare run is greedy here: with no tail to stop at, the value is however
  // far it runs before the next structural character.
  //
  // A shape whose token comes first (`{value} °C`) has no head to anchor on, so
  // it is pinned to the start of the message instead. Free-floating, it would
  // seize the first string or number anywhere in the payload and report that
  // `{"error":"offline"}` fits a shape about degrees.
  const loose = text.match(
    new RegExp(
      (head ? "" : "^") + escapeRegExp(head) + `("[^"]*"|${NUMBER}|${BARE})`,
    ),
  );
  return loose ? unquote(loose[1]) : null;
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

export interface ShapeRead extends ExtractedValue {
  /**
   * Whether the shape actually located a value in this message. False means the
   * message does not fit — a different problem from having no message at all,
   * and the two must never be reported as one.
   */
  found: boolean;
}

/**
 * Read a message through a shape and say whether the shape fitted.
 *
 * `readValue` always answers with something, because a panel has to draw
 * something; this is the version a config modal needs, where "the shape does
 * not match" is the thing worth telling the user about. A blank shape means the
 * whole payload, and so does a bare chip — the same statement said out loud —
 * so both always fit.
 */
export function readShape(template: string, message: string): ShapeRead {
  const shape = template.trim();
  if (!shape || isBareToken(shape)) {
    return { ...coerceValue(message, message), found: true };
  }

  const stencilled = matchTemplate(shape, message);
  if (stencilled !== null) {
    return { ...coerceValue(stencilled, message), found: true };
  }

  const path = deriveReadPath(shape);
  if (path) {
    const json = parseLooseJson(message);
    const resolved =
      json === undefined
        ? { found: false, value: undefined }
        : resolvePath(json, path);
    // A path that lands on an object or an array has not found a value: the
    // chip marks one scalar, and reporting a whole subtree as a fit would tell
    // the user their shape works when the panel has nothing to draw.
    if (resolved.found && isScalar(resolved.value)) {
      return { ...coerceValue(resolved.value, message), found: true };
    }
  }

  return { ...coerceValue(message, message), found: false };
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
function storedReadTemplate(config: {
  payloadTemplate?: string;
  readTemplate?: string;
  separateRead?: boolean;
}): string | undefined {
  // An empty shape is an answer, not a gap: it means "the whole payload", which
  // is what a device echoing `ON` on its own state topic sends. Only a panel
  // that has never been given one falls back to the shape it publishes.
  return config.separateRead && config.readTemplate !== undefined
    ? config.readTemplate
    : config.payloadTemplate;
}

export function effectiveReadTemplate(config: {
  payloadTemplate?: string;
  readTemplate?: string;
  separateRead?: boolean;
}): string | undefined {
  return migrateTemplate(storedReadTemplate(config));
}

export function effectiveReadPath(config: {
  payloadTemplate?: string;
  readTemplate?: string;
  separateRead?: boolean;
  valueKey?: string;
}): string | undefined {
  const source = migrateTemplate(storedReadTemplate(config));

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
      : "The read shape has no value chip, so nothing can be pulled out of it.";
  }

  if (acceptsToken && !token) {
    return template.trim()
      ? `Add the ${TOKEN_LABEL} chip to the message, or every publish sends the same bytes.`
      : "No message configured — this panel has nothing to publish.";
  }

  // The bytes themselves are never judged: a payload that is not JSON, or is
  // JSON-shaped without parsing, is a device's business and not a broken panel.
  return null;
}

/**
 * Bring a stored payload onto the current token spelling. Templates saved with
 * the old diamond keep working; nothing else is touched.
 */
export function migrateTemplate(template: string): string;
export function migrateTemplate(template: undefined): undefined;
export function migrateTemplate(
  template: string | undefined,
): string | undefined;
export function migrateTemplate(
  template: string | undefined,
): string | undefined {
  if (template === undefined) return undefined;
  return template.split(LEGACY_VALUE_TOKEN).join(VALUE_TOKEN);
}

/**
 * The shape a panel that only ever stored a dot path was really describing:
 * `a.b` means the value sits at `{"a":{"b":<here>}}`. Numeric segments would be
 * array indices, which no object literal can express, so those fall back to a
 * blank shape — a blank shape reads the whole payload, which is the honest
 * answer when the old path cannot be drawn.
 */
export function templateFromValueKey(valueKey: string | undefined): string {
  const path = valueKey?.trim();
  if (!path) return "";

  const segments = path
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return "";
  if (segments.some((s) => /^\d+$/.test(s))) return "";

  return segments.reduceRight(
    (inner, key) => `{${JSON.stringify(key)}:${inner}}`,
    VALUE_TOKEN,
  );
}

export interface TemplateLiteral {
  text: string;
  start: number;
  end: number;
}

/**
 * The template with at most one token in it.
 *
 * The token is ordinary characters now, so a payload can be typed or pasted
 * that spells a second one. Two would publish the value twice, leave
 * `matchTemplate` reading the rest of the shape as a tail it can never line up,
 * and put `placeToken`'s offsets out by a token's width. The first mark is the
 * one the user made; later spellings are dropped.
 */
export function keepOneToken(template: string): string {
  const at = template.indexOf(VALUE_TOKEN);
  if (at === -1) return template;

  const upto = at + VALUE_TOKEN.length;
  return (
    template.slice(0, upto) + template.slice(upto).split(VALUE_TOKEN).join("")
  );
}

/** Punctuation that means the payload is a document, not a lone value. */
const STRUCTURED = /[{}[\]:,]/;

/**
 * Value literals in the template, each of which the user can move the token
 * onto with one tap. Numbers and quoted strings anywhere in the bytes count —
 * not only JSON values after a colon — because the box holds whatever the
 * device speaks, and `random: 21.4 (ok)` has a value worth marking too.
 *
 * Capped and de-duplicated: the chips are a shortcut, not an index.
 */
export function findLiterals(template: string): TemplateLiteral[] {
  const out: TemplateLiteral[] = [];
  const re = /"[^"]*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?/g;
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null && out.length < 4) {
    const text = match[0];
    // A string followed by a colon is a JSON key, not a value — offering it
    // would fill the row with `"temp"` and hide the 21.4 next to it. Keys are
    // not always quoted (`parseLooseJson` reads `{ch1:5}`), so what follows the
    // *word* the match sits in decides it: the `1` of `ch1` names the field.
    const rest = template.slice(match.index + text.length);
    if (/^[^\s"',{}[\]]*\s*:/.test(rest)) continue;
    if (seen.has(text) || text.includes(VALUE_TOKEN)) continue;
    seen.add(text);
    out.push({ text, start: match.index, end: match.index + text.length });
  }

  // A payload that is a single bare word — `ON`, `RESET` — has no literal the
  // pattern above can see, but it is exactly the thing a user wants to mark.
  // Only when the whole payload is that word, though: offering a structured
  // message as one literal would collapse the document the user is marking
  // down to a bare chip.
  const trimmed = template.trim();
  if (
    out.length === 0 &&
    trimmed !== "" &&
    !hasToken(template) &&
    !STRUCTURED.test(trimmed)
  ) {
    const start = template.indexOf(trimmed);
    out.push({ text: trimmed, start, end: start + trimmed.length });
  }

  return out;
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

/** The template as the interface says it, with the token under its label. */
export function describeTemplate(template: string): string {
  return migrateTemplate(template).split(VALUE_TOKEN).join(TOKEN_LABEL);
}

/**
 * Put the token at a place the user picked, replacing whatever they had
 * selected. A selection of zero width is a caret, so this both inserts and
 * replaces depending on what they did.
 *
 * Only one token can exist, so a token already sitting elsewhere hands its spot
 * back to the constant it displaced — the same trade `clearToken` makes. The
 * offsets come from the box, which shows the token spelled out, so they are
 * translated onto the text with the token taken back out before anything is
 * cut; without that, repeated taps of the button would walk the chip rightwards
 * by its own length each time.
 *
 * Returns where the caret belongs afterwards, just past the token, and the text
 * the token now covers so a later removal can put it back.
 */
export function placeToken(
  template: string,
  start: number,
  end: number,
  restore = "",
): { template: string; caret: number; covered: string } {
  const at = template.indexOf(VALUE_TOKEN);
  const stripped =
    at === -1 ? template : template.split(VALUE_TOKEN).join(restore);

  // An offset inside the token itself has no counterpart in the stripped text,
  // so it collapses onto where the token began.
  const translate = (offset: number) => {
    if (at === -1) return Math.min(offset, stripped.length);
    if (offset <= at) return offset;
    if (offset >= at + VALUE_TOKEN.length) {
      return Math.min(
        offset - VALUE_TOKEN.length + restore.length,
        stripped.length,
      );
    }
    return at;
  };

  const from = translate(start);
  const to = Math.max(from, translate(end));

  return {
    template: stripped.slice(0, from) + VALUE_TOKEN + stripped.slice(to),
    caret: from + VALUE_TOKEN.length,
    covered: stripped.slice(from, to),
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
