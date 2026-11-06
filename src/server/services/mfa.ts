import "server-only";
import { recordAudit } from "../audit";
import { mfaRequiredForRole } from "../auth/config";
import { authorize } from "../auth/permissions";
import { generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode } from "../auth/recovery-codes";
import { revokeUserSessions } from "../auth/sessions";
import type { Actor } from "../auth/session";
import { requireStepUp } from "../auth/step-up";
import { reserveAttempt, THROTTLE_POLICIES, throttleKeys } from "../auth/throttle";
import { formatSecretForDisplay, generateTotpSecret, otpauthUri, verifyTotp } from "../auth/totp";
import { decryptField, ENCRYPTION_CONTEXT, encryptField, needsReencryption } from "../crypto/field-encryption";
import { db, type Tx } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";

const INVALID_CODE = "That code is not valid. Check it and try again.";

const activeContext = ENCRYPTION_CONTEXT.totpSecret;
const pendingContext = ENCRYPTION_CONTEXT.totpPendingSecret;

export interface EnrolmentSecret {
  /** Base32 key for manual entry, grouped for readability. */
  manualKey: string;
  otpauthUri: string;
}

/** Audit actor for events before a session exists (sign-in) or about another user (admin reset). */
export type AuditActor = Parameters<typeof recordAudit>[1];

export async function recordLockout(tx: Tx, keys: string[], subject: { userId?: string; label: string }): Promise<void> {
  for (const key of keys) {
    const scope = key.startsWith("login:ip:") ? "client address" : "account";
    await recordAudit(tx, null, {
      action: "security.lockout",
      entityType: subject.userId && scope === "account" ? "User" : "Session",
      entityId: subject.userId && scope === "account" ? subject.userId : key,
      summary: `Temporarily locked ${scope === "account" ? `sign-in for ${subject.label}` : `sign-in attempts from ${key.slice("login:ip:".length)}`} after repeated failures`,
      metadata: { key, scope },
    });
  }
}

/**
 * Checks a one-time code for a user with two-step verification enabled: a TOTP code (replays are
 * rejected) or, when allowed, an unused recovery code. Throttled per user across every caller.
 */
export async function verifySecondFactor(
  userId: string,
  code: string,
  options: { allowRecoveryCode: boolean; now?: Date },
): Promise<"totp" | "recovery"> {
  const now = options.now ?? new Date();
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, mfaSecret: true, mfaEnabledAt: true, mfaLastUsedStep: true } });
  if (!user?.mfaSecret || !user.mfaEnabledAt) throw conflict("Two-step verification is not set up for this account.");

  const reservation = await reserveAttempt([{ key: throttleKeys.otp(user.id), policy: THROTTLE_POLICIES.account }], now);
  let method: "totp" | "recovery" | null = null;
  if (options.allowRecoveryCode && looksLikeRecoveryCode(code)) {
    const used = await db.authRecoveryCode.updateMany({ where: { userId: user.id, codeHash: hashRecoveryCode(code), usedAt: null }, data: { usedAt: now } });
    if (used.count === 1) method = "recovery";
  } else {
    const secret = decryptField(user.mfaSecret, activeContext(user.id));
    const step = verifyTotp(secret, code, { at: now, lastUsedStep: user.mfaLastUsedStep });
    if (step !== null) {
      // Conditional write: of two concurrent requests with the same code, only one can advance the step.
      // A secret stored in an older format or under a rotated key is re-encrypted on the way.
      const advanced = await db.user.updateMany({
        where: { id: user.id, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
        data: { mfaLastUsedStep: step, ...(needsReencryption(user.mfaSecret) ? { mfaSecret: encryptField(secret, activeContext(user.id)) } : {}) },
      });
      if (advanced.count === 1) method = "totp";
    }
  }

  if (method) {
    await reservation.succeeded();
    if (method === "recovery") {
      await db.$transaction(async (tx) =>
        recordAudit(tx, null, { action: "mfa.recovery_code_used", entityType: "User", entityId: user.id, summary: `Recovery code used by ${user.email}` }),
      );
    }
    return method;
  }
  const locked = await reservation.failed();
  if (locked.length) await db.$transaction((tx) => recordLockout(tx, locked, { userId: user.id, label: user.email }));
  throw invalid(INVALID_CODE, { code: [INVALID_CODE] });
}

/** Creates (or returns the existing) pending authenticator secret for enrolment. */
export async function beginEnrolment(userId: string, options: { regenerate?: boolean } = {}): Promise<EnrolmentSecret> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, mfaEnabledAt: true, mfaPendingSecret: true } });
  if (!user) throw notFound("Account not found.");
  if (user.mfaEnabledAt) throw conflict("Two-step verification is already enabled.");
  let secret = !options.regenerate && user.mfaPendingSecret ? decryptField(user.mfaPendingSecret, pendingContext(user.id)) : null;
  if (!secret) {
    secret = generateTotpSecret();
    await db.user.update({ where: { id: user.id }, data: { mfaPendingSecret: encryptField(secret, pendingContext(user.id)) } });
  }
  return { manualKey: formatSecretForDisplay(secret), otpauthUri: otpauthUri(secret, user.email) };
}

async function replaceRecoveryCodes(tx: Tx, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await tx.authRecoveryCode.deleteMany({ where: { userId } });
  await tx.authRecoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })) });
  return codes;
}

/**
 * Activates the pending secret once the user proves possession with a current code. Returns the new
 * recovery codes in plain text; this is the only time they are ever available.
 */
export async function confirmEnrolment(userId: string, code: string, auditActor: AuditActor, now: Date = new Date()): Promise<string[]> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, mfaEnabledAt: true, mfaPendingSecret: true } });
  if (!user) throw notFound("Account not found.");
  if (user.mfaEnabledAt) throw conflict("Two-step verification is already enabled.");
  if (!user.mfaPendingSecret) throw conflict("Start the set-up again to get a new key.");

  const reservation = await reserveAttempt([{ key: throttleKeys.otp(user.id), policy: THROTTLE_POLICIES.account }], now);
  const secret = decryptField(user.mfaPendingSecret, pendingContext(user.id));
  const step = verifyTotp(secret, code, { at: now });
  if (step === null) {
    const locked = await reservation.failed();
    if (locked.length) await db.$transaction((tx) => recordLockout(tx, locked, { userId: user.id, label: user.email }));
    throw invalid(INVALID_CODE, { code: [INVALID_CODE] });
  }
  await reservation.succeeded();

  return db.$transaction(async (tx) => {
    const enabled = await tx.user.updateMany({
      where: { id: user.id, mfaEnabledAt: null, mfaPendingSecret: user.mfaPendingSecret },
      data: { mfaSecret: encryptField(secret, activeContext(user.id)), mfaPendingSecret: null, mfaEnabledAt: now, mfaLastUsedStep: step },
    });
    if (enabled.count !== 1) throw conflict("Two-step verification was changed in another window. Refresh and try again.");
    const codes = await replaceRecoveryCodes(tx, user.id);
    await recordAudit(tx, auditActor, { action: "mfa.enabled", entityType: "User", entityId: user.id, summary: `Two-step verification enabled for ${user.email}` });
    return codes;
  });
}

export async function disableMfa(actor: Actor): Promise<void> {
  if (mfaRequiredForRole(actor.role)) throw conflict("Two-step verification is mandatory for your role and cannot be turned off.");
  await requireStepUp(actor, "mfa.disable");
  await db.$transaction(async (tx) => {
    const cleared = await tx.user.updateMany({
      where: { id: actor.userId, mfaEnabledAt: { not: null } },
      data: { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastUsedStep: null },
    });
    if (cleared.count !== 1) throw conflict("Two-step verification is not enabled.");
    await tx.authRecoveryCode.deleteMany({ where: { userId: actor.userId } });
    await recordAudit(tx, actor, { action: "mfa.disabled", entityType: "User", entityId: actor.userId, summary: `Two-step verification turned off by ${actor.email}` });
  });
}

export async function regenerateRecoveryCodes(actor: Actor): Promise<string[]> {
  await requireStepUp(actor, "mfa.recovery_codes");
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: actor.userId }, select: { mfaEnabledAt: true } });
    if (!user?.mfaEnabledAt) throw conflict("Set up two-step verification first.");
    const codes = await replaceRecoveryCodes(tx, actor.userId);
    await recordAudit(tx, actor, { action: "mfa.recovery_codes_regenerated", entityType: "User", entityId: actor.userId, summary: `New recovery codes generated by ${actor.email}` });
    return codes;
  });
}

/** Administrator reset for a user who lost their authenticator and recovery codes. Signs the user out everywhere. */
export async function resetUserMfa(actor: Actor, userId: string): Promise<void> {
  authorize(actor, "user.manage");
  if (userId === actor.userId) throw forbidden("Manage your own two-step verification from your Security page.");
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, mfaEnabledAt: true, mfaPendingSecret: true } });
    if (!user) throw notFound("User not found.");
    if (!user.mfaEnabledAt && !user.mfaPendingSecret) throw conflict("This user has not set up two-step verification.");
    await tx.user.update({ where: { id: user.id }, data: { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastUsedStep: null } });
    await tx.authRecoveryCode.deleteMany({ where: { userId: user.id } });
    const revoked = await revokeUserSessions(tx, user.id, "mfa_reset");
    await recordAudit(tx, actor, {
      action: "mfa.reset",
      entityType: "User",
      entityId: user.id,
      summary: `Reset two-step verification for ${user.email}`,
      metadata: { sessionsRevoked: revoked },
    });
  });
}
