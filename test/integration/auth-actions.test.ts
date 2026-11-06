import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { totpCode } from "@/server/auth/totp";
import { MFA_PENDING_COOKIE, verifySessionToken } from "@/server/auth/token";
import { db } from "@/server/db";
import { cookieJar, redirectTarget } from "./request-context";
import { createTestUser, enrolMfa, openSession, SESSION_COOKIE, TEST_PASSWORD } from "./security-helpers";

vi.mock("next/headers", async () => (await import("./request-context")).nextHeaders);
vi.mock("next/cache", async () => (await import("./request-context")).nextCache);

const auth = await import("@/server/actions/auth");
const security = await import("@/server/actions/security");
const { getActor } = await import("@/server/auth/session");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

beforeEach(() => cookieJar.clear());
afterEach(() => vi.unstubAllEnvs());

describe("sign-in actions", () => {
  it("opens a server-side session with the client IP and user agent", async () => {
    const user = await createTestUser("CP_ADMIN", "action-login");
    expect(await redirectTarget(() => auth.loginAction({}, form({ email: user.email, password: TEST_PASSWORD })))).toBe("/partner");
    const claims = await verifySessionToken(cookieJar.get(SESSION_COOKIE));
    const session = await db.session.findUniqueOrThrow({ where: { id: claims!.sid } });
    expect(session).toMatchObject({ userId: user.userId, ip: "203.0.113.10", mfaVerifiedAt: null });
    expect(session.userAgent).toContain("Chrome");
    expect((await getActor())?.sessionId).toBe(session.id);
  });

  it("returns the generic message on a wrong password and sets no cookie", async () => {
    const user = await createTestUser("CP_ADMIN", "action-wrong");
    expect(await auth.loginAction({}, form({ email: user.email, password: "nope" }))).toEqual({ error: "The email or password is incorrect.", email: user.email });
    expect(cookieJar.size).toBe(0);
  });

  it("routes an enrolled user through the code challenge before any session exists", async () => {
    const user = await createTestUser("CP_ADMIN", "action-mfa");
    const { secret } = await enrolMfa(user, new Date(Date.now() - 120_000));
    expect(await redirectTarget(() => auth.loginAction({}, form({ email: user.email, password: TEST_PASSWORD })))).toBe("/login/verify");
    expect(cookieJar.has(MFA_PENDING_COOKIE)).toBe(true);
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
    expect(await getActor()).toBeNull();

    // The pending cookie is not a session token.
    cookieJar.set(SESSION_COOKIE, cookieJar.get(MFA_PENDING_COOKIE)!);
    expect(await getActor()).toBeNull();
    cookieJar.delete(SESSION_COOKIE);

    expect(await auth.verifyMfaLoginAction({}, form({ code: "000000" }))).toMatchObject({ error: expect.stringMatching(/not valid/) });
    expect(await redirectTarget(() => auth.verifyMfaLoginAction({}, form({ code: totpCode(secret) })))).toBe("/partner");
    expect(cookieJar.has(MFA_PENDING_COOKIE)).toBe(false);
    const session = await db.session.findUniqueOrThrow({ where: { id: (await verifySessionToken(cookieJar.get(SESSION_COOKIE)))!.sid } });
    expect(session.mfaVerifiedAt).not.toBeNull();
  });

  it("rejects the code step without a pending sign-in", async () => {
    expect(await auth.verifyMfaLoginAction({}, form({ code: "123456" }))).toMatchObject({ error: expect.stringMatching(/expired/) });
    expect(await auth.confirmLoginEnrolmentAction({ code: "123456" })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("makes privileged roles enrol at first sign-in when MFA is enforced", async () => {
    vi.stubEnv("MFA_ENFORCED", "true");
    const user = await createTestUser("SUPER_ADMIN", "action-enrol");
    expect(await redirectTarget(() => auth.loginAction({}, form({ email: user.email, password: TEST_PASSWORD })))).toBe("/login/verify");
    const { startLoginEnrolment } = await import("@/server/services/auth");
    const { pendingMfaClaims } = await import("@/server/auth/session");
    const { manualKey } = await startLoginEnrolment((await pendingMfaClaims())!);
    const result = await auth.confirmLoginEnrolmentAction({ code: totpCode(manualKey.replace(/\s/g, "")) });
    expect(result).toMatchObject({ ok: true, data: { destination: "/admin" } });
    expect((await getActor())?.role).toBe("SUPER_ADMIN");
  });

  it("revokes the session row on sign-out", async () => {
    const user = await createTestUser("CP_ADMIN", "action-logout");
    const { token, session } = await openSession(user);
    cookieJar.set(SESSION_COOKIE, token);
    expect(await redirectTarget(() => auth.logoutAction())).toBe("/login");
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
    expect(await db.session.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({ revokedReason: "signed_out" });
    // A copy of the old cookie no longer works.
    cookieJar.set(SESSION_COOKIE, token);
    expect(await getActor()).toBeNull();
  });
});

describe("security page actions", () => {
  it("rotates the session id after a password change and keeps the absolute expiry", async () => {
    const user = await createTestUser("CP_ADMIN", "action-rotate");
    const { token, session } = await openSession(user);
    cookieJar.set(SESSION_COOKIE, token);
    const next = "Juniper-Anchor-Mosaic-27";
    expect(await security.changePasswordAction({ currentPassword: TEST_PASSWORD, newPassword: next, confirmPassword: next })).toMatchObject({ ok: true });
    const newSid = (await verifySessionToken(cookieJar.get(SESSION_COOKIE)))!.sid;
    expect(newSid).not.toBe(session.id);
    expect((await db.session.findUniqueOrThrow({ where: { id: newSid } })).expiresAt).toEqual(session.expiresAt);
    expect((await getActor())?.sessionId).toBe(newSid);
    cookieJar.set(SESSION_COOKIE, token);
    expect(await getActor()).toBeNull();
  });

  it("enrols from the security page, marking and rotating the current session", async () => {
    const user = await createTestUser("CP_ADMIN", "action-enrol-page");
    const { token, session } = await openSession(user);
    cookieJar.set(SESSION_COOKIE, token);
    const begun = await security.beginMfaEnrolmentAction();
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(begun.data.qr.size).toBeGreaterThanOrEqual(21);
    expect(begun.data.qr.path).toMatch(/^M\d+ \d+h1v1h-1z/);
    const confirmed = await security.confirmMfaEnrolmentAction({ code: totpCode(begun.data.manualKey.replace(/\s/g, "")) });
    expect(confirmed).toMatchObject({ ok: true });
    const current = await db.session.findUniqueOrThrow({ where: { id: (await verifySessionToken(cookieJar.get(SESSION_COOKIE)))!.sid } });
    expect(current.id).not.toBe(session.id);
    expect(current.mfaVerifiedAt).not.toBeNull();
  });

  it("asks for step-up before regenerating recovery codes, then succeeds after confirmation", async () => {
    const user = await createTestUser("CP_ADMIN", "action-stepup");
    const { secret } = await enrolMfa(user, new Date(Date.now() - 120_000));
    const { token } = await openSession(user, { mfaVerified: true });
    cookieJar.set(SESSION_COOKIE, token);
    expect(await security.regenerateRecoveryCodesAction()).toMatchObject({ ok: false, code: "STEP_UP_REQUIRED", error: /generate new recovery codes/ });
    expect(await security.stepUpMethodAction()).toEqual({ ok: true, data: { method: "totp" }, message: undefined });
    expect(await security.confirmStepUpAction("mfa.recovery_codes", { code: totpCode(secret) })).toMatchObject({ ok: true });
    const result = await security.regenerateRecoveryCodesAction();
    expect(result.ok && result.data.recoveryCodes).toHaveLength(10);
    expect(await security.confirmStepUpAction("not-a-purpose" as never, { code: "1" })).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("signs out of all devices and lands on the login page", async () => {
    const user = await createTestUser("CP_ADMIN", "action-everywhere");
    const a = await openSession(user);
    const b = await openSession(user);
    cookieJar.set(SESSION_COOKIE, a.token);
    expect(await redirectTarget(() => security.signOutEverywhereAction())).toBe("/login");
    expect(await db.session.count({ where: { id: { in: [a.session.id, b.session.id] }, revokedAt: null } })).toBe(0);
  });
});
