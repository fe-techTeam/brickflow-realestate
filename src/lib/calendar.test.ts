import { describe, expect, it } from "vitest";
import {
  addDays,
  adjustDueDate,
  compareCalendarDates,
  dayOfWeek,
  daysBetween,
  endOfIstDay,
  formatCalendarDate,
  isBusinessDay,
  isCalendarDate,
  isFutureInIst,
  istToday,
  isWeeklyOff,
  nextBusinessDay,
  parseCalendarDate,
  previousBusinessDay,
  startOfIstDay,
  toCalendarDate,
  toStorageDate,
  yearFractionAct365,
} from "./calendar";

describe("istToday", () => {
  it.each([
    ["2026-11-02T18:29:59.999Z", "2026-11-02", "23:59:59.999 IST is still the same day"],
    ["2026-11-02T18:30:00.000Z", "2026-11-03", "IST midnight starts the next day"],
    ["2026-11-02T00:00:00.000Z", "2026-11-02", "05:30 IST"],
    ["2026-11-01T23:59:59.000Z", "2026-11-02", "UTC is still the previous day"],
    ["2026-12-31T18:30:00.000Z", "2027-01-01", "new year in India before UTC"],
    ["2028-02-28T19:00:00.000Z", "2028-02-29", "leap day"],
    ["2026-02-28T18:30:00.000Z", "2026-03-01", "end of February in a common year"],
  ])("%s is %s (%s)", (instant, expected) => {
    expect(istToday(new Date(instant))).toBe(expected);
  });

  it("rejects an invalid instant", () => {
    expect(() => istToday(new Date("not a date"))).toThrow(RangeError);
  });
});

describe("calendar dates", () => {
  it.each([
    ["2026-11-06", true],
    ["2028-02-29", true],
    ["2026-02-29", false],
    ["2026-13-01", false],
    ["2026-04-31", false],
    ["2026-1-01", false],
    ["06-11-2026", false],
    ["", false],
  ])("isCalendarDate(%j) is %s", (value, valid) => {
    expect(isCalendarDate(value)).toBe(valid);
    if (valid) expect(parseCalendarDate(value)).toBe(value);
    else expect(() => parseCalendarDate(value)).toThrow(RangeError);
  });

  it("round-trips the UTC-midnight storage convention", () => {
    expect(toStorageDate("2026-11-06").toISOString()).toBe("2026-11-06T00:00:00.000Z");
    expect(toCalendarDate(new Date("2026-11-06T00:00:00.000Z"))).toBe("2026-11-06");
    expect(toCalendarDate(toStorageDate("2028-02-29"))).toBe("2028-02-29");
  });

  it.each([
    ["2026-01-31", 1, "2026-02-01"],
    ["2026-02-28", 1, "2026-03-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2026-11-06", 0, "2026-11-06"],
    ["2026-11-06", 365, "2027-11-06"],
  ])("addDays(%s, %i) = %s", (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });

  it("refuses fractional day offsets", () => {
    expect(() => addDays("2026-11-06", 0.5)).toThrow(RangeError);
  });
});

describe("daysBetween (ACT) and ACT/365", () => {
  it.each([
    ["2026-11-06", "2026-11-06", 0],
    ["2026-11-06", "2026-11-07", 1],
    ["2026-11-07", "2026-11-06", -1],
    ["2026-01-01", "2027-01-01", 365],
    ["2028-01-01", "2029-01-01", 366],
    ["2028-02-28", "2028-03-01", 2],
    ["2026-02-28", "2026-03-01", 1],
    ["2026-11-06", "2027-01-20", 75],
    ["2026-03-29", "2026-03-30", 1],
  ])("from %s to %s is %i days", (from, to, days) => {
    expect(daysBetween(from, to)).toBe(days);
  });

  it("computes the ACT/365 year fraction, including leap years", () => {
    expect(yearFractionAct365("2026-01-01", "2027-01-01")).toBe(1);
    expect(yearFractionAct365("2028-01-01", "2029-01-01")).toBeCloseTo(366 / 365, 12);
    expect(yearFractionAct365("2026-11-06", "2027-01-05")).toBeCloseTo(60 / 365, 12);
  });

  it("orders calendar dates", () => {
    expect(compareCalendarDates("2026-11-06", "2026-11-07")).toBe(-1);
    expect(compareCalendarDates("2026-11-07", "2026-11-07")).toBe(0);
    expect(compareCalendarDates("2027-01-01", "2026-12-31")).toBe(1);
  });
});

describe("IST day boundaries", () => {
  it("starts and ends the day at IST midnight", () => {
    expect(startOfIstDay("2026-11-06").toISOString()).toBe("2026-11-05T18:30:00.000Z");
    expect(endOfIstDay("2026-11-06").toISOString()).toBe("2026-11-06T18:29:59.999Z");
    expect(istToday(startOfIstDay("2026-11-06"))).toBe("2026-11-06");
    expect(istToday(endOfIstDay("2026-11-06"))).toBe("2026-11-06");
  });

  it("treats a date as future only when it is after today in India", () => {
    const halfPastMidnightIst = new Date("2026-11-02T19:00:00.000Z");
    expect(isFutureInIst("2026-11-03", halfPastMidnightIst)).toBe(false);
    expect(isFutureInIst("2026-11-04", halfPastMidnightIst)).toBe(true);
    const lateEveningIst = new Date("2026-11-02T18:00:00.000Z");
    expect(isFutureInIst("2026-11-03", lateEveningIst)).toBe(true);
  });
});

describe("business days", () => {
  it.each([
    ["2026-11-01", 0],
    ["2026-11-02", 1],
    ["2026-11-06", 5],
    ["2026-11-07", 6],
    ["1970-01-01", 4],
    ["2000-01-01", 6],
  ])("%s is weekday %i", (date, dow) => {
    expect(dayOfWeek(date)).toBe(dow);
  });

  it.each([
    ["2026-11-01", true, "Sunday"],
    ["2026-11-07", false, "first Saturday"],
    ["2026-11-14", true, "second Saturday"],
    ["2026-11-21", false, "third Saturday"],
    ["2026-11-28", true, "fourth Saturday"],
    ["2026-08-29", false, "fifth Saturday"],
    ["2026-08-08", true, "second Saturday on the 8th"],
    ["2026-08-22", true, "fourth Saturday on the 22nd"],
    ["2026-11-06", false, "Friday"],
  ])("isWeeklyOff(%s) is %s (%s)", (date, off) => {
    expect(isWeeklyOff(date)).toBe(off);
  });

  const holidays = new Set(["2026-11-09", "2026-11-10", "2026-12-25"]);

  it.each([
    ["2026-11-06", "2026-11-07", "Friday to first Saturday"],
    ["2026-11-13", "2026-11-16", "skips second Saturday and Sunday"],
    ["2026-11-07", "2026-11-11", "skips Sunday and a two-day holiday"],
    ["2026-12-24", "2026-12-28", "skips Christmas, the fourth Saturday and Sunday"],
  ])("nextBusinessDay(%s) = %s (%s)", (date, expected) => {
    expect(nextBusinessDay(date, holidays)).toBe(expected);
  });

  it.each([
    ["2026-11-11", "2026-11-07"],
    ["2026-11-16", "2026-11-13"],
    ["2026-11-02", "2026-10-31"],
  ])("previousBusinessDay(%s) = %s", (date, expected) => {
    expect(previousBusinessDay(date, holidays)).toBe(expected);
  });

  it("checks holidays and weekly closures together", () => {
    expect(isBusinessDay("2026-11-09", holidays)).toBe(false);
    expect(isBusinessDay("2026-11-11", holidays)).toBe(true);
    expect(isBusinessDay("2026-11-14")).toBe(false);
  });

  it.each([
    ["NONE", "2026-11-14", "2026-11-14"],
    ["NONE", "2026-11-09", "2026-11-09"],
    ["NEXT_BUSINESS_DAY", "2026-11-06", "2026-11-06"],
    ["NEXT_BUSINESS_DAY", "2026-11-08", "2026-11-11"],
    ["NEXT_BUSINESS_DAY", "2026-11-14", "2026-11-16"],
    ["NEXT_BUSINESS_DAY", "2026-12-25", "2026-12-28"],
  ] as const)("adjustDueDate with %s moves %s to %s", (rule, date, expected) => {
    expect(adjustDueDate(date, rule, holidays)).toBe(expected);
  });

  it("fails loudly when the holiday list leaves no business day for a month", () => {
    const blocked = new Set(Array.from({ length: 40 }, (_, i) => addDays("2026-11-01", i)));
    expect(() => nextBusinessDay("2026-10-31", blocked)).toThrow(/holiday calendar/);
  });

  it("validates the date it adjusts", () => {
    expect(() => adjustDueDate("2026-02-30", "NONE")).toThrow(RangeError);
  });
});

describe("formatCalendarDate", () => {
  it("formats without shifting the day", () => {
    expect(formatCalendarDate("2026-11-06")).toBe("06 Nov 2026");
    expect(formatCalendarDate("2027-01-01")).toBe("01 Jan 2027");
  });
});
