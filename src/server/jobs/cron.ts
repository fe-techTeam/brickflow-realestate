/**
 * Minimal five-field cron expressions (minute hour day-of-month month day-of-week) evaluated at a
 * fixed UTC offset. India has no daylight saving, so a fixed +05:30 offset is exact for IST.
 *
 * Supported per field: `*`, numbers, ranges `a-b`, steps `*\/n` and `a-b/n`, and comma lists.
 * Day of week accepts 0-7 (0 and 7 are Sunday). As in standard cron, when both day-of-month and
 * day-of-week are restricted, a day matches if either does.
 */

export const IST_OFFSET_MINUTES = 330;

const MINUTE_MS = 60_000;

interface FieldSpec {
  min: number;
  max: number;
}

const FIELDS: FieldSpec[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
];

export interface CronExpression {
  source: string;
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  dayRestricted: boolean;
  weekdayRestricted: boolean;
}

export class CronParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronParseError";
  }
}

function parseField(raw: string, spec: FieldSpec, label: string): Set<number> {
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!match) throw new CronParseError(`Invalid ${label} field "${raw}"`);
    const [, range, stepRaw] = match;
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new CronParseError(`Invalid step in ${label} field "${raw}"`);
    let start = spec.min;
    let end = spec.max;
    if (range !== "*") {
      const [a, b] = range!.split("-").map(Number);
      start = a!;
      end = b ?? (stepRaw === undefined ? a! : spec.max);
    }
    if (start < spec.min || end > spec.max || start > end) throw new CronParseError(`${label} value out of range in "${raw}"`);
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return values;
}

export function parseCron(expression: string): CronExpression {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new CronParseError(`Expected five cron fields, got "${expression}"`);
  const labels = ["minute", "hour", "day-of-month", "month", "day-of-week"];
  const [minutes, hours, days, months, weekdaysRaw] = parts.map((p, i) => parseField(p, FIELDS[i]!, labels[i]!));
  const weekdays = new Set([...weekdaysRaw!].map((d) => (d === 7 ? 0 : d)));
  return {
    source: expression,
    minutes: minutes!,
    hours: hours!,
    days: days!,
    months: months!,
    weekdays,
    dayRestricted: parts[2] !== "*",
    weekdayRestricted: parts[4] !== "*",
  };
}

function dayMatches(cron: CronExpression, local: Date): boolean {
  const dom = cron.days.has(local.getUTCDate());
  const dow = cron.weekdays.has(local.getUTCDay());
  if (cron.dayRestricted && cron.weekdayRestricted) return dom || dow;
  if (cron.dayRestricted) return dom;
  if (cron.weekdayRestricted) return dow;
  return true;
}

/** The first instant strictly after `after` that matches the expression at the given UTC offset. */
export function nextCronTime(expression: string | CronExpression, after: Date, utcOffsetMinutes = IST_OFFSET_MINUTES): Date {
  const cron = typeof expression === "string" ? parseCron(expression) : expression;
  const offsetMs = utcOffsetMinutes * MINUTE_MS;
  // Work on a "local" clock expressed through the UTC getters.
  const local = new Date(Math.floor((after.getTime() + offsetMs) / MINUTE_MS) * MINUTE_MS + MINUTE_MS);
  const limit = local.getTime() + 5 * 366 * 24 * 60 * MINUTE_MS;

  while (local.getTime() <= limit) {
    if (!cron.months.has(local.getUTCMonth() + 1)) {
      local.setUTCMonth(local.getUTCMonth() + 1, 1);
      local.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(cron, local)) {
      local.setUTCDate(local.getUTCDate() + 1);
      local.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!cron.hours.has(local.getUTCHours())) {
      local.setUTCHours(local.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!cron.minutes.has(local.getUTCMinutes())) {
      local.setUTCMinutes(local.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return new Date(local.getTime() - offsetMs);
  }
  throw new CronParseError(`Cron expression "${cron.source}" never matches`);
}
