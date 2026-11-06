/** Job types owned by the notifications module. */
export const NOTIFICATION_JOBS = {
  deliver: "notifications.deliver",
  offerExpiring: "notifications.offer-expiring",
  settlementReminders: "notifications.settlement-reminders",
} as const;

export const JOBS_MAINTENANCE_JOB = "jobs.maintenance";

/** Public base URL used in email links. Required in production. */
export function appUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const value = env.APP_URL?.trim();
  if (value) {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("APP_URL must be an http(s) URL");
    return url.origin;
  }
  if (env.NODE_ENV === "production") throw new Error("APP_URL is required in production");
  return "http://localhost:3000";
}
