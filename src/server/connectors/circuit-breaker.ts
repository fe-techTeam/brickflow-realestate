/**
 * Per-provider circuit breaker. After `failureThreshold` consecutive failures the circuit opens and
 * calls fail fast for `openMs`; then one trial call is let through (half-open). A success closes the
 * circuit, a failure re-opens it.
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  openMs?: number;
  now?: () => number;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private openedAt = 0;
  private trialInFlight = false;
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly now: () => number;

  constructor(
    readonly name: string,
    options: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.openMs = options.openMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  get currentState(): CircuitState {
    if (this.state === "OPEN" && this.now() - this.openedAt >= this.openMs) return "HALF_OPEN";
    return this.state;
  }

  /** Milliseconds until a trial call is allowed; 0 when calls may proceed. */
  remainingOpenMs(): number {
    if (this.state !== "OPEN") return 0;
    return Math.max(0, this.openMs - (this.now() - this.openedAt));
  }

  /** Reserves permission for one call. Returns false when the call must fail fast. */
  tryAcquire(): boolean {
    const state = this.currentState;
    if (state === "CLOSED") return true;
    if (state === "OPEN") return false;
    if (this.trialInFlight) return false;
    this.state = "HALF_OPEN";
    this.trialInFlight = true;
    return true;
  }

  recordSuccess(): void {
    this.state = "CLOSED";
    this.failures = 0;
    this.trialInFlight = false;
  }

  recordFailure(): void {
    this.trialInFlight = false;
    if (this.state === "HALF_OPEN") {
      this.open();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.open();
  }

  /** Releases a half-open reservation without counting the outcome (e.g. caller-side validation errors). */
  recordNeutral(): void {
    if (this.state === "HALF_OPEN") this.recordSuccess();
  }

  reset(): void {
    this.state = "CLOSED";
    this.failures = 0;
    this.openedAt = 0;
    this.trialInFlight = false;
  }

  private open(): void {
    this.state = "OPEN";
    this.openedAt = this.now();
    this.failures = 0;
  }
}

const breakers = new Map<string, CircuitBreaker>();

/** Shared breaker per provider so every client instance for that provider sees the same health. */
export function breakerFor(provider: string, options?: CircuitBreakerOptions): CircuitBreaker {
  let breaker = breakers.get(provider);
  if (!breaker) {
    breaker = new CircuitBreaker(provider, options);
    breakers.set(provider, breaker);
  }
  return breaker;
}

export function resetAllBreakers(): void {
  for (const breaker of breakers.values()) breaker.reset();
}
