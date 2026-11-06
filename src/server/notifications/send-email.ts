import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "../db";
import { enqueueJob } from "../jobs/queue";
import { appUrl, NOTIFICATION_JOBS } from "./constants";
import { assertSameOrigin, TRANSACTIONAL_TEMPLATES, type TransactionalTemplateData, type TransactionalTemplateName } from "./email/transactional";

const emailAddress = z.email().max(254);

export interface SendTemplatedEmailOptions {
  /** Enqueue inside an existing transaction (recommended), so the email exists only if it commits. */
  tx?: Tx;
  /** Links the delivery to a user in the delivery log. */
  userId?: string;
  /** A second call with the same key sends nothing. */
  idempotencyKey?: string;
}

/**
 * Queues an account email (for example "password-reset") for delivery by the worker. These emails
 * ignore notification preferences and carry no unsubscribe link. Every URL in the data must point
 * at APP_URL. Returns the delivery id, which is also the email's Message-ID local part.
 */
export async function sendTemplatedEmail<T extends TransactionalTemplateName>(
  to: string,
  template: T,
  data: TransactionalTemplateData<T>,
  options: SendTemplatedEmailOptions = {},
): Promise<{ deliveryId: string; created: boolean }> {
  const recipient = emailAddress.parse(to.trim().toLowerCase());
  const definition = TRANSACTIONAL_TEMPLATES[template];
  if (!definition) throw new Error(`Unknown email template "${template}"`);
  const values = definition.schema.parse(data) as Record<string, unknown>;
  const base = appUrl();
  for (const value of Object.values(values)) {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) assertSameOrigin(value, base);
  }

  const run = async (tx: Tx) => {
    const dedupeKey = options.idempotencyKey ? `email:${template}:${options.idempotencyKey}` : null;
    const created = await tx.notificationDelivery.createManyAndReturn({
      data: [
        {
          userId: options.userId ?? null,
          channel: "EMAIL",
          event: `account.${template}`,
          template,
          recipient,
          data: { workspace: null, recipientName: null, values } as unknown as Prisma.InputJsonObject,
          dedupeKey,
        },
      ],
      skipDuplicates: true,
      select: { id: true },
    });
    if (!created[0]) {
      const existing = await tx.notificationDelivery.findUniqueOrThrow({ where: { dedupeKey: dedupeKey! }, select: { id: true } });
      return { deliveryId: existing.id, created: false };
    }
    await enqueueJob(tx, { type: NOTIFICATION_JOBS.deliver, payload: { deliveryId: created[0].id }, idempotencyKey: `delivery:${created[0].id}` });
    return { deliveryId: created[0].id, created: true };
  };

  return options.tx ? run(options.tx) : db.$transaction(run);
}
