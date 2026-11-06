import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SettlementStatus } from "@/generated/prisma/client";
import { addDays, istToday, startOfIstDay, toStorageDate } from "@/lib/calendar";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import { effectiveSettlementStatus, recomputeSettlementStatuses, settlementStatusFor } from "@/server/services/financing";
import { addBusinessHoliday, listBusinessHolidays, removeBusinessHoliday } from "@/server/services/business-calendar";
import { financedTo } from "./fixtures-financing";
import { actors, auditActions, expectDomainError, expectValidationError, type DemoUser } from "./helpers";

let as: Record<DemoUser, Actor>;
const settlements: string[] = [];
const originals = new Map<string, { status: SettlementStatus; dueDate: Date; settledAt: Date | null; reference: string | null }>();

beforeAll(async () => {
  as = await actors();
  for (let i = 0; i < 6; i += 1) {
    const { requestId } = await financedTo(as, "DISBURSED");
    const s = await db.settlement.findUniqueOrThrow({ where: { requestId: requestId! } });
    settlements.push(s.id);
    originals.set(s.id, { status: s.status, dueDate: s.dueDate, settledAt: s.settledAt, reference: s.reference });
  }
});

afterAll(async () => {
  for (const [id, data] of originals) await db.settlement.update({ where: { id }, data });
});

async function setSettlement(index: number, dueDate: string, status: SettlementStatus) {
  const id = settlements[index]!;
  await db.settlement.update({
    where: { id },
    data: { dueDate: toStorageDate(dueDate), status, ...(status === "SETTLED" ? { settledAt: new Date(), reference: "NEFT-TEST-RECOMP" } : { settledAt: null, reference: null }) },
  });
  return id;
}

async function statusOf(id: string) {
  return (await db.settlement.findUniqueOrThrow({ where: { id } })).status;
}

describe("recomputeSettlementStatuses", () => {
  it("moves open settlements forward on the IST calendar and leaves the rest alone", async () => {
    const now = new Date();
    const today = istToday(now);
    const ids = {
      dueYesterday: await setSettlement(0, addDays(today, -1), "NOT_DUE"),
      dueToday: await setSettlement(1, today, "NOT_DUE"),
      dueTomorrow: await setSettlement(2, addDays(today, 1), "NOT_DUE"),
      dueYesterdayMarkedDue: await setSettlement(3, addDays(today, -1), "DUE"),
      settled: await setSettlement(4, addDays(today, -10), "SETTLED"),
      aheadOfCalendar: await setSettlement(5, addDays(today, 3), "OVERDUE"),
    };

    const result = await recomputeSettlementStatuses(now);
    expect(result.asOf).toBe(today);
    expect(result.becameDue).toBeGreaterThanOrEqual(1);
    expect(result.becameOverdue).toBeGreaterThanOrEqual(2);

    expect(await statusOf(ids.dueYesterday)).toBe("OVERDUE");
    expect(await statusOf(ids.dueToday)).toBe("DUE");
    expect(await statusOf(ids.dueTomorrow)).toBe("NOT_DUE");
    expect(await statusOf(ids.dueYesterdayMarkedDue)).toBe("OVERDUE");
    expect(await statusOf(ids.settled)).toBe("SETTLED");
    // Statuses never move backwards, even when stored data is ahead of the calendar.
    expect(await statusOf(ids.aheadOfCalendar)).toBe("OVERDUE");
  });

  it("is idempotent", async () => {
    const now = new Date();
    await recomputeSettlementStatuses(now);
    const before = await db.settlement.findMany({ where: { id: { in: settlements } }, select: { id: true, status: true, updatedAt: true } });
    const again = await recomputeSettlementStatuses(now);
    const after = await db.settlement.findMany({ where: { id: { in: settlements } }, select: { id: true, status: true, updatedAt: true } });
    expect(after).toEqual(before);
    expect(again.becameDue + again.becameOverdue).toBe(0);
  });

  it("uses IST midnight, not 05:30 IST, as the day boundary", async () => {
    const today = istToday();
    const id = await setSettlement(0, today, "NOT_DUE");
    const lastMinuteYesterday = new Date(startOfIstDay(today).getTime() - 60_000);
    await recomputeSettlementStatuses(lastMinuteYesterday);
    expect(await statusOf(id)).toBe("NOT_DUE");

    const halfPastMidnight = new Date(startOfIstDay(today).getTime() + 30 * 60_000);
    expect(settlementStatusFor(toStorageDate(today), halfPastMidnight)).toBe("DUE");
    await recomputeSettlementStatuses(halfPastMidnight);
    expect(await statusOf(id)).toBe("DUE");
  });

  it("derives the effective status for display without touching storage", () => {
    const due = new Date("2026-11-03T00:00:00.000Z");
    expect(effectiveSettlementStatus({ status: "NOT_DUE", dueDate: due }, new Date("2026-11-02T19:00:00.000Z"))).toBe("DUE");
    expect(effectiveSettlementStatus({ status: "SETTLED", dueDate: due }, new Date("2027-01-01T00:00:00.000Z"))).toBe("SETTLED");
  });
});

describe("business holiday calendar", () => {
  it("lets the super admin add and remove holidays with an audit trail", async () => {
    const holiday = await addBusinessHoliday(as.admin, { date: "2031-03-14", name: "Holi" });
    expect((await listBusinessHolidays(as.admin, { from: "2031-01-01" })).map((h) => [h.date, h.name])).toContainEqual(["2031-03-14", "Holi"]);
    await expectDomainError(addBusinessHoliday(as.admin, { date: "2031-03-14", name: "Duplicate" }), "CONFLICT", /already in the holiday calendar/);
    await removeBusinessHoliday(as.admin, holiday.id);
    await expectDomainError(removeBusinessHoliday(as.admin, holiday.id), "NOT_FOUND");
    expect(await auditActions(holiday.id)).toEqual(["calendar.holiday_added", "calendar.holiday_removed"]);
  });

  it("flags holidays that already fall on a weekly closure", async () => {
    const holiday = await addBusinessHoliday(as.admin, { date: "2031-03-09", name: "Sunday observance" });
    try {
      expect((await listBusinessHolidays(as.finance, { from: "2031-03-09" }))[0]).toMatchObject({ date: "2031-03-09", weeklyOff: true });
    } finally {
      await removeBusinessHoliday(as.admin, holiday.id);
    }
  });

  it("validates input and restricts changes to the super admin", async () => {
    await expectValidationError(addBusinessHoliday(as.admin, { date: "2031-02-30", name: "Impossible" }), "date");
    await expectValidationError(addBusinessHoliday(as.admin, { date: "2031-03-14", name: "x" }), "name");
    await expectDomainError(addBusinessHoliday(as.finance, { date: "2031-03-14", name: "Holi" }), "FORBIDDEN");
    await expectDomainError(addBusinessHoliday(as.godrej, { date: "2031-03-14", name: "Holi" }), "FORBIDDEN");
    await expectDomainError(listBusinessHolidays(as.prestige), "FORBIDDEN");
  });

  it("seeds the national bank holidays", async () => {
    const dates = (await listBusinessHolidays(as.admin)).map((h) => h.date);
    expect(dates).toEqual(expect.arrayContaining(["2026-01-26", "2026-08-15", "2026-10-02", "2026-12-25"]));
  });
});
