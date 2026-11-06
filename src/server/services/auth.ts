import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { workspaceForOrgType } from "@/lib/workspaces";
import { recordAudit } from "../audit";
import { mfaRequiredForRole } from "../auth/config";
import { verifyPassword } from "../auth/password";
import type { Actor } from "../auth/session";
import { reserveAttempt, THROTTLE_POLICIES, throttleKeys, type ThrottleTarget } from "../auth/throttle";
import type { MfaPendingClaims } from "../auth/token";
import { db } from "../db";
import { DomainError } from "../errors";
import { beginEnrolment, confirmEnrolment, recordLockout, verifySecondFactor, type EnrolmentSecret } from "./mfa";

export const loginSchema = z.object({
  email: z.email("Enter a valid email address").max(254).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, "Enter your password").max(200),
});

const INVALID = "The email or password is incorrect.";
// Valid bcrypt hash compared against when the user does not exist, so response time does not reveal accounts.
const TIMING_HASH = "$2b$12$SvFxe1lqaaoEVImKlkvpBOQaRxpKgyNLz/aTV44inIKVDApPXnPbi";

export interface LoginOrigin {
  ip: string | null;
  userAgent?: string | null;
}

/** What the sign-in needs next: a session straight away, the authenticator challenge, or first-time enrolment. */
export type LoginStep = "session" | "mfa_challenge" | "mfa_enrol";

type MembershipWithOrg = Prisma.OrganisationUserGetPayload<{ include: { organisation: true; role: true } }>;
type UserWithMemberships = Prisma.UserGetPayload<{ include: { memberships: { include: { organisation: true; role: true } } } }>;

function actorFor(user: { id: string; name: string; email: string }, membership: MembershipWithOrg): Actor {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    membershipId: membership.id,
    orgId: membership.organisationId,
    orgName: membership.organisation.name,
    orgType: membership.organisation.type,
    role: membership.role.key,
    designation: membership.designation,
    workspace: workspaceForOrgType(membership.organisation.type).key,
  };
}

function activeMembership(user: UserWithMemberships): MembershipWithOrg {
  if (user.status !== "ACTIVE") throw new DomainError("FORBIDDEN", "This account has been deactivated. Contact the platform administrator.");
  const membership = user.memberships.find((m) => m.organisation.status === "ACTIVE");
  if (!membership) throw new DomainError("FORBIDDEN", "Your organisation is currently inactive. Contact the platform administrator.");
  return membership;
}

async function recordLogin(user: UserWithMemberships, membership: MembershipWithOrg, metadata: Record<string, unknown>) {
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await recordAudit(tx, actorFor(user, membership), {
      action: "session.login",
      entityType: "Session",
      entityId: user.id,
      summary: `${user.name} signed in`,
      metadata,
    });
  });
}

function loadUser(where: Prisma.UserWhereUniqueInput) {
  return db.user.findUnique({
    where,
    include: { memberships: { include: { organisation: true, role: true }, orderBy: { createdAt: "asc" } } },
  });
}

/**
 * Verifies the password, throttled per account and per client IP. Unknown accounts take the same
 * path (a bcrypt comparison and the same throttle) and get the same message, so neither the response
 * nor its timing reveals whether an email is registered.
 */
export async function authenticate(raw: { email: string; password: string }, origin: LoginOrigin = { ip: null }) {
  const { email, password } = loginSchema.parse(raw);
  const targets: ThrottleTarget[] = [{ key: throttleKeys.loginEmail(email), policy: THROTTLE_POLICIES.account }];
  if (origin.ip) targets.push({ key: throttleKeys.loginIp(origin.ip), policy: THROTTLE_POLICIES.ip });
  const reservation = await reserveAttempt(targets);

  const user = await loadUser({ email });
  const ok = await verifyPassword(password, user?.passwordHash ?? TIMING_HASH);
  if (!user || !ok) {
    const locked = await reservation.failed();
    if (locked.length) await db.$transaction((tx) => recordLockout(tx, locked, { userId: user?.id, label: email }));
    throw new DomainError("UNAUTHENTICATED", INVALID);
  }
  await reservation.succeeded();

  const membership = activeMembership(user);
  const step: LoginStep = user.mfaEnabledAt ? "mfa_challenge" : mfaRequiredForRole(membership.role.key) ? "mfa_enrol" : "session";
  if (step === "session") await recordLogin(user, membership, { ip: origin.ip, mfa: false });

  return { userId: user.id, membershipId: membership.id, orgType: membership.organisation.type, role: membership.role.key, step };
}

/** Re-checks a pending sign-in (password already verified) against the current account state. */
async function loadPending(claims: MfaPendingClaims) {
  const user = await loadUser({ id: claims.sub });
  if (!user) throw new DomainError("UNAUTHENTICATED", "Your sign-in has expired. Please sign in again.");
  const membership = activeMembership(user);
  if (membership.id !== claims.mid) throw new DomainError("UNAUTHENTICATED", "Your sign-in has expired. Please sign in again.");
  return { user, membership };
}

/** Second step of sign-in for accounts with two-step verification: authenticator or recovery code. */
export async function completeMfaLogin(claims: MfaPendingClaims, code: string, origin: LoginOrigin = { ip: null }) {
  if (claims.purpose !== "challenge") throw new DomainError("UNAUTHENTICATED", "Your sign-in has expired. Please sign in again.");
  const { user, membership } = await loadPending(claims);
  const method = await verifySecondFactor(user.id, z.string().max(64).parse(code), { allowRecoveryCode: true });
  await recordLogin(user, membership, { ip: origin.ip, mfa: method });
  return { userId: user.id, membershipId: membership.id, orgType: membership.organisation.type };
}

/** Authenticator set-up required at sign-in (mandatory roles that have not enrolled yet). */
export async function startLoginEnrolment(claims: MfaPendingClaims, options: { regenerate?: boolean } = {}): Promise<EnrolmentSecret & { email: string }> {
  if (claims.purpose !== "enrol") throw new DomainError("UNAUTHENTICATED", "Your sign-in has expired. Please sign in again.");
  const { user } = await loadPending(claims);
  return { ...(await beginEnrolment(user.id, options)), email: user.email };
}

export async function completeLoginEnrolment(claims: MfaPendingClaims, code: string, origin: LoginOrigin = { ip: null }) {
  if (claims.purpose !== "enrol") throw new DomainError("UNAUTHENTICATED", "Your sign-in has expired. Please sign in again.");
  const { user, membership } = await loadPending(claims);
  const recoveryCodes = await confirmEnrolment(user.id, z.string().max(64).parse(code), actorFor(user, membership));
  await recordLogin(user, membership, { ip: origin.ip, mfa: "enrolled" });
  return { userId: user.id, membershipId: membership.id, orgType: membership.organisation.type, recoveryCodes };
}
