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

function matchCronPart(val: number, part: string): boolean {
  if (part === "*") return true;
  const [range, stepStr] = part.split("/");
  const step = stepStr ? parseInt(stepStr, 10) : 1;
  if (range === "*") {
    return val % step === 0;
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

function matchCronField(val: number, fieldExpr: string): boolean {
  return fieldExpr.split(",").some((part) => matchCronPart(val, part));
}

export function matchesCron(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts;

  const min = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay();

  if (!matchCronField(min, minExpr)) return false;
  if (!matchCronField(hour, hourExpr)) return false;
  if (!matchCronField(month, monthExpr)) return false;

  const domIsStar = domExpr === "*";
  const dowIsStar = dowExpr === "*";
  if (!domIsStar && !dowIsStar) {
    if (!matchCronField(dom, domExpr) && !matchCronField(dow, dowExpr)) {
      return false;
    }
  } else {
    if (!matchCronField(dom, domExpr)) return false;
    if (!matchCronField(dow, dowExpr)) return false;
  }

  return true;
}

export function getPreviousCronRun(expr: string, nextRun: Date): Date | null {
  const target = new Date(nextRun.getTime());
  target.setSeconds(0, 0);

  // Look backwards up to 366 days (527040 minutes)
  const maxMinutes = 527040;
  let curr = new Date(target.getTime() - 60000);

  for (let i = 0; i < maxMinutes; i++) {
    if (matchesCron(expr, curr)) {
      return curr;
    }
    curr = new Date(curr.getTime() - 60000);
  }
  return null;
}
