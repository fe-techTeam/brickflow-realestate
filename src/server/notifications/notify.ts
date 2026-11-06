import "server-only";
import type { NotificationChannel, Prisma, RoleKey } from "@/generated/prisma/client";
import { DEFAULT_CHANNEL_ENABLED, NOTIFICATION_EVENTS, type NotificationEvent } from "@/lib/notifications";
import { workspaceForOrgType, type WorkspaceKey } from "@/lib/workspaces";
import type { Tx } from "../db";
import { enqueueJob, toJsonPayload } from "../jobs/queue";
import { NOTIFICATION_JOBS } from "./constants";
import { renderNotification, type NotificationEventDataMap } from "./templates";

const HOUR_MS = 60 * 60 * 1000;

/** Everyone in an organisation (optionally only some roles), or one user. Inactive users and organisations are skipped. */
export type RecipientSpec = { organisationId: string; roles?: RoleKey[] } | { userId: string };

export interface NotifyInput<E extends NotificationEvent> {
  event: E;
  recipients: RecipientSpec[];
  data: NotificationEventDataMap[E];
  /** Makes the call idempotent: a second notify with the same key reaches nobody twice. */
  dedupeKey?: string;
  /** Typically the acting user, who does not need to be told about their own action. */
  excludeUserIds?: string[];
}

export interface NotifyResult {
  recipients: number;
  notifications: number;
  deliveries: number;
}

export interface DeliveryData {
  workspace: WorkspaceKey | null;
  recipientName: string | null;
  values: Prisma.InputJsonObject;
}

interface ResolvedRecipient {
  userId: string;
  organisationId: string;
  email: string;
  name: string;
  workspace: WorkspaceKey;
}

async function resolveRecipients(tx: Tx, specs: RecipientSpec[], exclude: string[]): Promise<ResolvedRecipient[]> {
  if (specs.length === 0) return [];
  const memberships = await tx.organisationUser.findMany({
    where: {
      OR: specs.map((s) =>
        "userId" in s ? { userId: s.userId } : { organisationId: s.organisationId, ...(s.roles?.length ? { role: { key: { in: s.roles } } } : {}) },
      ),
      user: { status: "ACTIVE" },
      organisation: { status: "ACTIVE" },
    },
    select: { userId: true, organisationId: true, user: { select: { email: true, name: true } }, organisation: { select: { type: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const seen = new Set(exclude);
  const out: ResolvedRecipient[] = [];
  for (const m of memberships) {
    if (seen.has(m.userId)) continue;
    seen.add(m.userId);
    out.push({ userId: m.userId, organisationId: m.organisationId, email: m.user.email, name: m.user.name, workspace: workspaceForOrgType(m.organisation.type).key });
  }
  return out;
}

/**
 * Writes in-app notifications and queues email/WhatsApp deliveries for a workflow event, inside the
 * caller's transaction: nothing is sent unless the business change commits, and every send goes
 * through the job queue with retries. Channel choice follows each recipient's preferences.
 */
export async function notify<E extends NotificationEvent>(tx: Tx, input: NotifyInput<E>): Promise<NotifyResult> {
  const { category } = NOTIFICATION_EVENTS[input.event];
  const recipients = await resolveRecipients(tx, input.recipients, input.excludeUserIds ?? []);
  if (recipients.length === 0) {
    await scheduleFollowUps(tx, input);
    return { recipients: 0, notifications: 0, deliveries: 0 };
  }

  const userIds = recipients.map((r) => r.userId);
  const preferences = await tx.notificationPreference.findMany({ where: { userId: { in: userIds }, category } });
  const profiles = await tx.notificationProfile.findMany({ where: { userId: { in: userIds } } });
  const values = toJsonPayload(input.data);
  const key = (userId: string, channel: NotificationChannel) => (input.dedupeKey ? `${input.dedupeKey}:${userId}:${channel}` : null);

  const notifications: Prisma.NotificationCreateManyInput[] = [];
  const deliveries: Prisma.NotificationDeliveryCreateManyInput[] = [];
  for (const r of recipients) {
    const enabled = (channel: NotificationChannel) =>
      preferences.find((p) => p.userId === r.userId && p.channel === channel)?.enabled ?? DEFAULT_CHANNEL_ENABLED[channel];
    const deliveryData: DeliveryData = { workspace: r.workspace, recipientName: r.name, values };

    if (enabled("IN_APP")) {
      const rendered = renderNotification(input.event, input.data, { workspace: r.workspace });
      notifications.push({
        userId: r.userId,
        organisationId: r.organisationId,
        event: input.event,
        category,
        title: rendered.title.slice(0, 200),
        body: rendered.body.slice(0, 1000),
        link: rendered.path,
        dedupeKey: key(r.userId, "IN_APP"),
      });
    }
    if (enabled("EMAIL")) {
      deliveries.push({
        userId: r.userId,
        channel: "EMAIL",
        event: input.event,
        template: input.event,
        recipient: r.email,
        data: deliveryData as unknown as Prisma.InputJsonObject,
        dedupeKey: key(r.userId, "EMAIL"),
      });
    }
    const profile = profiles.find((p) => p.userId === r.userId);
    if (enabled("WHATSAPP") && profile?.whatsappNumber && profile.whatsappOptedInAt) {
      deliveries.push({
        userId: r.userId,
        channel: "WHATSAPP",
        event: input.event,
        template: input.event,
        recipient: profile.whatsappNumber,
        data: deliveryData as unknown as Prisma.InputJsonObject,
        dedupeKey: key(r.userId, "WHATSAPP"),
      });
    }
  }

  const created = notifications.length ? await tx.notification.createMany({ data: notifications, skipDuplicates: true }) : { count: 0 };
  const queued = deliveries.length
    ? await tx.notificationDelivery.createManyAndReturn({ data: deliveries, skipDuplicates: true, select: { id: true } })
    : [];
  for (const delivery of queued) {
    await enqueueJob(tx, { type: NOTIFICATION_JOBS.deliver, payload: { deliveryId: delivery.id }, idempotencyKey: `delivery:${delivery.id}` });
  }
  await scheduleFollowUps(tx, input);
  return { recipients: recipients.length, notifications: created.count, deliveries: queued.length };
}

/** Events that start a timer: an offer's expiry reminder is queued for 24 hours before it lapses. */
async function scheduleFollowUps<E extends NotificationEvent>(tx: Tx, input: NotifyInput<E>): Promise<void> {
  if (input.event !== "offer.generated") return;
  const data = input.data as NotificationEventDataMap["offer.generated"];
  const validUntil = new Date(data.validUntil).getTime();
  // A one-day offer would be "expiring" the moment it is created; its creation notice already says when it lapses.
  if (!Number.isFinite(validUntil) || validUntil - Date.now() <= 25 * HOUR_MS) return;
  await enqueueJob(tx, {
    type: NOTIFICATION_JOBS.offerExpiring,
    payload: { offerId: data.offerId },
    runAt: new Date(validUntil - 24 * HOUR_MS),
    idempotencyKey: `offer-expiring:${data.offerId}`,
  });
}
