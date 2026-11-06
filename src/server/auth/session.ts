import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { OrganisationType, RoleKey } from "@/generated/prisma/enums";
import { WORKSPACES, workspaceForOrgType, type WorkspaceKey } from "@/lib/workspaces";
import { db, type Tx } from "../db";
import { forbidden, unauthenticated } from "../errors";
import { clientIpFromHeaders } from "./client-ip";
import { createSessionRecord, revokeSession, rotateSessionRecord, validateSession, type RevokeReason, type SessionOrigin } from "./sessions";
import { MFA_PENDING_COOKIE, SESSION_COOKIE, signSessionToken, verifyMfaPendingToken, verifySessionToken, type MfaPendingClaims } from "./token";

/** The authenticated principal every service call is authorised against. */
export interface Actor {
  userId: string;
  name: string;
  email: string;
  membershipId: string;
  orgId: string;
  orgName: string;
  orgType: OrganisationType;
  role: RoleKey;
  designation: string | null;
  workspace: WorkspaceKey;
  /** Server-side session the request was authenticated with (absent for actors built outside a request). */
  sessionId?: string;
}

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production" && (process.env.APP_URL ?? "").startsWith("https://");
}

/** Client IP (via the trusted proxy chain) and user agent of the current request. */
export async function requestOrigin(): Promise<SessionOrigin> {
  const h = await headers();
  return { ip: clientIpFromHeaders(h), userAgent: h.get("user-agent") };
}

async function setSessionCookie(session: { id: string; userId: string; membershipId: string; expiresAt: Date }) {
  const token = await signSessionToken({ sub: session.userId, mid: session.membershipId, sid: session.id }, session.expiresAt);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
  });
}

/** Opens a server-side session for a membership and sets the session cookie. */
export async function startSession(userId: string, membershipId: string, options: { mfaVerified: boolean }): Promise<void> {
  const membership = await db.organisationUser.findUniqueOrThrow({ where: { id: membershipId }, include: { role: true } });
  if (membership.userId !== userId) throw forbidden();
  const session = await createSessionRecord(
    db,
    { userId, membershipId, roleKey: membership.role.key, mfaVerifiedAt: options.mfaVerified ? new Date() : null },
    await requestOrigin(),
  );
  await setSessionCookie(session);
  (await cookies()).delete({ name: MFA_PENDING_COOKIE, path: "/login" });
}

/** Claims of the sign-in waiting for its second factor, if any. */
export async function pendingMfaClaims(): Promise<MfaPendingClaims | null> {
  return verifyMfaPendingToken((await cookies()).get(MFA_PENDING_COOKIE)?.value);
}

/** Id of the session in the request cookie, if its token is valid (the row itself is not checked). */
export async function currentSessionId(): Promise<string | null> {
  const store = await cookies();
  return (await verifySessionToken(store.get(SESSION_COOKIE)?.value))?.sid ?? null;
}

/** Revokes the current session row and clears the cookie. */
export async function endSession(reason: RevokeReason = "signed_out"): Promise<void> {
  const sessionId = await currentSessionId();
  if (sessionId) await revokeSession(db, sessionId, reason);
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * Issues a new session id for the signed-in user after a privilege change (e.g. enabling two-step
 * verification or changing the password), so a previously captured cookie stops working.
 */
export async function rotateCurrentSession(tx: Tx, actor: Actor): Promise<{ id: string; userId: string; membershipId: string; expiresAt: Date } | null> {
  if (!actor.sessionId) return null;
  return rotateSessionRecord(tx, actor.sessionId, await requestOrigin());
}

/** Sets the cookie for a session returned by `rotateCurrentSession`, once its transaction has committed. */
export async function adoptSession(session: { id: string; userId: string; membershipId: string; expiresAt: Date } | null): Promise<void> {
  if (session) await setSessionCookie(session);
}

/** Resolves the current actor from the session cookie and its server-side session row, on every request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  const claims = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!claims) return null;

  const valid = await validateSession(claims);
  if (!valid) return null;
  const { membership, session } = valid;

  return {
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    membershipId: membership.id,
    orgId: membership.organisationId,
    orgName: membership.organisation.name,
    orgType: membership.organisation.type,
    role: membership.role.key,
    designation: membership.designation,
    workspace: workspaceForOrgType(membership.organisation.type).key,
    sessionId: session.id,
  };
});

/** For server actions / route handlers: throws instead of redirecting. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw unauthenticated();
  return actor;
}

/** For pages and layouts: redirects to login, or to the actor's own workspace when the role does not match. */
export async function requireWorkspace(workspace: WorkspaceKey): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.workspace !== workspace) redirect(WORKSPACES[actor.workspace].basePath);
  return actor;
}

export function assertOrgType(actor: Actor, ...types: OrganisationType[]): void {
  if (!types.includes(actor.orgType)) throw forbidden();
}
