import { describe, expect, it } from "vitest";
import { backoffDelayMs, readQueueConfig } from "./config";

describe("backoffDelayMs", () => {
  it("doubles per attempt with half of the delay fixed and half jittered", () => {
    expect(backoffDelayMs(1, 1000, 60_000, () => 0)).toBe(500);
    expect(backoffDelayMs(1, 1000, 60_000, () => 1)).toBe(1000);
    expect(backoffDelayMs(2, 1000, 60_000, () => 0)).toBe(1000);
    expect(backoffDelayMs(4, 1000, 60_000, () => 1)).toBe(8000);
  });

  it("is capped and stays within [cap/2, cap]", () => {
    for (let attempt = 1; attempt < 80; attempt++) {
      const d = backoffDelayMs(attempt, 5000, 3_600_000);
      expect(d).toBeGreaterThanOrEqual(Math.min(3_600_000, 5000 * 2 ** (attempt - 1)) / 2);
      expect(d).toBeLessThanOrEqual(3_600_000);
    }
  });

  it("never returns zero, even for attempt 0", () => {
    expect(backoffDelayMs(0, 2000, 10_000, () => 0)).toBe(1000);
  });
});

describe("readQueueConfig", () => {
  it("uses safe defaults", () => {
    expect(readQueueConfig({})).toMatchObject({ concurrency: 4, leaseMs: 60_000, defaultMaxAttempts: 8, retentionDays: 14 });
  });

  it("reads overrides and rejects out-of-range or non-integer values", () => {
    expect(readQueueConfig({ WORKER_CONCURRENCY: "8", JOB_MAX_ATTEMPTS: "3" })).toMatchObject({ concurrency: 8, defaultMaxAttempts: 3 });
    expect(() => readQueueConfig({ WORKER_CONCURRENCY: "0" })).toThrow(/WORKER_CONCURRENCY/);
    expect(() => readQueueConfig({ WORKER_LEASE_MS: "1000" })).toThrow(/WORKER_LEASE_MS/);
    expect(() => readQueueConfig({ JOB_MAX_ATTEMPTS: "2.5" })).toThrow(/JOB_MAX_ATTEMPTS/);
  });
});
