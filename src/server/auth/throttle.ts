import "server-only";
import { db, type Tx } from "../db";
import { DomainError } from "../errors";

/**
 * Brute-force protection backed by the `AuthAttempt` table, so limits survive restarts and are shared
 * by every app instance. Each attempt is counted as a failure *before* the credential is checked, under
 * a row lock: a burst of parallel guesses therefore cannot slip past the limit, and a success simply
 * resets (or, for shared keys such as an IP address, releases) the counter afterwards.
 */
export interface ThrottlePolicy {
  /** Failures within `windowMs` that trigger a lockout. */
  maxFailures: number;
  lockoutMs: number;
  /** Failures older than this (measured from the most recent one) are forgotten. */
  windowMs: number;
  /** `delaysMs[n - 1]` is the wait required after `n` consecutive failures (progressive delay). */
  delaysMs: readonly number[];
  /** `reset` clears the counter on success (per-account keys); `release` only undoes this attempt (shared keys). */
  onSuccess: "reset" | "release";
}

const MINUTE = 60_000;

export const THROTTLE_POLICIES = {
  /** Per account: 1 s, 2 s, 4 s delays, then a 15-minute lockout at the fifth consecutive failure. */
  account: { maxFailures: 5, lockoutMs: 15 * MINUTE, windowMs: 15 * MINUTE, delaysMs: [0, 1000, 2000, 4000], onSuccess: "reset" },
  /** Per client IP, across all accounts: generous, because offices share an address behind NAT. */
  ip: { maxFailures: 30, lockoutMs: 15 * MINUTE, windowMs: 15 * MINUTE, delaysMs: [], onSuccess: "release" },
} as const satisfies Record<string, ThrottlePolicy>;

export interface ThrottleTarget {
  key: string;
  policy: ThrottlePolicy;
}

export const throttleKeys = {
  loginEmail: (email: string) => `login:email:${email.trim().toLowerCase()}`,
  loginIp: (ip: string) => `login:ip:${ip}`,
  /** One budget for every one-time-code check of a user: sign-in challenge, enrolment and step-up. */
  otp: (userId: string) => `otp:user:${userId}`,
  /** Password re-entry by a signed-in user (change password, step-up without an authenticator). */
  password: (userId: string) => `password:user:${userId}`,
};

export class RateLimitedError extends DomainError {
  constructor(readonly retryAfterMs: number) {
    super("RATE_LIMITED", rateLimitMessage(retryAfterMs));
  }
}

export function rateLimitMessage(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const wait = seconds < 60 ? `${seconds} second${seconds === 1 ? "" : "s"}` : `${Math.ceil(seconds / 60)} minute${Math.ceil(seconds / 60) === 1 ? "" : "s"}`;
  return `Too many attempts. Please wait ${wait} and try again.`;
}

interface Row {
  failures: number;
  lastFailureAt: Date | null;
  lockedUntil: Date | null;
}

type Decision = { allowed: true; failures: number; lockedUntil: Date | null } | { allowed: false; retryAfterMs: number };

export function decide(row: Row, policy: ThrottlePolicy, now: Date): Decision {
  if (row.lockedUntil && row.lockedUntil > now) return { allowed: false, retryAfterMs: row.lockedUntil.getTime() - now.getTime() };
  let failures = row.failures;
  if (!row.lastFailureAt || now.getTime() - row.lastFailureAt.getTime() >= policy.windowMs) failures = 0;
  if (failures > 0 && row.lastFailureAt) {
    const delay = policy.delaysMs[Math.min(failures, policy.delaysMs.length) - 1] ?? 0;
    const readyAt = row.lastFailureAt.getTime() + delay;
    if (now.getTime() < readyAt) return { allowed: false, retryAfterMs: readyAt - now.getTime() };
  }
  failures += 1;
  return { allowed: true, failures, lockedUntil: failures >= policy.maxFailures ? new Date(now.getTime() + policy.lockoutMs) : null };
}

async function lockRow(tx: Tx, key: string, now: Date): Promise<Row> {
  await tx.$executeRaw`INSERT INTO "AuthAttempt" ("key", "failures", "updatedAt") VALUES (${key}, 0, ${now}) ON CONFLICT ("key") DO NOTHING`;
  const rows = await tx.$queryRaw<Row[]>`SELECT "failures", "lastFailureAt", "lockedUntil" FROM "AuthAttempt" WHERE "key" = ${key} FOR UPDATE`;
  return rows[0]!;
}

export interface AttemptReservation {
  /** Call after the credential checked out. */
  succeeded(): Promise<void>;
  /** Call after the credential was wrong. Returns the keys whose lockout this failure engaged. */
  failed(): Promise<string[]>;
}

/**
 * Reserves one attempt against every target, or throws `RateLimitedError` (and records nothing) when
 * any of them is locked out or still in its progressive delay.
 */
export async function reserveAttempt(targets: ThrottleTarget[], now: Date = new Date()): Promise<AttemptReservation> {
  // A fixed lock order prevents deadlocks between concurrent attempts sharing keys.
  const ordered = [...new Map(targets.map((t) => [t.key, t])).values()].sort((a, b) => a.key.localeCompare(b.key));
  const engaged = await db.$transaction(async (tx): Promise<{ denied: true; retryAfterMs: number } | { denied: false; locking: string[] }> => {
    const decisions: { target: ThrottleTarget; decision: Extract<Decision, { allowed: true }> }[] = [];
    let retryAfterMs = 0;
    for (const target of ordered) {
      const decision = decide(await lockRow(tx, target.key, now), target.policy, now);
      if (!decision.allowed) retryAfterMs = Math.max(retryAfterMs, decision.retryAfterMs);
      else decisions.push({ target, decision });
    }
    if (retryAfterMs > 0) return { denied: true, retryAfterMs };
    for (const { target, decision } of decisions) {
      await tx.authAttempt.update({
        where: { key: target.key },
        data: { failures: decision.failures, lastFailureAt: now, lockedUntil: decision.lockedUntil },
      });
    }
    return { denied: false, locking: decisions.filter((d) => d.decision.lockedUntil).map((d) => d.target.key) };
  });
  if (engaged.denied) throw new RateLimitedError(engaged.retryAfterMs);
  const locking = engaged.locking;

  let settled = false;
  return {
    async succeeded() {
      if (settled) return;
      settled = true;
      await db.$transaction(async (tx) => {
        for (const target of ordered) {
          if (target.policy.onSuccess === "reset") {
            await tx.authAttempt.update({ where: { key: target.key }, data: { failures: 0, lastFailureAt: null, lockedUntil: null } });
          } else {
            await tx.$executeRaw`UPDATE "AuthAttempt" SET "failures" = GREATEST("failures" - 1, 0),
              "lockedUntil" = CASE WHEN "failures" - 1 < ${target.policy.maxFailures} THEN NULL ELSE "lockedUntil" END,
              "updatedAt" = ${new Date()} WHERE "key" = ${target.key}`;
          }
        }
      });
    },
    async failed() {
      settled = true;
      return locking;
    },
  };
}

/** Clears counters left idle for a day. Exposed for the scheduler; not required for correctness. */
export async function purgeStaleAuthAttempts(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * MINUTE);
  const { count } = await db.authAttempt.deleteMany({ where: { updatedAt: { lt: cutoff }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] } });
  return count;
}
