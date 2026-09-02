import cronstrue from "cronstrue";

// Visual Cron Builder maps friendly options to cron expressions
export const PRESETS: { label: string; value: string }[] = [
  { label: "Every minute", value: "* * * * *" },
  { label: "Every 5 minutes", value: "*/5 * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every 30 minutes", value: "*/30 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Daily at noon", value: "0 12 * * *" },
  { label: "Weekly (Sunday midnight)", value: "0 0 * * 0" },
  { label: "Custom", value: "custom" },
];

// Validate a standard 5-field cron expression (min hour day month weekday).
// Returns an error message, or null when valid.
export const CRON_FIELDS: { name: string; min: number; max: number }[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "weekday", min: 0, max: 6 },
];

export function validateCron(expr: string): string | null {
  const trimmed = expr.trim();
  if (!trimmed) return "Expression is required";
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return `Expected 5 fields, got ${fields.length}`;
  }
  for (let i = 0; i < 5; i++) {
    const { name, min, max } = CRON_FIELDS[i];
    for (const part of fields[i].split(",")) {
      // Strip step (e.g. */5 or 1-10/2)
      const [range, stepStr] = part.split("/");
      if (stepStr !== undefined && !/^\d+$/.test(stepStr)) {
        return `Invalid step in ${name} field`;
      }
      if (range === "*") continue;
      for (const n of range.split("-")) {
        if (!/^\d+$/.test(n)) return `Invalid ${name} value "${n}"`;
        const v = Number(n);
        if (v < min || v > max) {
          return `${name} must be ${min}-${max} (got ${v})`;
        }
      }
    }
  }
  return null;
}

// Human-readable description of a cron expression, e.g.
// "0 0 * * 0" -> "At 12:00 AM, only on Sunday". Returns null if undescribable.
export function describeCron(expr: string): string | null {
  try {
    return cronstrue.toString(expr, { throwExceptionOnParseError: true });
  } catch {
    return null;
  }
}

function matchCronPart(val: number, part: string, fieldMin: number): boolean {
  if (part === "*") return true;
  const [range, stepStr] = part.split("/");
  const step = stepStr ? parseInt(stepStr, 10) : 1;
  if (range === "*") {
    // Cron counts steps from the field's minimum, which is 1 for day of month
    // and month, not 0.
    return (val - fieldMin) % step === 0;
  }
  if (range.includes("-")) {
    const [minStr, maxStr] = range.split("-");
    const min = parseInt(minStr, 10);
    const max = parseInt(maxStr, 10);
    if (val < min || val > max) return false;
    return (val - min) % step === 0;
  }
  return parseInt(range, 10) === val;
}

function matchCronField(
  val: number,
  fieldExpr: string,
  fieldMin: number,
): boolean {
  return fieldExpr
    .split(",")
    .some((part) => matchCronPart(val, part, fieldMin));
}

const [MINUTE, HOUR, DOM, MONTH, DOW] = CRON_FIELDS;

// Minute and hour fields only.
function matchesCronTime(parts: string[], date: Date): boolean {
  return (
    matchCronField(date.getMinutes(), parts[0], MINUTE.min) &&
    matchCronField(date.getHours(), parts[1], HOUR.min)
  );
}

// Day-of-month, month and weekday fields only.
function matchesCronDate(parts: string[], date: Date): boolean {
  const [, , domExpr, monthExpr, dowExpr] = parts;
  if (!matchCronField(date.getMonth() + 1, monthExpr, MONTH.min)) return false;

  const dom = date.getDate();
  const dow = date.getDay();
  const domIsStar = domExpr === "*";
  const dowIsStar = dowExpr === "*";
  if (!domIsStar && !dowIsStar) {
    return (
      matchCronField(dom, domExpr, DOM.min) ||
      matchCronField(dow, dowExpr, DOW.min)
    );
  }
  return (
    matchCronField(dom, domExpr, DOM.min) &&
    matchCronField(dow, dowExpr, DOW.min)
  );
}

export function matchesCron(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return matchesCronTime(parts, date) && matchesCronDate(parts, date);
}

export function getPreviousCronRun(expr: string, nextRun: Date): Date | null {
  // Expressions this parser cannot handle (@daily, "MON", 7 for Sunday, ...)
  // would otherwise never match and run the whole search on the UI thread.
  if (validateCron(expr) !== null) return null;
  const parts = expr.trim().split(/\s+/);

  const curr = new Date(nextRun.getTime());
  curr.setSeconds(0, 0);
  curr.setTime(curr.getTime() - 60000);

  // Look backwards up to 366 days.
  const limit = new Date(curr.getTime());
  limit.setDate(limit.getDate() - 366);

  while (curr.getTime() >= limit.getTime()) {
    // Skip whole days that the date fields rule out, so an expression that
    // never matches (e.g. "0 0 30 2 *") costs 366 steps instead of 527040.
    if (!matchesCronDate(parts, curr)) {
      curr.setDate(curr.getDate() - 1);
      curr.setHours(23, 59, 0, 0);
      continue;
    }
    if (matchesCronTime(parts, curr)) {
      return new Date(curr.getTime());
    }
    curr.setTime(curr.getTime() - 60000);
  }
  return null;
}
