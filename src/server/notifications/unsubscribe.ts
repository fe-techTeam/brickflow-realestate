import { createHmac, timingSafeEqual } from "node:crypto";
import { isNotificationCategory, type NotificationCategory } from "@/lib/notifications";
import { absoluteUrl } from "./email/render";

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must be set (at least 32 characters) to sign unsubscribe links");
  return value;
}

function sign(userId: string, category: string): string {
  // Domain-separated so the MAC can never be confused with a session token signed by the same secret.
  return createHmac("sha256", secret()).update(`brickflow:unsubscribe:v1:${userId}:${category}`).digest("base64url");
}

/** One-click link that switches off email for a single category. It changes nothing on GET. */
export function unsubscribeUrl(appUrl: string, userId: string, category: NotificationCategory): string {
  const url = new URL(absoluteUrl(appUrl, "/api/notifications/unsubscribe"));
  url.searchParams.set("u", userId);
  url.searchParams.set("c", category);
  url.searchParams.set("t", sign(userId, category));
  return url.toString();
}

export function verifyUnsubscribeToken(userId: string, category: string, token: string): category is NotificationCategory {
  if (!userId || !isNotificationCategory(category) || !token) return false;
  const expected = Buffer.from(sign(userId, category));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
