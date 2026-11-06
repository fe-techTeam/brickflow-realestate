import "server-only";
import type { SettlementStatus } from "@/generated/prisma/client";
import { addDays, istToday, toStorageDate } from "@/lib/calendar";
import { deriveSettlementStatus, sourcesFor } from "@/lib/state-machines";
import { db } from "../db";

/** Derived status of an unsettled obligation on the IST calendar. */
export function settlementStatusFor(dueDate: Date, now: Date = new Date()): SettlementStatus {
  return deriveSettlementStatus(dueDate, now);
}

export function effectiveSettlementStatus(settlement: { status: SettlementStatus; dueDate: Date }, now: Date = new Date()): SettlementStatus {
  return settlement.status === "SETTLED" ? "SETTLED" : settlementStatusFor(settlement.dueDate, now);
}

export interface SettlementRecompute {
  /** IST calendar date the statuses were evaluated for. */
  asOf: string;
  becameDue: number;
  becameOverdue: number;
}

/**
 * Persists time-driven settlement transitions (NOT_DUE → DUE → OVERDUE) for the IST date of `now`.
 * Set-based conditional updates make it idempotent and safe to run concurrently with user actions:
 * a settlement marked SETTLED meanwhile is never touched, and statuses never move backwards.
 * Intended for a scheduled job shortly after IST midnight; pages also call it before reading.
 */
export async function recomputeSettlementStatuses(now: Date = new Date()): Promise<SettlementRecompute> {
  const today = istToday(now);
  const startOfToday = toStorageDate(today);
  const startOfTomorrow = toStorageDate(addDays(today, 1));
  const [overdue, due] = await db.$transaction([
    db.settlement.updateMany({
      where: { status: { in: sourcesFor("settlement", "OVERDUE", ["NOT_DUE", "DUE"]) }, dueDate: { lt: startOfToday } },
      data: { status: "OVERDUE" },
    }),
    db.settlement.updateMany({
      where: { status: { in: sourcesFor("settlement", "DUE", ["NOT_DUE"]) }, dueDate: { gte: startOfToday, lt: startOfTomorrow } },
      data: { status: "DUE" },
    }),
  ]);
  return { asOf: today, becameDue: due.count, becameOverdue: overdue.count };
}

/** On-read refresh used by financier pages so lists and filters reflect today's statuses. */
export async function refreshSettlementStatuses(now: Date = new Date()): Promise<void> {
  await recomputeSettlementStatuses(now);
}
