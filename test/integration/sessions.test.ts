import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_IDLE_TIMEOUT_MS, SESSION_MAX_AGE_MS, SESSION_TOUCH_INTERVAL_MS } from "@/server/auth/config";
import { listActiveSessions, purgeEndedSessions, revokeUserSessions, rotateSessionRecord, validateSession } from "@/server/auth/sessions";
import { verifySessionToken } from "@/server/auth/token";
import { db } from "@/server/db";
import { setOrganisationStatus, setUserStatus } from "@/server/services/admin";
import { revokeOwnSession, signOutEverywhere } from "@/server/services/security";
import { actorFor, expectDomainError } from "./helpers";
import { createTestUser, openSession } from "./security-helpers";

const ORIGIN = { ip: "203.0.113.20", userAgent: "vitest" };
const claimsOf = (s: { id: string; userId: string; membershipId: string }) => ({ sub: s.userId, mid: s.membershipId, sid: s.id });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server-side sessions", () => {
  it("issues a token that carries only the session id and validates against the row", async () => {
    const user = await createTestUser("CP_ADMIN", "session");
    const { session, token } = await openSession(user);
    const claims = await verifySessionToken(token);
    expect(claims).toEqual({ sub: user.userId, mid: user.membershipId, sid: session.id });
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(SESSION_MAX_AGE_MS);
    expect(session).toMatchObject({ ip: "203.0.113.10", roleKey: "CP_ADMIN", revokedAt: null });

    const valid = await validateSession(claims!);
    expect(valid?.membership.id).toBe(user.membershipId);
    expect(await validateSession({ ...claims!, sid: "forged-session-id" })).toBeNull();
    expect(await validateSession({ ...claims!, sub: "someone-else" })).toBeNull();
  });

  it("rejects tokens without a session id or for another audience", async () => {
    const { SignJWT } = await import("jose");
    const key = new TextEncoder().encode(process.env.AUTH_SECRET);
    const legacy = await new SignJWT({ mid: "m" }).setProtectedHeader({ alg: "HS256" }).setSubject("u").setIssuer("brickflow").setExpirationTime("1h").sign(key);
    expect(await verifySessionToken(legacy)).toBeNull();
    const wrongAudience = await new SignJWT({ mid: "m" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u")
      .setJti("s")
      .setIssuer("brickflow")
      .setAudience("brickflow:mfa")
      .setExpirationTime("1h")
      .sign(key);
    expect(await verifySessionToken(wrongAudience)).toBeNull();
  });

  it("expires after 30 minutes idle, and touches lastSeenAt at most once a minute", async () => {
    const user = await createTestUser("CP_ADMIN", "idle");
    const t0 = new Date("2026-11-06T08:00:00Z");
    const { session } = await openSession(user, { now: t0 });
    const claims = claimsOf(session);

    expect(await validateSession(claims, new Date(t0.getTime() + SESSION_TOUCH_INTERVAL_MS - 1))).not.toBeNull();
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).lastSeenAt).toEqual(t0);

    const t1 = new Date(t0.getTime() + SESSION_IDLE_TIMEOUT_MS - 1000);
    expect(await validateSession(claims, t1)).not.toBeNull();
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).lastSeenAt).toEqual(t1);

    expect(await validateSession(claims, new Date(t1.getTime() + SESSION_IDLE_TIMEOUT_MS - 1000))).not.toBeNull();
    const idle = new Date(t1.getTime() + 2 * SESSION_IDLE_TIMEOUT_MS);
    expect(await validateSession(claims, idle)).toBeNull();
  });

  it("expires at the absolute limit even when continuously active", async () => {
    const user = await createTestUser("CP_ADMIN", "absolute");
    const t0 = new Date("2026-11-06T08:00:00Z");
    const { session } = await openSession(user, { now: t0 });
    const claims = claimsOf(session);
    for (let elapsed = 20 * 60_000; elapsed < SESSION_MAX_AGE_MS; elapsed += 20 * 60_000) {
      expect(await validateSession(claims, new Date(t0.getTime() + elapsed))).not.toBeNull();
    }
    expect(await validateSession(claims, new Date(t0.getTime() + SESSION_MAX_AGE_MS))).toBeNull();
  });

  describe("rotation", () => {
    it("issues a new id, revokes the old one atomically and never extends the absolute expiry", async () => {
      const user = await createTestUser("CP_ADMIN", "rotate");
      const t0 = new Date("2026-11-06T08:00:00Z");
      const { session } = await openSession(user, { now: t0, mfaVerified: true });
      const t1 = new Date(t0.getTime() + 20 * 60_000);
      await validateSession(claimsOf(session), t1);

      const rotated = await db.$transaction((tx) => rotateSessionRecord(tx, session.id, ORIGIN, t1));
      expect(rotated).not.toBeNull();
      expect(rotated!.id).not.toBe(session.id);
      expect(rotated!.expiresAt).toEqual(session.expiresAt);
      expect(rotated!.createdAt).toEqual(session.createdAt);
      expect(rotated!.lastSeenAt).toEqual(t1);
      expect(rotated!.mfaVerifiedAt).toEqual(session.mfaVerifiedAt);

      const old = await db.session.findUniqueOrThrow({ where: { id: session.id } });
      expect(old).toMatchObject({ revokedAt: t1, revokedReason: "rotated" });
      expect(await validateSession(claimsOf(session), t1)).toBeNull();
      expect(await validateSession(claimsOf(rotated!), t1)).not.toBeNull();
      // The idle timeout still runs from the rotation time.
      expect(await validateSession(claimsOf(rotated!), new Date(t1.getTime() + SESSION_IDLE_TIMEOUT_MS + 1000))).toBeNull();
    });

    it("still ends at the original absolute expiry after many rotations", async () => {
      const user = await createTestUser("CP_ADMIN", "rotate-many");
      const t0 = new Date("2026-11-06T08:00:00Z");
      let { session } = await openSession(user, { now: t0 });
      const originalExpiry = session.expiresAt;
      let now = t0;
      for (let i = 0; i < 30; i += 1) {
        now = new Date(now.getTime() + 15 * 60_000);
        if (now >= originalExpiry) break;
        const next = await db.$transaction((tx) => rotateSessionRecord(tx, session.id, ORIGIN, now));
        expect(next!.expiresAt).toEqual(originalExpiry);
        session = next!;
      }
      expect(await validateSession(claimsOf(session), new Date(originalExpiry.getTime() - 1000))).not.toBeNull();
      expect(await validateSession(claimsOf(session), originalExpiry)).toBeNull();
      expect(await db.$transaction((tx) => rotateSessionRecord(tx, session.id, ORIGIN, originalExpiry))).toBeNull();
    });

    it("cannot rotate a revoked session or rotate the same session twice", async () => {
      const user = await createTestUser("CP_ADMIN", "rotate-twice");
      const { session } = await openSession(user);
      const [a, b] = await Promise.all([
        db.$transaction((tx) => rotateSessionRecord(tx, session.id, ORIGIN)),
        db.$transaction((tx) => rotateSessionRecord(tx, session.id, ORIGIN)),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
      expect(await db.$transaction((tx) => rotateSessionRecord(tx, session.id, ORIGIN))).toBeNull();
      expect(await db.session.count({ where: { userId: user.userId, revokedAt: null } })).toBe(1);
    });
  });

  it("revokes the session when the member's role changes (privilege change)", async () => {
    const user = await createTestUser("CP_ADMIN", "role-change");
    const { session } = await openSession(user);
    const builderRole = await db.role.findUniqueOrThrow({ where: { key: "BUILDER_ACCOUNTS" } });
    await db.organisationUser.update({ where: { id: user.membershipId }, data: { roleId: builderRole.id } });
    expect(await validateSession(claimsOf(session))).toBeNull();
    expect(await db.session.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({ revokedReason: "privilege_changed" });
  });

  it("refuses sessions without a second factor for roles that require one once MFA is enforced", async () => {
    const user = await createTestUser("BUILDER_ACCOUNTS", "mfa-rollout");
    const plain = await openSession(user);
    const verified = await openSession(user, { mfaVerified: true });
    vi.stubEnv("MFA_ENFORCED", "false");
    expect(await validateSession(claimsOf(plain.session))).not.toBeNull();
    vi.stubEnv("MFA_ENFORCED", "true");
    expect(await validateSession(claimsOf(plain.session))).toBeNull();
    expect(await validateSession(claimsOf(verified.session))).not.toBeNull();
  });

  it("lets a user list and sign out their other sessions, but not someone else's", async () => {
    const user = await createTestUser("CP_ADMIN", "devices");
    const other = await createTestUser("CP_ADMIN", "stranger");
    const here = await openSession(user);
    const phone = await openSession(user);
    const strangers = await openSession(other);

    const listed = await listActiveSessions(user.userId);
    expect(listed.map((s) => s.id).sort()).toEqual([here.session.id, phone.session.id].sort());

    await expectDomainError(revokeOwnSession(here.actor, here.session.id), "CONFLICT");
    await expectDomainError(revokeOwnSession(here.actor, strangers.session.id), "NOT_FOUND");
    await revokeOwnSession(here.actor, phone.session.id);
    await expectDomainError(revokeOwnSession(here.actor, phone.session.id), "CONFLICT");
    expect(await validateSession(claimsOf(phone.session))).toBeNull();
    expect(await validateSession(claimsOf(here.session))).not.toBeNull();
    expect(await validateSession(claimsOf(strangers.session))).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "session.revoked", entityId: phone.session.id } })).toBe(1);
  });

  it("signs out of all devices, including the current one", async () => {
    const user = await createTestUser("CP_ADMIN", "everywhere");
    const a = await openSession(user);
    const b = await openSession(user);
    expect(await signOutEverywhere(a.actor)).toBe(2);
    expect(await validateSession(claimsOf(a.session))).toBeNull();
    expect(await validateSession(claimsOf(b.session))).toBeNull();
    expect(await db.auditLog.count({ where: { action: "session.revoked_all", entityId: user.userId } })).toBe(1);
  });

  it("revokes every session of a user an administrator deactivates", async () => {
    const admin = await actorFor("admin");
    const user = await createTestUser("CP_ADMIN", "deactivated");
    const { session } = await openSession(user);
    await setUserStatus(admin, user.userId, "INACTIVE");
    expect(await db.session.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({ revokedReason: "user_deactivated" });
    await setUserStatus(admin, user.userId, "ACTIVE");
    // Reactivation does not resurrect old sessions.
    expect(await validateSession(claimsOf(session))).toBeNull();
  });

  it("revokes the sessions of an organisation's members when it is deactivated", async () => {
    const admin = await actorFor("admin");
    const coastal = await actorFor("coastal");
    const { session } = await openSession(coastal);
    await setOrganisationStatus(admin, coastal.orgId, "INACTIVE");
    try {
      expect(await db.session.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({ revokedReason: "organisation_deactivated" });
    } finally {
      await setOrganisationStatus(admin, coastal.orgId, "ACTIVE");
    }
    expect(await validateSession(claimsOf(session))).toBeNull();
  });

  it("purges sessions that ended over 30 days ago", async () => {
    const user = await createTestUser("CP_ADMIN", "purge");
    const old = await openSession(user, { now: new Date("2026-01-01T00:00:00Z") });
    const fresh = await openSession(user);
    await revokeUserSessions(db, user.userId, "signed_out", { exceptSessionId: fresh.session.id });
    expect(await purgeEndedSessions(new Date("2026-03-01T00:00:00Z"))).toBeGreaterThanOrEqual(1);
    expect(await db.session.findUnique({ where: { id: old.session.id } })).toBeNull();
    expect(await db.session.findUnique({ where: { id: fresh.session.id } })).not.toBeNull();
  });
});
