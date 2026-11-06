import "server-only";
import { z } from "zod";
import { db } from "../db";
import { registerJobHandler } from "../jobs/registry";
import { defineSchedule } from "../jobs/schedules";
import { NOTIFICATION_JOBS } from "./constants";
import { processDelivery } from "./delivery";
import { notify } from "./notify";
import { notifySettlement, offerData, type SettlementEvent } from "./workflow";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's calendar date in India, as yyyy-mm-dd. */
export function istDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

export interface ReminderPlan {
  event: SettlementEvent;
  dedupeKey: string;
  daysUntilDue?: number;
  daysOverdue?: number;
}

/**
 * Which reminder a settlement gets today. Each kind is sent once per settlement (overdue notices
 * repeat weekly). A window rather than an exact day means a missed daily run catches up next day.
 */
export function planSettlementReminder(settlementId: string, dueDate: Date, today: string): ReminderPlan | null {
  const due = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const days = Math.round((due - Date.parse(`${today}T00:00:00.000Z`)) / DAY_MS);
  if (days >= 1 && days <= 3) return { event: "settlement.due_soon", dedupeKey: `settlement-due-soon:${settlementId}`, daysUntilDue: days };
  if (days === 0) return { event: "settlement.due_today", dedupeKey: `settlement-due-today:${settlementId}` };
  if (days < 0) {
    const overdue = -days;
    const week = Math.floor((overdue - 1) / 7);
    return { event: "settlement.overdue", dedupeKey: `settlement-overdue:${settlementId}:w${week}`, daysOverdue: overdue };
  }
  return null;
}

export async function runSettlementReminders(now: Date = new Date()): Promise<{ checked: number; notified: number }> {
  const today = istDate(now);
  const horizon = new Date(Date.parse(`${today}T00:00:00.000Z`) + 3 * DAY_MS);
  const open = await db.settlement.findMany({
    where: { status: { not: "SETTLED" }, dueDate: { lte: horizon } },
    select: { id: true, requestId: true, dueDate: true },
    orderBy: { dueDate: "asc" },
  });
  let notified = 0;
  for (const settlement of open) {
    const plan = planSettlementReminder(settlement.id, settlement.dueDate, today);
    if (!plan) continue;
    const result = await db.$transaction((tx) =>
      notifySettlement(tx, settlement.requestId, plan.event, null, { dedupeKey: plan.dedupeKey, daysUntilDue: plan.daysUntilDue, daysOverdue: plan.daysOverdue }),
    );
    if (result.notifications + result.deliveries > 0) notified += 1;
  }
  return { checked: open.length, notified };
}

export async function runOfferExpiringReminder(offerId: string, now: Date = new Date()): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const exists = await tx.financingOffer.findUnique({ where: { id: offerId }, select: { id: true } });
    if (!exists) return false;
    const { offer, data } = await offerData(tx, offerId);
    if (offer.status !== "OFFERED" || offer.validUntil <= now) return false;
    const result = await notify(tx, {
      event: "offer.expiring",
      recipients: [{ organisationId: offer.invoice.cpId, roles: ["CP_ADMIN"] }],
      data,
      dedupeKey: `offer-expiring:${offer.id}`,
    });
    return result.recipients > 0;
  });
}

let registered = false;

export function registerNotificationJobs(): void {
  if (registered) return;
  registered = true;

  registerJobHandler(NOTIFICATION_JOBS.deliver, (payload, ctx) => processDelivery(payload.deliveryId, ctx), {
    schema: z.object({ deliveryId: z.string().min(1) }),
  });
  registerJobHandler(NOTIFICATION_JOBS.offerExpiring, async (payload, ctx) => {
    await runOfferExpiringReminder(payload.offerId, ctx.now());
  }, { schema: z.object({ offerId: z.string().min(1) }) });
  registerJobHandler(NOTIFICATION_JOBS.settlementReminders, async (_payload, ctx) => {
    await runSettlementReminders(ctx.now());
  });

  defineSchedule({
    name: "settlement-reminders",
    cron: process.env.SETTLEMENT_REMINDER_CRON?.trim() || "0 9 * * *",
    jobType: NOTIFICATION_JOBS.settlementReminders,
  });
}
