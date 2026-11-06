import { afterEach, describe, expect, it, vi } from "vitest";
import { hashRecoveryCode } from "@/server/auth/recovery-codes";
import { validateSession } from "@/server/auth/sessions";
import { requireStepUp, STEP_UP_PURPOSES, StepUpRequiredError } from "@/server/auth/step-up";
import { totpCode, totpStep } from "@/server/auth/totp";
import { decryptField } from "@/server/crypto/field-encryption";
import { db } from "@/server/db";
import { authenticate, completeLoginEnrolment, completeMfaLogin, startLoginEnrolment } from "@/server/services/auth";
import { beginEnrolment, confirmEnrolment, disableMfa, regenerateRecoveryCodes, resetUserMfa, verifySecondFactor } from "@/server/services/mfa";
import { confirmStepUp, getSecurityOverview } from "@/server/services/security";
import { actorFor, expectDomainError } from "./helpers";
import { createTestUser, enrolMfa, later, openSession, TEST_PASSWORD } from "./security-helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("TOTP enrolment", () => {
  it("stores the secret encrypted and bound to the user, and shows it as an otpauth URI and key", async () => {
    const user = await createTestUser("CP_ADMIN", "enrol");
    const first = await beginEnrolment(user.userId);
    expect(first.otpauthUri).toMatch(/^otpauth:\/\/totp\/BrickFlow:.+\?secret=[A-Z2-7]{32}&issuer=BrickFlow/);
    expect(first.manualKey).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
    const secret = first.manualKey.replace(/\s/g, "");

    const row = await db.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(row.mfaPendingSecret).toMatch(/^enc:v1:/);
    expect(row.mfaPendingSecret).not.toContain(secret);
    expect(row.mfaEnabledAt).toBeNull();
    // Reloading the set-up page shows the same key until it is confirmed.
    expect((await beginEnrolment(user.userId)).manualKey).toBe(first.manualKey);
    expect((await beginEnrolment(user.userId, { regenerate: true })).manualKey).not.toBe(first.manualKey);
  });

  it("requires a valid current code, then enables MFA with ten hashed recovery codes", async () => {
    const user = await createTestUser("CP_ADMIN", "confirm");
    const now = new Date();
    const { manualKey } = await beginEnrolment(user.userId);
    const secret = manualKey.replace(/\s/g, "");

    await expectDomainError(confirmEnrolment(user.userId, "000000", user, now), "VALIDATION", /not valid/);
    const codes = await confirmEnrolment(user.userId, totpCode(secret, now), user, now);
    expect(codes).toHaveLength(10);

    const row = await db.user.findUniqueOrThrow({ where: { id: user.userId }, include: { recoveryCodes: true } });
    expect(row.mfaEnabledAt).toEqual(now);
    expect(row.mfaPendingSecret).toBeNull();
    expect(row.mfaLastUsedStep).toBe(totpStep(now));
    expect(decryptField(row.mfaSecret!, `user:${user.userId}:totp`)).toBe(secret);
    expect(() => decryptField(row.mfaSecret!, `user:${user.userId}:totp-pending`)).toThrow();
    expect(row.recoveryCodes.map((c) => c.codeHash).sort()).toEqual(codes.map(hashRecoveryCode).sort());
    for (const code of codes) expect(row.recoveryCodes.some((c) => c.codeHash.includes(code.replace(/-/g, "")))).toBe(false);
    expect(await db.auditLog.count({ where: { action: "mfa.enabled", entityId: user.userId } })).toBe(1);

    await expectDomainError(beginEnrolment(user.userId), "CONFLICT", /already enabled/);
    await expectDomainError(confirmEnrolment(user.userId, totpCode(secret, later(now)), user), "CONFLICT");
  });
});

describe("second-factor verification", () => {
  it("accepts a fresh code, tolerates ±1 step of drift and rejects replays", async () => {
    const user = await createTestUser("CP_ADMIN", "verify");
    const t0 = new Date("2026-11-06T10:00:05Z");
    const { secret } = await enrolMfa(user, t0);

    // The enrolment code's step is already used.
    await expectDomainError(verifySecondFactor(user.userId, totpCode(secret, t0), { allowRecoveryCode: false, now: t0 }), "VALIDATION");

    const t1 = later(t0, 2);
    await expect(verifySecondFactor(user.userId, totpCode(secret, later(t1, 1)), { allowRecoveryCode: false, now: t1 })).resolves.toBe("totp");
    // Same code again, and an older (but within drift) code: both replays now.
    await expectDomainError(verifySecondFactor(user.userId, totpCode(secret, later(t1, 1)), { allowRecoveryCode: false, now: t1 }), "VALIDATION");
    await expectDomainError(verifySecondFactor(user.userId, totpCode(secret, t1), { allowRecoveryCode: false, now: t1 }), "VALIDATION");

    const t2 = later(t1, 4);
    await expect(verifySecondFactor(user.userId, totpCode(secret, later(t2, -1)), { allowRecoveryCode: false, now: t2 })).resolves.toBe("totp");
    await expectDomainError(verifySecondFactor(user.userId, totpCode(secret, later(t2, 2)), { allowRecoveryCode: false, now: t2 }), "VALIDATION");
  });

  it("lets only one of two concurrent requests use the same code", async () => {
    const user = await createTestUser("CP_ADMIN", "race");
    const t0 = new Date("2026-11-06T10:00:05Z");
    const { secret } = await enrolMfa(user, t0);
    const t1 = later(t0, 3);
    const code = totpCode(secret, t1);
    const results = await Promise.allSettled([
      verifySecondFactor(user.userId, code, { allowRecoveryCode: false, now: t1 }),
      verifySecondFactor(user.userId, code, { allowRecoveryCode: false, now: t1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("accepts each recovery code once, only where allowed, and audits its use", async () => {
    const user = await createTestUser("CP_ADMIN", "recovery");
    const { recoveryCodes } = await enrolMfa(user);
    const [code] = recoveryCodes;
    await expectDomainError(verifySecondFactor(user.userId, code!, { allowRecoveryCode: false }), "VALIDATION");
    await expect(verifySecondFactor(user.userId, code!.toLowerCase(), { allowRecoveryCode: true })).resolves.toBe("recovery");
    await expectDomainError(verifySecondFactor(user.userId, code!, { allowRecoveryCode: true }), "VALIDATION");
    expect(await db.authRecoveryCode.count({ where: { userId: user.userId, usedAt: null } })).toBe(9);
    expect(await db.auditLog.count({ where: { action: "mfa.recovery_code_used", entityId: user.userId } })).toBe(1);
  });

  it("locks the second factor after five wrong codes and audits it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const user = await createTestUser("CP_ADMIN", "otp-lock");
    const t0 = new Date("2026-11-06T11:00:05Z");
    vi.setSystemTime(t0);
    const { secret } = await enrolMfa(user, t0);
    const offsets = [0, 0, 1_000, 3_000, 7_000];
    for (const offset of offsets) {
      const now = new Date(t0.getTime() + offset);
      vi.setSystemTime(now);
      await expectDomainError(verifySecondFactor(user.userId, "000000", { allowRecoveryCode: true, now }), "VALIDATION");
    }
    const now = new Date(t0.getTime() + 60_000);
    vi.setSystemTime(now);
    await expectDomainError(verifySecondFactor(user.userId, totpCode(secret, now), { allowRecoveryCode: true, now }), "RATE_LIMITED", /15 minutes/);
    expect(await db.auditLog.count({ where: { action: "security.lockout", entityId: user.userId } })).toBe(1);
  });
});

describe("sign-in with two-step verification", () => {
  it("signs in directly when MFA is neither enabled nor required", async () => {
    vi.stubEnv("MFA_ENFORCED", "false");
    const builder = await createTestUser("BUILDER_ACCOUNTS", "optional");
    expect(await authenticate({ email: builder.email, password: TEST_PASSWORD })).toMatchObject({ step: "session" });
  });

  it("requires enrolment for builder, finance and admin roles when MFA is enforced, but not for partners", async () => {
    vi.stubEnv("MFA_ENFORCED", "true");
    for (const role of ["BUILDER_ACCOUNTS", "FINANCE_OPS", "SUPER_ADMIN"] as const) {
      const user = await createTestUser(role, `mandatory-${role.toLowerCase()}`);
      const result = await authenticate({ email: user.email, password: TEST_PASSWORD });
      expect(result.step).toBe("mfa_enrol");
      expect((await db.user.findUniqueOrThrow({ where: { id: user.userId } })).lastLoginAt).toBeNull();
    }
    const partner = await createTestUser("CP_ADMIN", "partner-optional");
    expect(await authenticate({ email: partner.email, password: TEST_PASSWORD })).toMatchObject({ step: "session" });
  });

  it("completes first-time enrolment at sign-in and records the login", async () => {
    vi.stubEnv("MFA_ENFORCED", "true");
    const user = await createTestUser("FINANCE_OPS", "first-login");
    const result = await authenticate({ email: user.email, password: TEST_PASSWORD });
    const claims = { sub: result.userId, mid: result.membershipId, purpose: "enrol" as const };

    await expectDomainError(completeMfaLogin({ ...claims, purpose: "enrol" } as never, "123456"), "UNAUTHENTICATED");
    const { manualKey, email } = await startLoginEnrolment(claims);
    expect(email).toBe(user.email);
    const done = await completeLoginEnrolment(claims, totpCode(manualKey.replace(/\s/g, "")));
    expect(done.recoveryCodes).toHaveLength(10);
    expect(done.orgType).toBe("FINANCIER");
    const row = await db.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(row.mfaEnabledAt).not.toBeNull();
    expect(row.lastLoginAt).not.toBeNull();
    expect(await db.auditLog.findFirst({ where: { action: "session.login", entityId: user.userId } })).toMatchObject({ metadata: expect.stringContaining('"mfa":"enrolled"') });
  });

  it("challenges enrolled users (partners who opted in too) and accepts a code or a recovery code", async () => {
    vi.stubEnv("MFA_ENFORCED", "false");
    const partner = await createTestUser("CP_ADMIN", "opted-in");
    const t0 = new Date(Date.now() - 120_000);
    const { secret, recoveryCodes } = await enrolMfa(partner, t0);

    const first = await authenticate({ email: partner.email, password: TEST_PASSWORD });
    expect(first.step).toBe("mfa_challenge");
    const claims = { sub: first.userId, mid: first.membershipId, purpose: "challenge" as const };
    await expectDomainError(completeMfaLogin(claims, "000000"), "VALIDATION");
    await expect(completeMfaLogin(claims, totpCode(secret))).resolves.toMatchObject({ orgType: "CHANNEL_PARTNER" });
    await expect(completeMfaLogin(claims, recoveryCodes[3]!)).resolves.toMatchObject({ userId: partner.userId });
    await expectDomainError(completeMfaLogin(claims, recoveryCodes[3]!), "VALIDATION");
  });

  it("re-checks the account when the second step completes", async () => {
    const partner = await createTestUser("CP_ADMIN", "pending-deactivated");
    const { secret } = await enrolMfa(partner, new Date(Date.now() - 120_000));
    const first = await authenticate({ email: partner.email, password: TEST_PASSWORD });
    await db.user.update({ where: { id: partner.userId }, data: { status: "INACTIVE" } });
    await expectDomainError(completeMfaLogin({ sub: first.userId, mid: first.membershipId, purpose: "challenge" }, totpCode(secret)), "FORBIDDEN");
    await db.user.update({ where: { id: partner.userId }, data: { status: "ACTIVE" } });
    await expectDomainError(completeMfaLogin({ sub: first.userId, mid: "another-membership", purpose: "challenge" }, totpCode(secret)), "UNAUTHENTICATED");
  });
});

describe("step-up confirmation", () => {
  it("exposes the sensitive purposes", () => {
    expect(STEP_UP_PURPOSES).toEqual(expect.arrayContaining(["offer.accept", "bank.change", "invoice.approve", "payout.release"]));
  });

  it("requires a fresh authenticator code in the current session, valid for five minutes", async () => {
    const user = await createTestUser("FINANCE_OPS", "stepup");
    const t0 = new Date(Date.now() - 10 * 60_000);
    const { secret } = await enrolMfa(user, t0);
    const { actor } = await openSession(user, { mfaVerified: true });

    await expect(requireStepUp(actor, "payout.release")).rejects.toBeInstanceOf(StepUpRequiredError);
    await expect(requireStepUp(actor, "payout.release")).rejects.toMatchObject({ code: "STEP_UP_REQUIRED", message: /release this payout/ });
    await expect(requireStepUp({ ...actor, sessionId: undefined }, "payout.release")).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });

    const now = new Date();
    await expectDomainError(confirmStepUp(actor, "payout.release", { code: "111111" }, now), "VALIDATION");
    await confirmStepUp(actor, "payout.release", { code: totpCode(secret, now) }, now);
    await expect(requireStepUp(actor, "payout.release", now)).resolves.toBeUndefined();
    await expect(requireStepUp(actor, "invoice.approve", new Date(now.getTime() + 5 * 60_000))).resolves.toBeUndefined();
    await expect(requireStepUp(actor, "invoice.approve", new Date(now.getTime() + 5 * 60_000 + 1))).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });

    // Recovery codes are for sign-in only; step-up needs the authenticator.
    const codes = await db.authRecoveryCode.count({ where: { userId: user.userId } });
    expect(codes).toBe(10);
    expect(await db.auditLog.findFirst({ where: { action: "security.step_up", entityId: actor.sessionId! } })).toMatchObject({ metadata: expect.stringContaining('"method":"totp"') });
  });

  it("is bound to the session: another session of the same user must confirm separately", async () => {
    const user = await createTestUser("FINANCE_OPS", "stepup-session");
    const { secret } = await enrolMfa(user, new Date(Date.now() - 120_000));
    const laptop = await openSession(user, { mfaVerified: true });
    const phone = await openSession(user, { mfaVerified: true });
    await confirmStepUp(laptop.actor, "offer.accept", { code: totpCode(secret) });
    await expect(requireStepUp(laptop.actor, "offer.accept")).resolves.toBeUndefined();
    await expect(requireStepUp(phone.actor, "offer.accept")).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
    await db.session.update({ where: { id: laptop.session.id }, data: { revokedAt: new Date() } });
    await expect(requireStepUp(laptop.actor, "offer.accept")).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
  });

  it("uses the account password for users without two-step verification", async () => {
    const partner = await createTestUser("CP_ADMIN", "stepup-password");
    const { actor } = await openSession(partner);
    await expectDomainError(confirmStepUp(actor, "offer.accept", { code: "wrong password" }), "VALIDATION", /password is incorrect/);
    await confirmStepUp(actor, "offer.accept", { code: TEST_PASSWORD });
    await expect(requireStepUp(actor, "offer.accept")).resolves.toBeUndefined();
  });

  it("rejects unknown purposes", async () => {
    const partner = await createTestUser("CP_ADMIN", "stepup-unknown");
    const { actor } = await openSession(partner);
    await expectDomainError(confirmStepUp(actor, "everything" as never, { code: TEST_PASSWORD }), "VALIDATION");
    await expect(requireStepUp(actor, "everything" as never)).rejects.toThrow(/Unknown step-up purpose/);
  });
});

describe("managing two-step verification", () => {
  it("regenerates recovery codes only after step-up, invalidating the old set", async () => {
    const user = await createTestUser("CP_ADMIN", "regen");
    const { secret, recoveryCodes } = await enrolMfa(user, new Date(Date.now() - 120_000));
    const { actor } = await openSession(user, { mfaVerified: true });
    await expectDomainError(regenerateRecoveryCodes(actor), "STEP_UP_REQUIRED");
    await confirmStepUp(actor, "mfa.recovery_codes", { code: totpCode(secret) });
    const fresh = await regenerateRecoveryCodes(actor);
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(recoveryCodes[0]);
    await expectDomainError(verifySecondFactor(user.userId, recoveryCodes[0]!, { allowRecoveryCode: true }), "VALIDATION");
    expect((await getSecurityOverview(actor)).mfa).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
  });

  it("turns MFA off only after step-up, and never for roles that require it", async () => {
    vi.stubEnv("MFA_ENFORCED", "true");
    const partner = await createTestUser("CP_ADMIN", "disable");
    const { secret } = await enrolMfa(partner, new Date(Date.now() - 120_000));
    const { actor } = await openSession(partner, { mfaVerified: true });
    await expectDomainError(disableMfa(actor), "STEP_UP_REQUIRED");
    await confirmStepUp(actor, "mfa.disable", { code: totpCode(secret) });
    await disableMfa(actor);
    const row = await db.user.findUniqueOrThrow({ where: { id: partner.userId } });
    expect(row).toMatchObject({ mfaSecret: null, mfaEnabledAt: null, mfaLastUsedStep: null });
    expect(await db.authRecoveryCode.count({ where: { userId: partner.userId } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "mfa.disabled", entityId: partner.userId } })).toBe(1);

    const builder = await createTestUser("BUILDER_ACCOUNTS", "cannot-disable");
    const enrolled = await enrolMfa(builder, new Date(Date.now() - 120_000));
    const builderSession = await openSession(builder, { mfaVerified: true });
    await confirmStepUp(builderSession.actor, "mfa.disable", { code: totpCode(enrolled.secret) });
    await expectDomainError(disableMfa(builderSession.actor), "CONFLICT", /mandatory/);
  });

  it("lets a super admin reset another user's MFA, signing them out everywhere", async () => {
    const admin = await actorFor("admin");
    const user = await createTestUser("BUILDER_ACCOUNTS", "reset");
    await enrolMfa(user);
    const { session } = await openSession(user, { mfaVerified: true });

    await expectDomainError(resetUserMfa(await actorFor("finance"), user.userId), "FORBIDDEN");
    await expectDomainError(resetUserMfa(admin, admin.userId), "FORBIDDEN");
    await resetUserMfa(admin, user.userId);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(row.mfaEnabledAt).toBeNull();
    expect(await db.authRecoveryCode.count({ where: { userId: user.userId } })).toBe(0);
    expect(await validateSession({ sub: user.userId, mid: user.membershipId, sid: session.id })).toBeNull();
    expect(await db.auditLog.count({ where: { action: "mfa.reset", entityId: user.userId } })).toBe(1);
    await expectDomainError(resetUserMfa(admin, user.userId), "CONFLICT");
  });
});
