import { describe, expect, it } from "vitest";
import { decide, rateLimitMessage, THROTTLE_POLICIES } from "./throttle";

const account = THROTTLE_POLICIES.account;
const ip = THROTTLE_POLICIES.ip;
const t0 = new Date("2026-11-06T10:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

describe("throttle decisions", () => {
  it("allows the first attempt and counts it", () => {
    expect(decide({ failures: 0, lastFailureAt: null, lockedUntil: null }, account, t0)).toEqual({ allowed: true, failures: 1, lockedUntil: null });
  });

  it("applies progressive delays of 0 s, 1 s, 2 s and 4 s after consecutive failures", () => {
    const row = (failures: number) => ({ failures, lastFailureAt: t0, lockedUntil: null });
    expect(decide(row(1), account, at(0))).toMatchObject({ allowed: true, failures: 2 });
    expect(decide(row(2), account, at(999))).toEqual({ allowed: false, retryAfterMs: 1 });
    expect(decide(row(2), account, at(1000))).toMatchObject({ allowed: true, failures: 3 });
    expect(decide(row(3), account, at(1999))).toMatchObject({ allowed: false });
    expect(decide(row(3), account, at(2000))).toMatchObject({ allowed: true, failures: 4 });
    expect(decide(row(4), account, at(3999))).toMatchObject({ allowed: false });
  });

  it("locks the account for 15 minutes when the fifth consecutive attempt is made", () => {
    const decision = decide({ failures: 4, lastFailureAt: t0, lockedUntil: null }, account, at(4000));
    expect(decision).toEqual({ allowed: true, failures: 5, lockedUntil: at(4000 + 15 * 60_000) });
    const locked = { failures: 5, lastFailureAt: at(4000), lockedUntil: at(4000 + 15 * 60_000) };
    expect(decide(locked, account, at(4000 + 14 * 60_000))).toEqual({ allowed: false, retryAfterMs: 60_000 });
    expect(decide(locked, account, at(4000 + 15 * 60_000))).toEqual({ allowed: true, failures: 1, lockedUntil: null });
  });

  it("forgets failures older than the window", () => {
    expect(decide({ failures: 4, lastFailureAt: t0, lockedUntil: null }, account, at(15 * 60_000))).toEqual({ allowed: true, failures: 1, lockedUntil: null });
  });

  it("throttles an IP only by volume, without per-attempt delays", () => {
    expect(decide({ failures: 20, lastFailureAt: t0, lockedUntil: null }, ip, t0)).toMatchObject({ allowed: true, failures: 21 });
    expect(decide({ failures: 29, lastFailureAt: t0, lockedUntil: null }, ip, t0)).toMatchObject({ allowed: true, failures: 30, lockedUntil: at(15 * 60_000) });
  });

  it("explains the wait in seconds or minutes", () => {
    expect(rateLimitMessage(800)).toBe("Too many attempts. Please wait 1 second and try again.");
    expect(rateLimitMessage(4000)).toBe("Too many attempts. Please wait 4 seconds and try again.");
    expect(rateLimitMessage(15 * 60_000)).toBe("Too many attempts. Please wait 15 minutes and try again.");
    expect(rateLimitMessage(61_000)).toBe("Too many attempts. Please wait 2 minutes and try again.");
  });
});
