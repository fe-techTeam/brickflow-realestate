import { describe, expect, it } from "vitest";
import { CronParseError, nextCronTime, parseCron } from "./cron";

const utc = (iso: string) => new Date(iso);

describe("parseCron", () => {
  it("expands wildcards, ranges, steps and lists", () => {
    const cron = parseCron("*/15 9-11 1,15 * 1-5");
    expect([...cron.minutes]).toEqual([0, 15, 30, 45]);
    expect([...cron.hours]).toEqual([9, 10, 11]);
    expect([...cron.days]).toEqual([1, 15]);
    expect(cron.months.size).toBe(12);
    expect([...cron.weekdays]).toEqual([1, 2, 3, 4, 5]);
  });

  it("treats day-of-week 7 as Sunday and supports a stepped start value", () => {
    expect([...parseCron("0 0 * * 7").weekdays]).toEqual([0]);
    expect([...parseCron("5/20 * * * *").minutes]).toEqual([5, 25, 45]);
  });

  it.each(["", "* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "*/0 * * * *", "a * * * *", "5-1 * * * *"])(
    "rejects %j",
    (expression) => {
      expect(() => parseCron(expression)).toThrow(CronParseError);
    },
  );
});

describe("nextCronTime in IST (+05:30)", () => {
  it("09:00 IST daily is 03:30 UTC, strictly after the reference time", () => {
    expect(nextCronTime("0 9 * * *", utc("2026-11-06T01:00:00Z")).toISOString()).toBe("2026-11-06T03:30:00.000Z");
    expect(nextCronTime("0 9 * * *", utc("2026-11-06T03:30:00Z")).toISOString()).toBe("2026-11-07T03:30:00.000Z");
    expect(nextCronTime("0 9 * * *", utc("2026-11-06T03:29:59.999Z")).toISOString()).toBe("2026-11-06T03:30:00.000Z");
  });

  it("rolls over the IST date boundary correctly", () => {
    // 23:00 UTC on the 6th is 04:30 IST on the 7th; 03:30 IST next falls on the 8th.
    expect(nextCronTime("30 3 * * *", utc("2026-11-06T23:00:00Z")).toISOString()).toBe("2026-11-07T22:00:00.000Z");
  });

  it("handles month and year ends", () => {
    expect(nextCronTime("0 0 1 * *", utc("2026-12-15T00:00:00Z"), 0).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(nextCronTime("0 12 29 2 *", utc("2026-03-01T00:00:00Z"), 0).toISOString()).toBe("2028-02-29T12:00:00.000Z");
  });

  it("ORs day-of-month and day-of-week when both are restricted", () => {
    // 2026-11-06 is a Friday. "1st of month or Monday" -> Monday 9th.
    expect(nextCronTime("0 8 1 * 1", utc("2026-11-06T12:00:00Z"), 0).toISOString()).toBe("2026-11-09T08:00:00.000Z");
  });

  it("restricts to weekdays only when day-of-month is a wildcard", () => {
    // Friday evening -> next weekday run is Monday.
    expect(nextCronTime("0 9 * * 1-5", utc("2026-11-06T12:00:00Z"), 0).toISOString()).toBe("2026-11-09T09:00:00.000Z");
  });

  it("supports minute steps", () => {
    expect(nextCronTime("*/5 * * * *", utc("2026-11-06T10:02:10Z"), 0).toISOString()).toBe("2026-11-06T10:05:00.000Z");
  });

  it("fails for an expression that can never match", () => {
    expect(() => nextCronTime("0 0 31 2 *", utc("2026-01-01T00:00:00Z"))).toThrow(/never matches/);
  });
});
