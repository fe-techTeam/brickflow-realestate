import { describe, expect, it } from "vitest";
import { breakerFor, CircuitBreaker } from "./circuit-breaker";

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("CircuitBreaker", () => {
  it("opens after the failure threshold and fails fast while open", () => {
    const time = clock();
    const breaker = new CircuitBreaker("t", { failureThreshold: 3, openMs: 1000, now: time.now });
    for (let i = 0; i < 2; i++) {
      expect(breaker.tryAcquire()).toBe(true);
      breaker.recordFailure();
    }
    expect(breaker.currentState).toBe("CLOSED");
    breaker.tryAcquire();
    breaker.recordFailure();
    expect(breaker.currentState).toBe("OPEN");
    expect(breaker.tryAcquire()).toBe(false);
    expect(breaker.remainingOpenMs()).toBe(1000);
  });

  it("resets the failure count on success", () => {
    const breaker = new CircuitBreaker("t", { failureThreshold: 2 });
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.currentState).toBe("CLOSED");
  });

  it("allows a single trial call when half-open, closing on success", () => {
    const time = clock();
    const breaker = new CircuitBreaker("t", { failureThreshold: 1, openMs: 1000, now: time.now });
    breaker.recordFailure();
    time.advance(1000);
    expect(breaker.currentState).toBe("HALF_OPEN");
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.tryAcquire()).toBe(false);
    breaker.recordSuccess();
    expect(breaker.currentState).toBe("CLOSED");
    expect(breaker.tryAcquire()).toBe(true);
  });

  it("re-opens when the half-open trial fails", () => {
    const time = clock();
    const breaker = new CircuitBreaker("t", { failureThreshold: 5, openMs: 1000, now: time.now });
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    time.advance(1500);
    expect(breaker.tryAcquire()).toBe(true);
    breaker.recordFailure();
    expect(breaker.currentState).toBe("OPEN");
    expect(breaker.remainingOpenMs()).toBe(1000);
  });

  it("shares one breaker per provider", () => {
    expect(breakerFor("shared-provider")).toBe(breakerFor("shared-provider"));
    expect(breakerFor("shared-provider")).not.toBe(breakerFor("other-provider"));
  });
});
