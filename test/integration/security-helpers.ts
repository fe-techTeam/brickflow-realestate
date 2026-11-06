import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { RoleKey } from "@/generated/prisma/enums";
import { workspaceForOrgType } from "@/lib/workspaces";
import type { Actor } from "@/server/auth/session";
import { createSessionRecord } from "@/server/auth/sessions";
import { SESSION_COOKIE, signSessionToken } from "@/server/auth/token";
import { totpCode, totpStep } from "@/server/auth/totp";
import { db } from "@/server/db";
import { beginEnrolment, confirmEnrolment } from "@/server/services/mfa";
import { orgId, USERS } from "./helpers";

export const TEST_PASSWORD = "Saffron-Lattice-Harbour-91";
// One bcrypt hash for every throwaway account keeps the suite fast.
const HASH = bcrypt.hashSync(TEST_PASSWORD, 4);

const ORG_FOR_ROLE: Record<RoleKey, keyof typeof USERS> = {
  CP_ADMIN: "prestige",
  BUILDER_ACCOUNTS: "godrej",
  FINANCE_OPS: "finance",
  SUPER_ADMIN: "admin",
};

/**
 * Creates a throwaway user in a seeded organisation, so security tests can lock, enrol and sign out
 * accounts without affecting the seeded demo users other test files rely on.
 */
export async function createTestUser(role: RoleKey, label = "user"): Promise<Actor> {
  const organisationId = await (async () => {
    const key = ORG_FOR_ROLE[role];
    if (key === "finance" || key === "admin") {
      const m = await db.organisationUser.findFirstOrThrow({ where: { user: { email: USERS[key] } } });
      return m.organisationId;
    }
    return orgId(key as "prestige" | "godrej");
  })();
  const roleRow = await db.role.findUniqueOrThrow({ where: { key: role } });
  const email = `${label}.${randomUUID().slice(0, 8)}@security-test.example`;
  const user = await db.user.create({
    data: {
      email,
      name: `Test ${label}`,
      passwordHash: HASH,
      memberships: { create: { organisationId, roleId: roleRow.id, designation: "Security test" } },
    },
    include: { memberships: { include: { organisation: true, role: true } } },
  });
  const membership = user.memberships[0]!;
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

/** Opens a server-side session for the actor and returns the actor bound to it plus its cookie token. */
export async function openSession(actor: Actor, options: { mfaVerified?: boolean; now?: Date; ip?: string } = {}) {
  const session = await createSessionRecord(
    db,
    { userId: actor.userId, membershipId: actor.membershipId, roleKey: actor.role, mfaVerifiedAt: options.mfaVerified ? (options.now ?? new Date()) : null },
    { ip: options.ip ?? "203.0.113.10", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36" },
    options.now,
  );
  const token = await signSessionToken({ sub: actor.userId, mid: actor.membershipId, sid: session.id }, session.expiresAt);
  return { actor: { ...actor, sessionId: session.id } as Actor, session, token };
}

/** Enrols the actor in TOTP at a fixed time; returns the base32 secret and the recovery codes. */
export async function enrolMfa(actor: Actor, at: Date = new Date()) {
  const { manualKey } = await beginEnrolment(actor.userId);
  const secret = manualKey.replace(/\s/g, "");
  const recoveryCodes = await confirmEnrolment(actor.userId, totpCode(secret, at), actor, at);
  return { secret, recoveryCodes, step: totpStep(at) };
}

/** A fresh time, `steps` TOTP periods after `from`, so the next code is never a replay. */
export function later(from: Date, steps = 1): Date {
  return new Date(from.getTime() + steps * 30_000);
}

export { SESSION_COOKIE };
