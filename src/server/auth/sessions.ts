import "server-only";
import { randomBytes } from "node:crypto";
import type { RoleKey } from "@/generated/prisma/enums";
import { db, type Tx } from "../db";
import { mfaRequiredForRole, SESSION_IDLE_TIMEOUT_MS, SESSION_MAX_AGE_MS, SESSION_TOUCH_INTERVAL_MS } from "./config";

/** Server-side session records. The cookie only carries the id; this table is the source of truth. */
type Client = Tx | typeof db;

export type RevokeReason =
  | "signed_out"
  | "signed_out_everywhere"
  | "revoked_by_user"
  | "password_changed"
  | "privilege_changed"
  | "rotated"
  | "user_deactivated"
  | "organisation_deactivated"
  | "mfa_reset";

export interface SessionOrigin {
  ip: string | null;
  userAgent: string | null;
}

export interface NewSession {
  userId: string;
  membershipId: string;
  roleKey: RoleKey;
  mfaVerifiedAt: Date | null;
}

const USER_AGENT_MAX = 400;

export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSessionRecord(client: Client, session: NewSession, origin: SessionOrigin, now: Date = new Date()) {
  return client.session.create({
    data: {
      id: newSessionId(),
      userId: session.userId,
      membershipId: session.membershipId,
      roleKey: session.roleKey,
      mfaVerifiedAt: session.mfaVerifiedAt,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_MS),
      ip: origin.ip,
      userAgent: origin.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
    },
  });
}

/** Prisma filter for sessions that are neither revoked, idle-expired nor past their absolute expiry. */
export function activeSessionWhere(now: Date = new Date()) {
  return {
    revokedAt: null,
    expiresAt: { gt: now },
    lastSeenAt: { gt: new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS) },
  };
}

export function isSessionActive(session: { revokedAt: Date | null; expiresAt: Date; lastSeenAt: Date }, now: Date = new Date()): boolean {
  return !session.revokedAt && session.expiresAt > now && now.getTime() - session.lastSeenAt.getTime() < SESSION_IDLE_TIMEOUT_MS;
}

/**
 * Validates a session for the claims in a verified token and loads the membership it was issued for.
 * Returns null whenever access must be refused; a role change since sign-in revokes the session.
 */
export async function validateSession(claims: { sub: string; mid: string; sid: string }, now: Date = new Date()) {
  const [session, membership] = await Promise.all([
    db.session.findUnique({ where: { id: claims.sid } }),
    db.organisationUser.findUnique({ where: { id: claims.mid }, include: { user: true, organisation: true, role: true } }),
  ]);
  if (!session || session.userId !== claims.sub || session.membershipId !== claims.mid) return null;
  if (!isSessionActive(session, now)) return null;
  if (!membership || membership.userId !== claims.sub) return null;
  if (membership.user.status !== "ACTIVE" || membership.organisation.status !== "ACTIVE") return null;
  if (membership.role.key !== session.roleKey) {
    await revokeSession(db, session.id, "privilege_changed", now);
    return null;
  }
  // Sessions opened before two-step verification became mandatory for this role must sign in again.
  if (!session.mfaVerifiedAt && mfaRequiredForRole(membership.role.key)) return null;

  if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    await db.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { lastSeenAt: now } });
  }
  return { session, membership };
}

export async function revokeSession(client: Client, sessionId: string, reason: RevokeReason, now: Date = new Date()): Promise<boolean> {
  const { count } = await client.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now, revokedReason: reason } });
  return count === 1;
}

export async function revokeUserSessions(
  client: Client,
  userId: string,
  reason: RevokeReason,
  options: { exceptSessionId?: string; now?: Date } = {},
): Promise<number> {
  const { count } = await client.session.updateMany({
    where: { userId, revokedAt: null, ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}) },
    data: { revokedAt: options.now ?? new Date(), revokedReason: reason },
  });
  return count;
}

/** Replaces a session with a fresh id (same user, membership and second-factor state). */
export async function rotateSessionRecord(tx: Tx, sessionId: string, origin: SessionOrigin, now: Date = new Date()) {
  const current = await tx.session.findUnique({ where: { id: sessionId }, include: { user: { select: { memberships: { include: { role: true } } } } } });
  if (!current || !(await revokeSession(tx, sessionId, "rotated", now))) return null;
  const membership = current.user.memberships.find((m) => m.id === current.membershipId);
  if (!membership) return null;
  return createSessionRecord(
    tx,
    { userId: current.userId, membershipId: current.membershipId, roleKey: membership.role.key, mfaVerifiedAt: current.mfaVerifiedAt },
    origin,
    now,
  );
}

export async function listActiveSessions(userId: string, now: Date = new Date()) {
  return db.session.findMany({
    where: { userId, ...activeSessionWhere(now) },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, ip: true, userAgent: true, mfaVerifiedAt: true },
  });
}

/** Deletes sessions that ended more than 30 days ago. Exposed for the scheduler. */
export async function purgeEndedSessions(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const { count } = await db.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }, { lastSeenAt: { lt: cutoff } }] },
  });
  return count;
}
