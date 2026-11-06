import "server-only";
import type { NotificationChannel } from "@/generated/prisma/client";
import {
  DEFAULT_CHANNEL_ENABLED,
  NOTIFICATION_CATEGORY_KEYS,
  NOTIFICATION_CHANNEL_KEYS,
  normaliseWhatsappNumber,
  type NotificationCategory,
} from "@/lib/notifications";
import { db, type Tx } from "../db";
import { invalid } from "../errors";

export interface InboxItem {
  id: string;
  event: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

function toItem(n: { id: string; event: string; category: string; title: string; body: string; link: string | null; readAt: Date | null; createdAt: Date }): InboxItem {
  return { id: n.id, event: n.event, category: n.category, title: n.title, body: n.body, link: n.link, read: n.readAt !== null, createdAt: n.createdAt.toISOString() };
}

/** Unread count plus the latest few notifications, for the top-bar bell. */
export async function getInboxSummary(userId: string, take = 8): Promise<{ unread: number; items: InboxItem[] }> {
  const [unread, latest] = await Promise.all([
    db.notification.count({ where: { userId, readAt: null } }),
    db.notification.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take }),
  ]);
  return { unread, items: latest.map(toItem) };
}

export async function listNotifications(userId: string, options: { unreadOnly?: boolean; take?: number } = {}) {
  const take = Math.min(Math.max(options.take ?? 30, 1), 200);
  const where = { userId, ...(options.unreadOnly ? { readAt: null } : {}) };
  const [rows, total, unread] = await Promise.all([
    db.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: take + 1 }),
    db.notification.count({ where }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items: rows.slice(0, take).map(toItem), hasMore: rows.length > take, total, unread };
}

/** Marks the given notifications (or all) as read. Only the owner's rows can match. */
export async function markNotificationsRead(userId: string, ids: string[] | "all", now: Date = new Date()): Promise<number> {
  if (ids !== "all" && ids.length === 0) return 0;
  const result = await db.notification.updateMany({
    where: { userId, readAt: null, ...(ids === "all" ? {} : { id: { in: ids.slice(0, 500) } }) },
    data: { readAt: now },
  });
  return result.count;
}

export type PreferenceMatrix = Record<NotificationCategory, Record<NotificationChannel, boolean>>;

export interface NotificationSettings {
  preferences: PreferenceMatrix;
  whatsappNumber: string | null;
  whatsappOptedIn: boolean;
}

export async function getNotificationSettings(userId: string): Promise<NotificationSettings> {
  const [rows, profile] = await Promise.all([db.notificationPreference.findMany({ where: { userId } }), db.notificationProfile.findUnique({ where: { userId } })]);
  const preferences = Object.fromEntries(
    NOTIFICATION_CATEGORY_KEYS.map((category) => [
      category,
      Object.fromEntries(
        NOTIFICATION_CHANNEL_KEYS.map((channel) => [channel, rows.find((r) => r.category === category && r.channel === channel)?.enabled ?? DEFAULT_CHANNEL_ENABLED[channel]]),
      ),
    ]),
  ) as PreferenceMatrix;
  return { preferences, whatsappNumber: profile?.whatsappNumber ?? null, whatsappOptedIn: Boolean(profile?.whatsappOptedInAt) };
}

export interface SettingsUpdate {
  preferences: Partial<Record<NotificationCategory, Partial<Record<NotificationChannel, boolean>>>>;
  whatsappNumber?: string | null;
  whatsappConsent?: boolean;
}

/**
 * Saves preferences and the WhatsApp number. WhatsApp can only be switched on for a category once
 * the user has given a number and explicit consent; withdrawing consent switches it off everywhere.
 */
export async function saveNotificationSettings(tx: Tx, userId: string, update: SettingsUpdate, now: Date = new Date()): Promise<NotificationSettings> {
  let number: string | null = null;
  if (update.whatsappNumber && update.whatsappNumber.trim()) {
    number = normaliseWhatsappNumber(update.whatsappNumber);
    if (!number) throw invalid("Enter the WhatsApp number with its country code, e.g. +91 98765 43210.", { whatsappNumber: ["Enter a valid number with country code"] });
  }
  const consent = Boolean(update.whatsappConsent && number);
  const wantsWhatsapp = NOTIFICATION_CATEGORY_KEYS.some((c) => update.preferences[c]?.WHATSAPP === true);
  if (wantsWhatsapp && !consent) {
    throw invalid("Add your WhatsApp number and confirm consent before switching on WhatsApp messages.", { whatsappConsent: ["Consent is required for WhatsApp messages"] });
  }

  const existing = await tx.notificationProfile.findUnique({ where: { userId } });
  const keepConsentTime = consent && existing?.whatsappOptedInAt && existing.whatsappNumber === number;
  await tx.notificationProfile.upsert({
    where: { userId },
    create: { userId, whatsappNumber: number, whatsappOptedInAt: consent ? now : null },
    update: { whatsappNumber: number, whatsappOptedInAt: consent ? (keepConsentTime ? existing!.whatsappOptedInAt : now) : null },
  });

  for (const category of NOTIFICATION_CATEGORY_KEYS) {
    for (const channel of NOTIFICATION_CHANNEL_KEYS) {
      let enabled = update.preferences[category]?.[channel];
      if (channel === "WHATSAPP" && !consent) enabled = false;
      if (enabled === undefined) continue;
      await tx.notificationPreference.upsert({
        where: { userId_category_channel: { userId, category, channel } },
        create: { userId, category, channel, enabled },
        update: { enabled },
      });
    }
  }

  const rows = await tx.notificationPreference.findMany({ where: { userId } });
  const preferences = Object.fromEntries(
    NOTIFICATION_CATEGORY_KEYS.map((category) => [
      category,
      Object.fromEntries(
        NOTIFICATION_CHANNEL_KEYS.map((channel) => [channel, rows.find((r) => r.category === category && r.channel === channel)?.enabled ?? DEFAULT_CHANNEL_ENABLED[channel]]),
      ),
    ]),
  ) as PreferenceMatrix;
  return { preferences, whatsappNumber: number, whatsappOptedIn: consent };
}

/** Switches off email for one category (signed unsubscribe link). Idempotent. */
export async function unsubscribeEmail(userId: string, category: NotificationCategory): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return;
  await db.notificationPreference.upsert({
    where: { userId_category_channel: { userId, category, channel: "EMAIL" } },
    create: { userId, category, channel: "EMAIL", enabled: false },
    update: { enabled: false },
  });
}
