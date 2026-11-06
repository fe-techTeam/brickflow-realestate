import { describe, expect, it } from "vitest";
import { verifyPassword } from "@/server/auth/password";
import { validateSession } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { authenticate } from "@/server/services/auth";
import { changePassword } from "@/server/services/security";
import { expectDomainError, expectValidationError } from "./helpers";
import { createTestUser, openSession, TEST_PASSWORD } from "./security-helpers";

const NEW_PASSWORD = "Monsoon-Copper-Lantern-58";

describe("change password", () => {
  it("changes the password, signs out other sessions and audits it", async () => {
    const user = await createTestUser("CP_ADMIN", "pw-change");
    const current = await openSession(user);
    const other = await openSession(user);

    const result = await changePassword(current.actor, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    expect(result).toEqual({ otherSessionsRevoked: 1 });

    const row = await db.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(await verifyPassword(NEW_PASSWORD, row.passwordHash)).toBe(true);
    expect(row.passwordChangedAt).not.toBeNull();
    expect(await validateSession({ sub: user.userId, mid: user.membershipId, sid: other.session.id })).toBeNull();
    expect(await validateSession({ sub: user.userId, mid: user.membershipId, sid: current.session.id })).not.toBeNull();
    expect((await db.session.findUniqueOrThrow({ where: { id: other.session.id } })).revokedReason).toBe("password_changed");
    expect(await db.auditLog.count({ where: { action: "user.password_changed", entityId: user.userId } })).toBe(1);

    await expect(authenticate({ email: user.email, password: NEW_PASSWORD })).resolves.toMatchObject({ step: "session" });
    await expectDomainError(authenticate({ email: user.email, password: TEST_PASSWORD }), "UNAUTHENTICATED");
  });

  it("requires the correct current password", async () => {
    const user = await createTestUser("CP_ADMIN", "pw-wrong");
    const { actor } = await openSession(user);
    await expectDomainError(changePassword(actor, { currentPassword: "not-it", newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }), "VALIDATION", /incorrect/);
  });

  it("enforces the policy: length, common passwords, confirmation and no reuse", async () => {
    const user = await createTestUser("CP_ADMIN", "pw-policy");
    const { actor } = await openSession(user);
    const attempt = (newPassword: string, confirmPassword = newPassword) => changePassword(actor, { currentPassword: TEST_PASSWORD, newPassword, confirmPassword });

    await expectDomainError(attempt("Short-1"), "VALIDATION", /at least 12/);
    await expectDomainError(attempt("Password@2026"), "VALIDATION", /too common/);
    await expectDomainError(attempt(TEST_PASSWORD), "VALIDATION", /not using now/);
    await expectValidationError(attempt(NEW_PASSWORD, "Monsoon-Copper-Lantern-59"), "confirmPassword");
    const row = await db.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(await verifyPassword(TEST_PASSWORD, row.passwordHash)).toBe(true);
  });

  it("throttles repeated wrong current passwords", async () => {
    const user = await createTestUser("CP_ADMIN", "pw-throttle");
    const { actor } = await openSession(user);
    const wrong = () => changePassword(actor, { currentPassword: "guess", newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    await expectDomainError(wrong(), "VALIDATION");
    await expectDomainError(wrong(), "VALIDATION");
    await expectDomainError(wrong(), "RATE_LIMITED");
  });
});
