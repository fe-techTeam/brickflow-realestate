const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Whole calendar days from `now` until `date` (negative when past), matching the settlement status rules. */
export function calendarDaysUntil(date: Date, now: Date = new Date()): number {
  return Math.round((utcDay(date) - utcDay(now)) / DAY_MS);
}

/** "just now", "3 hours ago", "yesterday", "12 days ago". */
export function formatAgeing(date: Date | null | undefined, now: Date = new Date()): string {
  if (!date) return "—";
  const elapsed = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(elapsed / DAY_MS);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** Ageing in whole days, used to flag invoices waiting too long. */
export function ageInDays(date: Date | null | undefined, now: Date = new Date()): number {
  if (!date) return 0;
  return Math.floor(Math.max(0, now.getTime() - date.getTime()) / DAY_MS);
}

/** "Due in 12 days", "Due today", "Overdue by 3 days". */
export function formatDueIn(dueDate: Date, now: Date = new Date()): string {
  const days = calendarDaysUntil(dueDate, now);
  if (days === 0) return "Due today";
  if (days > 0) return `Due in ${days} ${days === 1 ? "day" : "days"}`;
  return `Overdue by ${-days} ${days === -1 ? "day" : "days"}`;
}

export function formatDays(value: number | null): string {
  if (value === null) return "—";
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${value === 1 ? "day" : "days"}`;
}
