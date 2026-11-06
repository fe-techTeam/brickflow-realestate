"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NOTIFICATION_CATEGORY_KEYS, NOTIFICATION_CHANNEL_KEYS } from "@/lib/notifications";
import { runAction, type ActionResult } from "../action-result";
import { recordAudit } from "../audit";
import { requireActor } from "../auth/session";
import { db } from "../db";
import { getInboxSummary, markNotificationsRead, saveNotificationSettings, type InboxItem, type NotificationSettings } from "../notifications/inbox";

export async function getNotificationSummaryAction(): Promise<ActionResult<{ unread: number; items: InboxItem[] }>> {
  return runAction(async () => {
    const actor = await requireActor();
    return getInboxSummary(actor.userId);
  });
}

const idsSchema = z.array(z.string().min(1).max(64)).max(500);

export async function markNotificationsReadAction(ids: string[] | "all"): Promise<ActionResult<{ updated: number }>> {
  return runAction(async () => {
    const actor = await requireActor();
    const updated = await markNotificationsRead(actor.userId, ids === "all" ? "all" : idsSchema.parse(ids));
    revalidatePath(`/${actor.workspace}/notifications`);
    return { updated };
  });
}

const channelFlags = z.object(Object.fromEntries(NOTIFICATION_CHANNEL_KEYS.map((c) => [c, z.boolean().optional()])) as Record<(typeof NOTIFICATION_CHANNEL_KEYS)[number], z.ZodOptional<z.ZodBoolean>>);

const settingsSchema = z.object({
  preferences: z.object(Object.fromEntries(NOTIFICATION_CATEGORY_KEYS.map((c) => [c, channelFlags.optional()])) as Record<(typeof NOTIFICATION_CATEGORY_KEYS)[number], z.ZodOptional<typeof channelFlags>>),
  whatsappNumber: z.string().trim().max(32).nullable().optional(),
  whatsappConsent: z.boolean().optional(),
});

export async function saveNotificationSettingsAction(input: z.input<typeof settingsSchema>): Promise<ActionResult<NotificationSettings>> {
  return runAction(async () => {
    const actor = await requireActor();
    const update = settingsSchema.parse(input);
    const saved = await db.$transaction(async (tx) => {
      const result = await saveNotificationSettings(tx, actor.userId, update);
      await recordAudit(tx, actor, {
        action: "notifications.preferences_updated",
        entityType: "NotificationPreference",
        entityId: actor.userId,
        summary: `Updated notification preferences${result.whatsappOptedIn ? " (WhatsApp consent given)" : ""}`,
        metadata: { preferences: result.preferences, whatsappOptedIn: result.whatsappOptedIn },
      });
      return result;
    });
    revalidatePath(`/${actor.workspace}/notifications`);
    return saved;
  }, "Notification preferences saved.");
}
