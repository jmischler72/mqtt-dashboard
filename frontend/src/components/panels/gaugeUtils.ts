export interface ParsedResult {
  parsedValue: string | number | boolean;
  dataType: "number" | "boolean" | "string";
  raw: string;
}

export function parseGaugePayload(payload: string, valueKey?: string): ParsedResult {
  const raw = payload;
  let target: unknown = payload;

  try {
    const json = JSON.parse(payload);
    if (typeof json === "object" && json !== null && !Array.isArray(json)) {
      if (valueKey && valueKey in json) {
        target = (json as Record<string, unknown>)[valueKey];
      }
    } else {
      target = json;
    }
  } catch {
    // Ignore JSON parse error, treat as raw payload
    target = payload;
  }

  if (typeof target === "number") {
    return { parsedValue: target, dataType: "number", raw };
  }

  if (typeof target === "boolean") {
    return { parsedValue: target, dataType: "boolean", raw };
  }

  if (typeof target === "string") {
    const trimmed = target.trim();

    const lower = trimmed.toLowerCase();
    if (["true", "false", "on", "off", "yes", "no", "online", "offline"].includes(lower)) {
      const isTrue = ["true", "on", "yes", "online"].includes(lower);
      return { parsedValue: isTrue, dataType: "boolean", raw };
    }

    const num = Number(trimmed);
    if (!isNaN(num) && trimmed !== "") {
      return { parsedValue: num, dataType: "number", raw };
    }

    return { parsedValue: trimmed, dataType: "string", raw };
  }

  return { parsedValue: String(target), dataType: "string", raw };
}
