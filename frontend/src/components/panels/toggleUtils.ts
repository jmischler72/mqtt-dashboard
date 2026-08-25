export interface ToggleStateResult {
  isOn: boolean | null;
  raw: string;
  extractedValue: unknown;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      part in (current as Record<string, unknown>)
    ) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export function parseTogglePayload(
  payload: string,
  valueKey?: string,
  onPayload?: string,
  offPayload?: string,
): ToggleStateResult {
  const raw = payload;
  let target: unknown = payload;

  try {
    const json = JSON.parse(payload);
    if (typeof json === "object" && json !== null && !Array.isArray(json)) {
      if (valueKey?.trim()) {
        const extracted = getNestedValue(
          json as Record<string, unknown>,
          valueKey.trim(),
        );
        if (extracted !== undefined) {
          target = extracted;
        }
      } else {
        // Auto-detect common state/power keys if no specific key is configured
        const commonKeys = [
          "state",
          "power",
          "status",
          "val",
          "value",
          "switch",
          "relay",
          "output",
          "enabled",
          "active",
        ];
        const found = commonKeys.find((k) => k in json);
        if (found) {
          target = (json as Record<string, unknown>)[found];
        } else {
          target = json;
        }
      }
    } else {
      target = json;
    }
  } catch {
    target = payload;
  }

  const effectiveOn = (onPayload ?? "ON").trim().toLowerCase();
  const effectiveOff = (offPayload ?? "OFF").trim().toLowerCase();

  // Boolean check
  if (typeof target === "boolean") {
    return { isOn: target, raw, extractedValue: target };
  }

  // Number check
  if (typeof target === "number") {
    const targetStr = String(target).toLowerCase();
    if (targetStr === effectiveOn) {
      return { isOn: true, raw, extractedValue: target };
    }
    if (targetStr === effectiveOff) {
      return { isOn: false, raw, extractedValue: target };
    }
    if (target === 1) return { isOn: true, raw, extractedValue: target };
    if (target === 0) return { isOn: false, raw, extractedValue: target };
  }

  // String check
  if (typeof target === "string") {
    const trimmed = target.trim();
    const lower = trimmed.toLowerCase();

    if (effectiveOn && lower === effectiveOn) {
      return { isOn: true, raw, extractedValue: trimmed };
    }
    if (effectiveOff && lower === effectiveOff) {
      return { isOn: false, raw, extractedValue: trimmed };
    }

    // Standard truthy representations
    if (
      ["true", "on", "1", "yes", "open", "enabled", "active", "high"].includes(
        lower,
      )
    ) {
      return { isOn: true, raw, extractedValue: trimmed };
    }

    // Standard falsy representations
    if (
      [
        "false",
        "off",
        "0",
        "no",
        "closed",
        "disabled",
        "inactive",
        "low",
      ].includes(lower)
    ) {
      return { isOn: false, raw, extractedValue: trimmed };
    }

    return { isOn: null, raw, extractedValue: trimmed };
  }

  return { isOn: null, raw, extractedValue: target };
}
