import "server-only";
import { z } from "zod";
import { formatCalendarDate, isCalendarDate, isWeeklyOff, toCalendarDate, toStorageDate } from "@/lib/calendar";
import { recordAudit } from "../audit";
import { assertOrgType, type Actor } from "../auth/session";
import { db } from "../db";
import { conflict, forbidden, notFound } from "../errors";

function requireSuperAdmin(actor: Actor) {
  assertOrgType(actor, "PLATFORM");
  if (actor.role !== "SUPER_ADMIN") throw forbidden();
}

const holidaySchema = z.object({
  date: z.string().trim().refine(isCalendarDate, "Enter a valid date (YYYY-MM-DD)"),
  name: z.string().trim().min(3, "Name the holiday (at least 3 characters)").max(80),
});

export interface BusinessHolidayItem {
  id: string;
  date: string;
  name: string;
  weeklyOff: boolean;
}

/** Holidays from `from` onwards (default: all), oldest first. Readable by the platform and financiers. */
export async function listBusinessHolidays(actor: Actor, filters: { from?: string } = {}): Promise<BusinessHolidayItem[]> {
  if (actor.orgType !== "PLATFORM" && actor.orgType !== "FINANCIER") throw forbidden();
  const rows = await db.businessHoliday.findMany({
    where: filters.from && isCalendarDate(filters.from) ? { date: { gte: toStorageDate(filters.from) } } : {},
    orderBy: { date: "asc" },
  });
  return rows.map((r) => {
    const date = toCalendarDate(r.date);
    return { id: r.id, date, name: r.name, weeklyOff: isWeeklyOff(date) };
  });
}

export async function addBusinessHoliday(actor: Actor, raw: { date: string; name: string }) {
  requireSuperAdmin(actor);
  const input = holidaySchema.parse(raw);
  try {
    return await db.$transaction(async (tx) => {
      const holiday = await tx.businessHoliday.create({ data: { date: toStorageDate(input.date), name: input.name, createdById: actor.userId } });
      await recordAudit(tx, actor, {
        action: "calendar.holiday_added",
        entityType: "BusinessHoliday",
        entityId: holiday.id,
        summary: `Added business holiday ${input.name} on ${formatCalendarDate(input.date)}`,
        metadata: { date: input.date },
      });
      return holiday;
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      throw conflict(`${formatCalendarDate(input.date)} is already in the holiday calendar.`);
    }
    throw error;
  }
}

export async function removeBusinessHoliday(actor: Actor, holidayId: string) {
  requireSuperAdmin(actor);
  const holiday = await db.businessHoliday.findUnique({ where: { id: holidayId } });
  if (!holiday) throw notFound("Holiday not found.");
  const date = toCalendarDate(holiday.date);
  await db.$transaction(async (tx) => {
    const removed = await tx.businessHoliday.deleteMany({ where: { id: holiday.id } });
    if (removed.count !== 1) throw conflict("This holiday was already removed.");
    await recordAudit(tx, actor, {
      action: "calendar.holiday_removed",
      entityType: "BusinessHoliday",
      entityId: holiday.id,
      summary: `Removed business holiday ${holiday.name} on ${formatCalendarDate(date)}`,
      metadata: { date },
    });
  });
}
