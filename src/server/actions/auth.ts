"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { workspaceForOrgType } from "@/lib/workspaces";
import { runAction, type ActionResult } from "../action-result";
import { recordAudit } from "../audit";
import { endSession, getActor, pendingMfaClaims, requestOrigin, startSession } from "../auth/session";
import { MFA_PENDING_COOKIE, MFA_PENDING_TTL_SECONDS, signMfaPendingToken, verifyMfaPendingToken } from "../auth/token";
import { db } from "../db";
import { DomainError, unauthenticated } from "../errors";
import { authenticate, completeLoginEnrolment, completeMfaLogin } from "../services/auth";

export interface LoginState {
  error?: string;
  email?: string;
}

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production" && (process.env.APP_URL ?? "").startsWith("https://");
}

function failure(error: unknown, email?: string): LoginState {
  if (error instanceof DomainError) return { error: error.message, email };
  if (error instanceof ZodError) return { error: error.issues[0]?.message ?? "Enter your email and password.", email };
  console.error("[auth] sign-in failed", error);
  return { error: "Sign-in is temporarily unavailable. Please try again.", email };
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  let destination: string;
  try {
    const origin = await requestOrigin();
    const result = await authenticate({ email, password }, origin);
    if (result.step === "session") {
      await startSession(result.userId, result.membershipId, { mfaVerified: false });
      destination = workspaceForOrgType(result.orgType).basePath;
    } else {
      const token = await signMfaPendingToken({ sub: result.userId, mid: result.membershipId, purpose: result.step === "mfa_enrol" ? "enrol" : "challenge" });
      (await cookies()).set(MFA_PENDING_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/login", maxAge: MFA_PENDING_TTL_SECONDS });
      destination = "/login/verify";
    }
  } catch (error) {
    return failure(error, email);
  }
  redirect(destination);
}

export interface MfaChallengeState {
  error?: string;
}

export async function verifyMfaLoginAction(_prev: MfaChallengeState, formData: FormData): Promise<MfaChallengeState> {
  let destination: string;
  try {
    const claims = await pendingMfaClaims();
    if (!claims) throw unauthenticated("Your sign-in has expired. Please sign in again.");
    const result = await completeMfaLogin(claims, String(formData.get("code") ?? ""), await requestOrigin());
    await startSession(result.userId, result.membershipId, { mfaVerified: true });
    destination = workspaceForOrgType(result.orgType).basePath;
  } catch (error) {
    return { error: failure(error).error };
  }
  redirect(destination);
}

/**
 * Finishes first-time authenticator set-up during sign-in and returns the recovery codes to show once,
 * with a short-lived completion token. No cookie changes here: that would re-render the page and
 * replace the codes before the user saved them. `finishLoginEnrolmentAction` exchanges the token.
 */
export async function confirmLoginEnrolmentAction(input: { code: string }): Promise<ActionResult<{ recoveryCodes: string[]; completionToken: string }>> {
  return runAction(async () => {
    const claims = await pendingMfaClaims();
    if (!claims) throw unauthenticated("Your sign-in has expired. Please sign in again.");
    const result = await completeLoginEnrolment(claims, input.code, await requestOrigin());
    const completionToken = await signMfaPendingToken({ sub: result.userId, mid: result.membershipId, purpose: "enrolled" });
    return { recoveryCodes: result.recoveryCodes, completionToken };
  }, "Two-step verification is on.");
}

/** Opens the session once the recovery codes were shown; needs both the pending cookie and the completion token. */
export async function finishLoginEnrolmentAction(completionToken: string): Promise<LoginState> {
  let destination: string;
  try {
    const claims = await pendingMfaClaims();
    const done = await verifyMfaPendingToken(String(completionToken ?? ""), ["enrolled"]);
    if (!claims || claims.purpose !== "enrol" || !done || done.sub !== claims.sub || done.mid !== claims.mid) {
      throw unauthenticated("Your sign-in has expired. Please sign in again.");
    }
    const membership = await db.organisationUser.findUnique({ where: { id: done.mid }, include: { user: true, organisation: true } });
    if (
      !membership ||
      membership.userId !== done.sub ||
      membership.user.status !== "ACTIVE" ||
      membership.organisation.status !== "ACTIVE" ||
      !membership.user.mfaEnabledAt
    ) {
      throw unauthenticated("Your sign-in has expired. Please sign in again.");
    }
    await startSession(done.sub, done.mid, { mfaVerified: true });
    destination = workspaceForOrgType(membership.organisation.type).basePath;
  } catch (error) {
    return failure(error);
  }
  redirect(destination);
}

export async function cancelMfaLoginAction(): Promise<void> {
  (await cookies()).delete({ name: MFA_PENDING_COOKIE, path: "/login" });
  redirect("/login");
}

export async function logoutAction(): Promise<void> {
  const actor = await getActor();
  if (actor) {
    await db.$transaction(async (tx) =>
      recordAudit(tx, actor, { action: "session.logout", entityType: "Session", entityId: actor.userId, summary: `${actor.name} signed out` }),
    );
  }
  await endSession("signed_out");
  redirect("/login");
}
