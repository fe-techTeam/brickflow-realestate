import "server-only";
import { z } from "zod";
import { recordAudit } from "../audit";
import { mfaRequiredForRole } from "../auth/config";
import { hashPassword, verifyPassword } from "../auth/password";
import { passwordPolicyViolations, PASSWORD_MIN_LENGTH } from "../auth/password-policy";
import { listActiveSessions, revokeSession, revokeUserSessions } from "../auth/sessions";
import type { Actor } from "../auth/session";
import { isStepUpPurpose, STEP_UP_PURPOSE_LABELS, type StepUpPurpose } from "../auth/step-up";
import { reserveAttempt, THROTTLE_POLICIES, throttleKeys } from "../auth/throttle";
import { db } from "../db";
import { conflict, invalid, notFound, unauthenticated } from "../errors";
import { recordLockout, verifySecondFactor } from "./mfa";

export async function getSecurityOverview(actor: Actor, now: Date = new Date()) {
  const [user, recoveryCodesLeft, sessions] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { mfaEnabledAt: true, mfaPendingSecret: true, passwordChangedAt: true, createdAt: true, lastLoginAt: true } }),
    db.authRecoveryCode.count({ where: { userId: actor.userId, usedAt: null } }),
    listActiveSessions(actor.userId, now),
  ]);
  return {
    mfa: {
      enabled: Boolean(user.mfaEnabledAt),
      enabledAt: user.mfaEnabledAt,
      required: mfaRequiredForRole(actor.role),
      recoveryCodesLeft,
    },
    passwordChangedAt: user.passwordChangedAt ?? user.createdAt,
    lastLoginAt: user.lastLoginAt,
    sessions: sessions.map((s) => ({ ...s, current: s.id === actor.sessionId })),
  };
}

export type SecurityOverview = Awaited<ReturnType<typeof getSecurityOverview>>;

/** Verifies the user's own password with per-user throttling (used where no authenticator is set up). */
async function checkOwnPassword(actor: Actor, password: string, now: Date, field: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { passwordHash: true } });
  if (!user) throw unauthenticated();
  const reservation = await reserveAttempt([{ key: throttleKeys.password(actor.userId), policy: THROTTLE_POLICIES.account }], now);
  if (await verifyPassword(password, user.passwordHash)) {
    await reservation.succeeded();
    return;
  }
  const locked = await reservation.failed();
  if (locked.length) await db.$transaction((tx) => recordLockout(tx, locked, { userId: actor.userId, label: actor.email }));
  throw invalid("The password is incorrect.", { [field]: ["The password is incorrect"] });
}

const stepUpSchema = z.object({ code: z.string().trim().min(1, "Enter the code").max(200) });

/**
 * Records a fresh verification on the current session so `requireStepUp` passes for the next few
 * minutes. Uses the authenticator when two-step verification is on, otherwise the account password.
 */
export async function confirmStepUp(actor: Actor, purpose: StepUpPurpose, raw: { code: string }, now: Date = new Date()): Promise<void> {
  if (!isStepUpPurpose(purpose)) throw invalid("Unknown confirmation request.");
  const { code } = stepUpSchema.parse(raw);
  const sessionId = actor.sessionId;
  if (!sessionId) throw unauthenticated();
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { mfaEnabledAt: true } });
  if (!user) throw unauthenticated();

  let method: "totp" | "password";
  if (user.mfaEnabledAt) {
    await verifySecondFactor(actor.userId, code, { allowRecoveryCode: false, now });
    method = "totp";
  } else {
    await checkOwnPassword(actor, code, now, "code");
    method = "password";
  }

  await db.$transaction(async (tx) => {
    const marked = await tx.session.updateMany({ where: { id: sessionId, userId: actor.userId, revokedAt: null }, data: { stepUpAt: now } });
    if (marked.count !== 1) throw unauthenticated();
    await recordAudit(tx, actor, {
      action: "security.step_up",
      entityType: "Session",
      entityId: sessionId,
      summary: `${actor.name} confirmed their identity to ${STEP_UP_PURPOSE_LABELS[purpose]}`,
      metadata: { purpose, method },
    });
  });
}

export async function revokeOwnSession(actor: Actor, rawSessionId: string): Promise<void> {
  const sessionId = z.string().min(1).max(100).parse(rawSessionId);
  if (sessionId === actor.sessionId) throw conflict("Use Sign out to end the session you are using now.");
  await db.$transaction(async (tx) => {
    const session = await tx.session.findUnique({ where: { id: sessionId }, select: { userId: true } });
    if (!session || session.userId !== actor.userId) throw notFound("Session not found.");
    if (!(await revokeSession(tx, sessionId, "revoked_by_user"))) throw conflict("This session has already ended.");
    await recordAudit(tx, actor, { action: "session.revoked", entityType: "Session", entityId: sessionId, summary: `${actor.name} signed out another session` });
  });
}

export async function signOutEverywhere(actor: Actor): Promise<number> {
  return db.$transaction(async (tx) => {
    const count = await revokeUserSessions(tx, actor.userId, "signed_out_everywhere");
    await recordAudit(tx, actor, {
      action: "session.revoked_all",
      entityType: "User",
      entityId: actor.userId,
      summary: `${actor.name} signed out of all devices`,
      metadata: { sessions: count },
    });
    return count;
  });
}

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(200),
    newPassword: z.string().min(1, "Enter a new password").max(200),
    confirmPassword: z.string().max(200),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "The passwords do not match" });

export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

/** Changes the password and signs out every other session; the caller rotates the current one. */
export async function changePassword(actor: Actor, raw: ChangePasswordInput, now: Date = new Date()): Promise<{ otherSessionsRevoked: number }> {
  const input = changePasswordSchema.parse(raw);
  await checkOwnPassword(actor, input.currentPassword, now, "currentPassword");

  const problems = passwordPolicyViolations(input.newPassword, { email: actor.email, name: actor.name });
  if (problems.length) throw invalid(problems[0]!, { newPassword: problems });
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { passwordHash: true } });
  if (await verifyPassword(input.newPassword, user.passwordHash)) {
    throw invalid("Choose a password you are not using now.", { newPassword: ["Choose a password you are not using now"] });
  }

  const passwordHash = await hashPassword(input.newPassword);
  return db.$transaction(async (tx) => {
    // Guards against a concurrent change: only the hash we verified against may be replaced.
    const updated = await tx.user.updateMany({ where: { id: actor.userId, passwordHash: user.passwordHash }, data: { passwordHash, passwordChangedAt: now } });
    if (updated.count !== 1) throw conflict("Your password was changed in another window. Sign in again.");
    const otherSessionsRevoked = await revokeUserSessions(tx, actor.userId, "password_changed", { exceptSessionId: actor.sessionId, now });
    await recordAudit(tx, actor, {
      action: "user.password_changed",
      entityType: "User",
      entityId: actor.userId,
      summary: `${actor.name} changed their password`,
      metadata: { otherSessionsRevoked },
    });
    return { otherSessionsRevoked };
  });
}

export { PASSWORD_MIN_LENGTH };
