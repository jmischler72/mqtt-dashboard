import { readValue, deriveReadPath } from "./payloadShape";

export type LogicOperator =
  "any" | "eq" | "ne" | "gt" | "lt" | "gte" | "lte" | "contains" | "exists";

export type LogicMode = "every" | "on_change" | "count" | "sustained";

export interface Condition {
  broker_id?: string;
  topic?: string;
  json_path?: string;
  read_template?: string;
  operator: LogicOperator;
  value?: string;
  join?: "and" | "or";
}

export interface RuleStatus {
  panel_id: string;
  enabled: boolean;
  last_fired?: string;
  fire_count: number;
  current_state: string;
}

export const OPERATORS: {
  value: LogicOperator;
  label: string;
  symbol: string;
}[] = [
  { value: "eq", label: "Equals (==)", symbol: "==" },
  { value: "ne", label: "Not equals (!=)", symbol: "!=" },
  { value: "gt", label: "Greater than (>)", symbol: ">" },
  { value: "gte", label: "Greater or equal (>=)", symbol: ">=" },
  { value: "lt", label: "Less than (<)", symbol: "<" },
  { value: "lte", label: "Less or equal (<=)", symbol: "<=" },
  { value: "contains", label: "Contains string", symbol: "contains" },
  { value: "exists", label: "Field exists", symbol: "exists" },
  { value: "any", label: "Any value", symbol: "any" },
];

/** Matches an MQTT concrete topic against a topic filter pattern (+ and #). */
export function mqttTopicMatches(filter: string, topic: string): boolean {
  if (!filter.startsWith("$") && topic.startsWith("$")) return false;
  const fp = filter.split("/");
  const tp = topic.split("/");
  for (let i = 0; i < fp.length; i++) {
    if (fp[i] === "#") return true;
    if (fp[i] === "+") {
      if (i >= tp.length) return false;
      continue;
    }
    if (i >= tp.length || fp[i] !== tp[i]) return false;
  }
  return fp.length === tp.length;
}

/** Formats a single condition into a concise summary line. */
export function formatConditionSummary(
  c: Condition,
  includeTopic = false,
  includeJoin = false,
): string {
  let target = "value";
  if (c.json_path?.trim()) {
    target = c.json_path.trim();
  } else if (c.read_template?.trim()) {
    target = deriveReadPath(c.read_template) || "value";
  }

  if (includeTopic && c.topic?.trim()) {
    target = `${c.topic.trim()} · ${target}`;
  }

  let opStr: string;
  if (c.operator === "any") {
    opStr = `${target} is any`;
  } else if (c.operator === "exists") {
    opStr = `${target} exists`;
  } else if (c.operator === "contains") {
    opStr = `${target} ~ "${c.value ?? ""}"`;
  } else {
    const opSymbol =
      OPERATORS.find((op) => op.value === c.operator)?.symbol ?? c.operator;
    opStr = `${target} ${opSymbol} ${c.value ?? ""}`;
  }

  if (includeJoin && c.join) {
    return `${c.join.toUpperCase()} ${opStr}`;
  }
  return opStr;
}

/** Returns relative time string (e.g. "just now", "2m ago", "1h ago"). */
export function formatTimeAgo(isoString?: string): string {
  if (!isoString) return "never";
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  if (diffMs < 0 || isNaN(diffMs)) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

/** Extracts a tracked value from raw payload using optional JSON path or read template. */
export function extractTrackedValue(
  payload?: string | null,
  jsonPath?: string,
  readTemplate?: string,
): { displayValue: string; rawValue: unknown } {
  if (payload === undefined || payload === null || payload.trim() === "") {
    return { displayValue: "—", rawValue: null };
  }
  const clean = payload.trim();
  const tmpl = readTemplate?.trim();
  const path = jsonPath?.trim();

  if (tmpl || path) {
    try {
      const extracted = readValue(tmpl, clean, path);
      return {
        displayValue: String(extracted.value),
        rawValue: extracted.value,
      };
    } catch {
      return { displayValue: "—", rawValue: null };
    }
  }

  // No path or template specified, try to format nicely
  try {
    const parsed = JSON.parse(clean) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return { displayValue: clean, rawValue: parsed };
    }
    return { displayValue: String(parsed), rawValue: parsed };
  } catch {
    return { displayValue: clean, rawValue: clean };
  }
}

/** Evaluates a single condition against a raw value. */
export function evaluateClientCondition(
  rawValue: unknown,
  operator: LogicOperator,
  targetValue?: string,
): boolean {
  if (operator === "any") return true;
  if (operator === "exists") return rawValue !== null && rawValue !== undefined;

  if (rawValue === null || rawValue === undefined) return false;

  const targetStr = (targetValue ?? "").trim();
  const rawStr = String(rawValue).trim();

  // Try numeric comparison first if target is a valid number
  const rawNum = Number(rawValue);
  const targetNum = Number(targetStr);
  const isNumeric =
    !isNaN(rawNum) && !isNaN(targetNum) && targetStr !== "" && rawStr !== "";

  switch (operator) {
    case "eq":
      if (isNumeric) return rawNum === targetNum;
      return rawStr.toLowerCase() === targetStr.toLowerCase();
    case "ne":
      if (isNumeric) return rawNum !== targetNum;
      return rawStr.toLowerCase() !== targetStr.toLowerCase();
    case "gt":
      return isNumeric && rawNum > targetNum;
    case "gte":
      return isNumeric && rawNum >= targetNum;
    case "lt":
      return isNumeric && rawNum < targetNum;
    case "lte":
      return isNumeric && rawNum <= targetNum;
    case "contains":
      return rawStr.toLowerCase().includes(targetStr.toLowerCase());
    default:
      return false;
  }
}

/** Evaluates all conditions for a rule against a raw payload, respecting sequential Join or Match fallback. */
export function evaluateAllConditions(
  payload: string | null | undefined,
  conditions: Condition[],
  match: "all" | "any" = "all",
  guardLookup?: (brokerId: string, topic: string) => string | undefined,
  ruleBrokerId?: string,
  ruleTopic?: string,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  if (payload === undefined || payload === null) return false;

  const evalCond = (c: Condition): boolean => {
    const isTrigger =
      (!c.topic || c.topic === ruleTopic) &&
      (!c.broker_id || c.broker_id === ruleBrokerId);

    let rawMsg: string | undefined = payload;
    if (!isTrigger) {
      if (!guardLookup) return false;
      const bId = c.broker_id || ruleBrokerId || "";
      const top = c.topic || ruleTopic || "";
      rawMsg = guardLookup(bId, top);
      if (rawMsg === undefined) return false;
    }

    const { rawValue } = extractTrackedValue(
      rawMsg,
      c.json_path,
      c.read_template,
    );
    return evaluateClientCondition(rawValue, c.operator, c.value);
  };

  const hasExplicitJoin = conditions.some(
    (c, idx) => idx > 0 && c.join !== undefined,
  );

  if (!hasExplicitJoin && match) {
    if (match === "any") {
      return conditions.some(evalCond);
    }
    return conditions.every(evalCond);
  }

  let result = evalCond(conditions[0]);
  for (let i = 1; i < conditions.length; i++) {
    const c = conditions[i];
    const cResult = evalCond(c);
    if (c.join === "or") {
      result = result || cResult;
    } else {
      result = result && cResult;
    }
  }
  return result;
}
