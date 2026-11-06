/**
 * IST business calendar.
 *
 * Due dates, holidays and tenors are calendar dates with no time component, written as ISO
 * "YYYY-MM-DD" strings. In the database they are stored as UTC midnight of that date, so the UTC
 * components of a stored value are the calendar date. "Today" is always the date in Asia/Kolkata;
 * India has no daylight saving, so IST is a fixed UTC+05:30 offset and needs no time-zone database.
 */

export type CalendarDate = string;

export type HolidayRule = "NONE" | "NEXT_BUSINESS_DAY";

export const IST_TIME_ZONE = "Asia/Kolkata";
export const DAYS_IN_YEAR_ACT365 = 365;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const IST_OFFSET_MS = 330 * MINUTE_MS;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Longest run of consecutive non-business days tolerated before the holiday list is treated as corrupt. */
const MAX_BUSINESS_DAY_SEARCH = 31;

function epochDay(date: CalendarDate): number {
  const match = ISO_DATE.exec(date);
  if (!match) throw new RangeError(`Invalid calendar date: ${date}`);
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const roundTrip = new Date(ms).toISOString().slice(0, 10);
  if (roundTrip !== date) throw new RangeError(`Invalid calendar date: ${date}`);
  return ms / DAY_MS;
}

function fromEpochDay(day: number): CalendarDate {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function isCalendarDate(value: string): boolean {
  try {
    epochDay(value);
    return true;
  } catch {
    return false;
  }
}

/** Validates and returns an ISO calendar date; throws RangeError for malformed or impossible dates (e.g. 2026-02-30). */
export function parseCalendarDate(value: string): CalendarDate {
  epochDay(value);
  return value;
}

/** The calendar date in India at the given instant. */
export function istToday(now: Date = new Date()): CalendarDate {
  if (Number.isNaN(now.getTime())) throw new RangeError("Invalid instant");
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Calendar date of a stored date-only value (UTC midnight convention). */
export function toCalendarDate(stored: Date): CalendarDate {
  if (Number.isNaN(stored.getTime())) throw new RangeError("Invalid date");
  return stored.toISOString().slice(0, 10);
}

/** Storage value (UTC midnight) for a calendar date. */
export function toStorageDate(date: CalendarDate): Date {
  return new Date(epochDay(date) * DAY_MS);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  if (!Number.isInteger(days)) throw new RangeError("Days must be an integer");
  return fromEpochDay(epochDay(date) + days);
}

/** Actual number of days from `from` to `to` (ACT day count); negative when `to` is earlier. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return epochDay(to) - epochDay(from);
}

/** ACT/365 year fraction. For display and reporting only; money is always computed in integers. */
export function yearFractionAct365(from: CalendarDate, to: CalendarDate): number {
  return daysBetween(from, to) / DAYS_IN_YEAR_ACT365;
}

export function compareCalendarDates(a: CalendarDate, b: CalendarDate): -1 | 0 | 1 {
  const diff = epochDay(a) - epochDay(b);
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}

/** The instant IST midnight begins on the given date. */
export function startOfIstDay(date: CalendarDate): Date {
  return new Date(epochDay(date) * DAY_MS - IST_OFFSET_MS);
}

/** The last millisecond of the given date in IST. */
export function endOfIstDay(date: CalendarDate): Date {
  return new Date(startOfIstDay(addDays(date, 1)).getTime() - 1);
}

/** True when the date is strictly after today in IST. */
export function isFutureInIst(date: CalendarDate, now: Date = new Date()): boolean {
  return compareCalendarDates(date, istToday(now)) > 0;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: CalendarDate): number {
  // 1970-01-01 was a Thursday.
  return (((epochDay(date) + 4) % 7) + 7) % 7;
}

/**
 * Weekly bank closures in India: every Sunday, and the second and fourth Saturday of the month
 * (Negotiable Instruments Act holidays observed by banks since 2015).
 */
export function isWeeklyOff(date: CalendarDate): boolean {
  const dow = dayOfWeek(date);
  if (dow === 0) return true;
  if (dow !== 6) return false;
  const dayOfMonth = Number(date.slice(8, 10));
  return (dayOfMonth >= 8 && dayOfMonth <= 14) || (dayOfMonth >= 22 && dayOfMonth <= 28);
}

export function isBusinessDay(date: CalendarDate, holidays: ReadonlySet<CalendarDate> = new Set()): boolean {
  return !isWeeklyOff(date) && !holidays.has(date);
}

function step(date: CalendarDate, direction: 1 | -1, holidays: ReadonlySet<CalendarDate>): CalendarDate {
  let candidate = date;
  for (let i = 0; i < MAX_BUSINESS_DAY_SEARCH; i += 1) {
    candidate = addDays(candidate, direction);
    if (isBusinessDay(candidate, holidays)) return candidate;
  }
  throw new RangeError(`No business day within ${MAX_BUSINESS_DAY_SEARCH} days of ${date}; check the holiday calendar`);
}

/** The first business day strictly after the date. */
export function nextBusinessDay(date: CalendarDate, holidays: ReadonlySet<CalendarDate> = new Set()): CalendarDate {
  return step(date, 1, holidays);
}

/** The last business day strictly before the date. */
export function previousBusinessDay(date: CalendarDate, holidays: ReadonlySet<CalendarDate> = new Set()): CalendarDate {
  return step(date, -1, holidays);
}

/** Applies a programme's holiday rule to a due date: NONE keeps it, NEXT_BUSINESS_DAY rolls a non-business day forward. */
export function adjustDueDate(date: CalendarDate, rule: HolidayRule, holidays: ReadonlySet<CalendarDate> = new Set()): CalendarDate {
  parseCalendarDate(date);
  if (rule === "NONE" || isBusinessDay(date, holidays)) return date;
  return nextBusinessDay(date, holidays);
}

const displayFormatter = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/** "06 Nov 2026". */
export function formatCalendarDate(date: CalendarDate): string {
  return displayFormatter.format(toStorageDate(date));
}
