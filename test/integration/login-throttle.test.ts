import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reserveAttempt, THROTTLE_POLICIES, throttleKeys } from "@/server/auth/throttle";
import { db } from "@/server/db";
import { authenticate } from "@/server/services/auth";
import { expectDomainError } from "./helpers";
import { createTestUser, TEST_PASSWORD } from "./security-helpers";

const MINUTE = 60_000;
const t0 = new Date("2026-11-06T09:00:00Z");

function at(ms: number) {
  vi.setSystemTime(new Date(t0.getTime() + ms));
}

function freshIp() {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

async function attempt(email: string, password: string, ip: string | null = null) {
  return authenticate({ email, password }, { ip }).then(
    (r) => ({ ok: true as const, step: r.step }),
    (e: { code?: string; message: string }) => ({ ok: false as const, code: e.code, message: e.message }),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("login throttling", () => {
  it("applies progressive delays, then locks the account for 15 minutes after 5 failures and audits it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const user = await createTestUser("CP_ADMIN", "lockout");

    at(0);
    expect(await attempt(user.email, "wrong-1")).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(await attempt(user.email, "wrong-2")).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    // Third attempt must wait 1 s after the second failure.
    expect(await attempt(user.email, TEST_PASSWORD)).toMatchObject({ ok: false, code: "RATE_LIMITED", message: /wait 1 second/ });
    at(1_000);
    expect(await attempt(user.email, "wrong-3")).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    at(2_000);
    expect(await attempt(user.email, "wrong-4")).toMatchObject({ ok: false, code: "RATE_LIMITED", message: /wait 1 second/ });
    at(3_000);
    expect(await attempt(user.email, "wrong-4")).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    at(7_000);
    expect(await attempt(user.email, "wrong-5")).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });

    // Locked: even the right password is refused, without being checked.
    at(8_000);
    expect(await attempt(user.email, TEST_PASSWORD)).toMatchObject({ ok: false, code: "RATE_LIMITED", message: /15 minutes/ });
    at(7_000 + 14 * MINUTE);
    expect(await attempt(user.email, TEST_PASSWORD)).toMatchObject({ ok: false, code: "RATE_LIMITED", message: /1 minute/ });

    const lockouts = await db.auditLog.findMany({ where: { action: "security.lockout", entityId: user.userId } });
    expect(lockouts).toHaveLength(1);
    expect(lockouts[0]).toMatchObject({ entityType: "User", actorUserId: null, actorName: "System" });

    at(7_000 + 15 * MINUTE);
    expect(await attempt(user.email, TEST_PASSWORD)).toEqual({ ok: true, step: "session" });
    const row = await db.authAttempt.findUniqueOrThrow({ where: { key: throttleKeys.loginEmail(user.email) } });
    expect(row).toMatchObject({ failures: 0, lockedUntil: null, lastFailureAt: null });
  });

  it("resets the consecutive-failure count after a successful sign-in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const user = await createTestUser("CP_ADMIN", "reset");
    at(0);
    await attempt(user.email, "wrong");
    await attempt(user.email, "wrong");
    at(1_000);
    expect(await attempt(user.email, TEST_PASSWORD)).toMatchObject({ ok: true });
    expect(await attempt(user.email, "wrong")).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await attempt(user.email, "wrong")).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("throttles unknown accounts exactly like real ones, with the same messages", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const real = await createTestUser("CP_ADMIN", "twin");
    const ghost = `ghost.${randomUUID().slice(0, 8)}@security-test.example`;
    at(0);
    const realResults = [await attempt(real.email, "nope"), await attempt(real.email, "nope"), await attempt(real.email, "nope")];
    const ghostResults = [await attempt(ghost, "nope"), await attempt(ghost, "nope"), await attempt(ghost, "nope")];
    expect(ghostResults).toEqual(realResults);
    expect(realResults[0]).toEqual({ ok: false, code: "UNAUTHENTICATED", message: "The email or password is incorrect." });
    expect(realResults[2]).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("locks out unknown accounts too, auditing the attempted address", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const ghost = `ghost.${randomUUID().slice(0, 8)}@security-test.example`;
    for (const [i, offset] of [0, 0, 1_000, 3_000, 7_000].entries()) {
      at(offset);
      expect(await attempt(ghost, `nope-${i}`)).toMatchObject({ code: "UNAUTHENTICATED" });
    }
    at(8_000);
    expect(await attempt(ghost, "nope")).toMatchObject({ code: "RATE_LIMITED" });
    const key = throttleKeys.loginEmail(ghost);
    expect(await db.auditLog.count({ where: { action: "security.lockout", entityId: key, entityType: "Session" } })).toBe(1);
  });

  it("treats the email case-insensitively for throttling", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const user = await createTestUser("CP_ADMIN", "case");
    at(0);
    await attempt(user.email, "wrong");
    await attempt(user.email.toUpperCase(), "wrong");
    expect(await attempt(user.email.toUpperCase(), "wrong")).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("throttles a single client IP across many accounts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const ip = freshIp();
    at(0);
    for (let i = 0; i < THROTTLE_POLICIES.ip.maxFailures; i += 1) {
      expect(await attempt(`spray.${i}.${randomUUID().slice(0, 6)}@security-test.example`, "Password123!", ip)).toMatchObject({ code: "UNAUTHENTICATED" });
    }
    const user = await createTestUser("CP_ADMIN", "sprayed");
    expect(await attempt(user.email, TEST_PASSWORD, ip)).toMatchObject({ code: "RATE_LIMITED", message: /15 minutes/ });
    // The same account from another address is unaffected.
    expect(await attempt(user.email, TEST_PASSWORD, freshIp())).toMatchObject({ ok: true });
    expect(await db.auditLog.count({ where: { action: "security.lockout", entityId: throttleKeys.loginIp(ip) } })).toBe(1);
  });

  it("does not let successful sign-ins reset a shared IP counter", async () => {
    const ip = freshIp();
    const user = await createTestUser("CP_ADMIN", "nat");
    await attempt(`a.${randomUUID()}@security-test.example`, "x", ip);
    await attempt(`b.${randomUUID()}@security-test.example`, "x", ip);
    expect(await attempt(user.email, TEST_PASSWORD, ip)).toMatchObject({ ok: true });
    const row = await db.authAttempt.findUniqueOrThrow({ where: { key: throttleKeys.loginIp(ip) } });
    expect(row.failures).toBe(2);
  });

  it("cannot be bypassed by a burst of parallel guesses", async () => {
    const user = await createTestUser("CP_ADMIN", "burst");
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => attempt(user.email, `guess-${i}`)));
    const checked = results.filter((r) => !r.ok && r.code === "UNAUTHENTICATED").length;
    const limited = results.filter((r) => !r.ok && r.code === "RATE_LIMITED").length;
    expect(checked).toBeLessThanOrEqual(2);
    expect(checked + limited).toBe(12);
    const row = await db.authAttempt.findUniqueOrThrow({ where: { key: throttleKeys.loginEmail(user.email) } });
    expect(row.failures).toBe(checked);
  });

  it("keeps its state in PostgreSQL, so a new process sees earlier failures", async () => {
    const key = `test:persist:${randomUUID()}`;
    const target = [{ key, policy: THROTTLE_POLICIES.account }];
    await (await reserveAttempt(target, t0)).failed();
    await db.authAttempt.update({ where: { key }, data: { failures: 4, lastFailureAt: t0 } });
    // A brand-new reservation (as another instance would make) reads the stored counter.
    const locking = await (await reserveAttempt(target, new Date(t0.getTime() + 4_000))).failed();
    expect(locking).toEqual([key]);
    await expectDomainError(reserveAttempt(target, new Date(t0.getTime() + 5_000)), "RATE_LIMITED");
  });

  it("still reports a deactivated account only after a correct password", async () => {
    const user = await createTestUser("CP_ADMIN", "inactive");
    await db.user.update({ where: { id: user.userId }, data: { status: "INACTIVE" } });
    expect(await attempt(user.email, "wrong")).toMatchObject({ code: "UNAUTHENTICATED", message: "The email or password is incorrect." });
    expect(await attempt(user.email, TEST_PASSWORD)).toMatchObject({ code: "FORBIDDEN", message: /deactivated/ });
  });
});
