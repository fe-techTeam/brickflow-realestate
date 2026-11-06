"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "../action-result";
import { qrMatrix, type QrMatrix } from "../auth/qr";
import { adoptSession, clearSessionCookie, requireActor, rotateCurrentSession, type Actor } from "../auth/session";
import { isStepUpPurpose, type StepUpPurpose } from "../auth/step-up";
import { db } from "../db";
import { invalid } from "../errors";
import { beginEnrolment, confirmEnrolment, disableMfa, regenerateRecoveryCodes, resetUserMfa } from "../services/mfa";
import { changePassword, confirmStepUp, revokeOwnSession, signOutEverywhere, type ChangePasswordInput } from "../services/security";

function refresh() {
  revalidatePath("/", "layout");
}

/** New session id after a privilege change, so a cookie captured earlier stops working. */
async function rotate(actor: Actor) {
  const next = await db.$transaction((tx) => rotateCurrentSession(tx, actor));
  await adoptSession(next);
}

export interface EnrolmentDetails {
  manualKey: string;
  otpauthUri: string;
  qr: QrMatrix;
}

export async function beginMfaEnrolmentAction(options: { regenerate?: boolean } = {}): Promise<ActionResult<EnrolmentDetails>> {
  return runAction(async () => {
    const actor = await requireActor();
    const secret = await beginEnrolment(actor.userId, { regenerate: options.regenerate === true });
    return { ...secret, qr: qrMatrix(secret.otpauthUri) };
  });
}

export async function confirmMfaEnrolmentAction(input: { code: string }): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  return runAction(async () => {
    const actor = await requireActor();
    const recoveryCodes = await confirmEnrolment(actor.userId, String(input.code ?? ""), actor);
    if (actor.sessionId) {
      await db.session.updateMany({ where: { id: actor.sessionId, userId: actor.userId, revokedAt: null }, data: { mfaVerifiedAt: new Date() } });
    }
    await rotate(actor);
    refresh();
    return { recoveryCodes };
  }, "Two-step verification is on.");
}

export async function disableMfaAction(): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await disableMfa(actor);
    await rotate(actor);
    refresh();
    return undefined;
  }, "Two-step verification is off.");
}

export async function regenerateRecoveryCodesAction(): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  return runAction(async () => {
    const recoveryCodes = await regenerateRecoveryCodes(await requireActor());
    refresh();
    return { recoveryCodes };
  }, "New recovery codes generated. The previous codes no longer work.");
}

/** Which credential the step-up prompt should ask for. */
export async function stepUpMethodAction(): Promise<ActionResult<{ method: "totp" | "password" }>> {
  return runAction(async () => {
    const actor = await requireActor();
    const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { mfaEnabledAt: true } });
    return { method: user.mfaEnabledAt ? ("totp" as const) : ("password" as const) };
  });
}

/** Second half of a step-up prompt: verifies the code and marks the session as freshly confirmed. */
export async function confirmStepUpAction(purpose: StepUpPurpose, input: { code: string }): Promise<ActionResult> {
  return runAction(async () => {
    if (!isStepUpPurpose(purpose)) throw invalid("Unknown confirmation request.");
    await confirmStepUp(await requireActor(), purpose, { code: String(input.code ?? "") });
    return undefined;
  }, "Identity confirmed.");
}

export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  return runAction(async () => {
    await revokeOwnSession(await requireActor(), sessionId);
    refresh();
    return undefined;
  }, "Session signed out.");
}

export async function signOutEverywhereAction(): Promise<ActionResult> {
  const result = await runAction(async () => {
    await signOutEverywhere(await requireActor());
    await clearSessionCookie();
    return undefined;
  });
  if (result.ok) redirect("/login");
  return result;
}

export async function changePasswordAction(input: ChangePasswordInput): Promise<ActionResult<{ otherSessionsRevoked: number }>> {
  return runAction(async () => {
    const actor = await requireActor();
    const result = await changePassword(actor, input);
    await rotate(actor);
    refresh();
    return result;
  }, "Password changed. Other sessions have been signed out.");
}

export async function resetUserMfaAction(userId: string): Promise<ActionResult> {
  return runAction(async () => {
    await resetUserMfa(await requireActor(), userId);
    refresh();
    return undefined;
  }, "Two-step verification reset. The user will set it up again at next sign-in.");
}
