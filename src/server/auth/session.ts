import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { OrganisationType, RoleKey } from "@/generated/prisma/enums";
import { WORKSPACES, workspaceForOrgType, type WorkspaceKey } from "@/lib/workspaces";
import { db } from "../db";
import { forbidden, unauthenticated } from "../errors";
import { setRequestActor } from "../observability/context";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSessionToken, verifySessionToken } from "./token";

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
}

export async function startSession(userId: string, membershipId: string): Promise<void> {
  const token = await signSessionToken({ sub: userId, mid: membershipId });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Resolves the current actor from the session cookie; re-checks user and organisation status on every request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  const claims = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!claims) return null;

  const membership = await db.organisationUser.findUnique({
    where: { id: claims.mid },
    include: { user: true, organisation: true, role: true },
  });
  if (!membership || membership.userId !== claims.sub) return null;
  if (membership.user.status !== "ACTIVE" || membership.organisation.status !== "ACTIVE") return null;
  setRequestActor(membership.userId);

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
