import "server-only";
import type { NotificationDelivery, Prisma } from "@/generated/prisma/client";
import { DEFAULT_CHANNEL_ENABLED, NOTIFICATION_CATEGORIES, NOTIFICATION_EVENTS, type NotificationEvent } from "@/lib/notifications";
import { db } from "../db";
import { PermanentJobError, type JobContext } from "../jobs/registry";
import { appUrl } from "./constants";
import { getEmailProvider, type EmailMessage } from "./email/providers";
import { absoluteUrl, renderEmail } from "./email/render";
import { isTransactionalTemplate, TRANSACTIONAL_TEMPLATES } from "./email/transactional";
import type { DeliveryData } from "./notify";
import { renderNotification, whatsappTemplateName, type NotificationEventDataMap } from "./templates";
import { unsubscribeUrl } from "./unsubscribe";
import { getWhatsappLanguage, getWhatsappProvider } from "./whatsapp/providers";

const SENDABLE = ["QUEUED", "FAILED"] as const;

function isEvent(value: string): value is NotificationEvent {
  return Object.hasOwn(NOTIFICATION_EVENTS, value);
}

function deliveryData(delivery: NotificationDelivery): DeliveryData {
  const data = (delivery.data ?? {}) as Partial<DeliveryData>;
  return { workspace: data.workspace ?? null, recipientName: data.recipientName ?? null, values: (data.values ?? {}) as Prisma.InputJsonObject };
}

/** Why a delivery should not be sent any more, or null when it still should. */
async function skipReason(delivery: NotificationDelivery): Promise<string | null> {
  if (!delivery.userId || isTransactionalTemplate(delivery.template)) return null;
  const user = await db.user.findUnique({ where: { id: delivery.userId }, select: { status: true } });
  if (!user || user.status !== "ACTIVE") return "Recipient account is inactive";
  if (!isEvent(delivery.event)) return null;
  const category = NOTIFICATION_EVENTS[delivery.event].category;
  const preference = await db.notificationPreference.findUnique({
    where: { userId_category_channel: { userId: delivery.userId, category, channel: delivery.channel } },
  });
  if (!(preference?.enabled ?? DEFAULT_CHANNEL_ENABLED[delivery.channel])) return "Recipient switched this channel off";
  if (delivery.channel === "WHATSAPP") {
    const profile = await db.notificationProfile.findUnique({ where: { userId: delivery.userId } });
    if (!profile?.whatsappOptedInAt || profile.whatsappNumber !== delivery.recipient) return "Recipient withdrew WhatsApp consent or changed number";
  }
  return null;
}

function messageId(deliveryId: string, base: string): string {
  return `${deliveryId}@${new URL(base).hostname}`;
}

export function buildEmail(delivery: NotificationDelivery, base: string = appUrl()): EmailMessage {
  const data = deliveryData(delivery);
  if (isTransactionalTemplate(delivery.template)) {
    const template = TRANSACTIONAL_TEMPLATES[delivery.template];
    const parsed = template.schema.safeParse(data.values);
    // A redacted one-time link cannot be resent; the user has to request a new one.
    if (!parsed.success) throw new PermanentJobError(`Template data for "${delivery.template}" is invalid or was redacted`);
    const values = parsed.data;
    const { content, ctaUrl } = template.render(values);
    const rendered = renderEmail(content, { appUrl: base, recipientName: values.name ?? data.recipientName, footer: { reason: template.reason }, ctaUrl });
    return { to: delivery.recipient, ...rendered, messageId: messageId(delivery.id, base) };
  }
  if (!isEvent(delivery.event)) throw new PermanentJobError(`Unknown notification event "${delivery.event}"`);
  const event = delivery.event;
  const category = NOTIFICATION_EVENTS[event].category;
  const notification = renderNotification(event, data.values as unknown as NotificationEventDataMap[typeof event], { workspace: data.workspace });
  const unsubscribe = delivery.userId ? unsubscribeUrl(base, delivery.userId, category) : undefined;
  const rendered = renderEmail(notification.email, {
    appUrl: base,
    recipientName: data.recipientName,
    footer: {
      reason: `You are receiving this email because ${NOTIFICATION_CATEGORIES[category].label.toLowerCase()} notifications are switched on for your BrickFlow account.`,
      manageUrl: data.workspace ? absoluteUrl(base, `/${data.workspace}/notifications#preferences`) : undefined,
      unsubscribeUrl: unsubscribe,
    },
  });
  return {
    to: delivery.recipient,
    ...rendered,
    messageId: messageId(delivery.id, base),
    headers: unsubscribe ? { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
  };
}

/** Values of sensitive fields (one-time links) are removed once a send is final. */
function redacted(delivery: NotificationDelivery): Prisma.InputJsonObject | undefined {
  if (!isTransactionalTemplate(delivery.template)) return undefined;
  const sensitive = TRANSACTIONAL_TEMPLATES[delivery.template].sensitive as string[];
  const data = deliveryData(delivery);
  const values = { ...(data.values as Record<string, unknown>) };
  for (const key of sensitive) if (key in values) values[key] = "[redacted]";
  return { ...data, values } as unknown as Prisma.InputJsonObject;
}

function isPermanent(error: unknown): boolean {
  return error instanceof PermanentJobError || (typeof error === "object" && error !== null && (error as { permanent?: boolean }).permanent === true);
}

/**
 * Job handler: sends one queued delivery. Idempotent: deliveries already sent (or skipped) are left
 * alone, and the email Message-ID is derived from the delivery id so a resend after a crash between
 * "sent" and "recorded" is recognisable as the same message.
 */
export async function processDelivery(deliveryId: string, context: Pick<JobContext, "isFinalAttempt">): Promise<void> {
  const delivery = await db.notificationDelivery.findUnique({ where: { id: deliveryId } });
  if (!delivery || !(SENDABLE as readonly string[]).includes(delivery.status)) return;

  const reason = await skipReason(delivery);
  if (reason) {
    await db.notificationDelivery.updateMany({ where: { id: delivery.id, status: { in: [...SENDABLE] } }, data: { status: "SKIPPED", error: reason, data: redacted(delivery) } });
    return;
  }

  let provider: string;
  try {
    let providerMessageId: string;
    if (delivery.channel === "EMAIL") {
      const email = getEmailProvider();
      provider = email.name;
      ({ providerMessageId } = await email.send(buildEmail(delivery)));
    } else if (delivery.channel === "WHATSAPP") {
      const whatsapp = getWhatsappProvider();
      provider = whatsapp.name;
      if (!whatsapp.enabled || !isEvent(delivery.event)) {
        await db.notificationDelivery.updateMany({
          where: { id: delivery.id, status: { in: [...SENDABLE] } },
          data: { status: "SKIPPED", provider, error: "WhatsApp delivery is not configured" },
        });
        return;
      }
      const data = deliveryData(delivery);
      const rendered = renderNotification(delivery.event, data.values as unknown as NotificationEventDataMap[NotificationEvent], { workspace: data.workspace });
      ({ providerMessageId } = await whatsapp.send({
        to: delivery.recipient,
        template: whatsappTemplateName(delivery.event),
        language: getWhatsappLanguage(),
        bodyParams: rendered.whatsappParams,
      }));
    } else {
      throw new PermanentJobError(`Channel ${delivery.channel} is not delivered by the queue`);
    }
    await db.notificationDelivery.updateMany({
      where: { id: delivery.id, status: { in: [...SENDABLE] } },
      data: { status: "SENT", provider, providerMessageId, sentAt: new Date(), error: null, attempts: { increment: 1 }, data: redacted(delivery) },
    });
  } catch (error) {
    const permanent = isPermanent(error);
    const final = permanent || context.isFinalAttempt;
    await db.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: final ? "FAILED" : delivery.status,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
        attempts: { increment: 1 },
        ...(final ? { data: redacted(delivery) } : {}),
      },
    });
    if (permanent) throw new PermanentJobError(error instanceof Error ? error.message : String(error), { cause: error });
    throw error;
  }
}
