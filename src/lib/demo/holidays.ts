import type { PrismaClient } from "../../generated/prisma/client";

/** National bank holidays observed across India on fixed dates. State holidays are added by the admin. */
export const NATIONAL_BANK_HOLIDAYS: { date: string; name: string }[] = [
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-08-15", name: "Independence Day" },
  { date: "2026-10-02", name: "Gandhi Jayanti" },
  { date: "2026-12-25", name: "Christmas" },
  { date: "2027-01-26", name: "Republic Day" },
  { date: "2027-08-15", name: "Independence Day" },
  { date: "2027-10-02", name: "Gandhi Jayanti" },
  { date: "2027-12-25", name: "Christmas" },
];

export async function seedBusinessHolidays(db: PrismaClient): Promise<void> {
  await db.businessHoliday.createMany({
    data: NATIONAL_BANK_HOLIDAYS.map((h) => ({ date: new Date(`${h.date}T00:00:00.000Z`), name: h.name })),
    skipDuplicates: true,
  });
}
