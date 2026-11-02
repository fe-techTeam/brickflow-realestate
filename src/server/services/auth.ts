import "server-only";
import { z } from "zod";
import { recordAudit } from "../audit";
import { verifyPassword } from "../auth/password";
import { workspaceForOrgType } from "@/lib/workspaces";
import { db } from "../db";
import { DomainError } from "../errors";

export const loginSchema = z.object({
  email: z.email("Enter a valid email address").transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, "Enter your password").max(200),
});

const INVALID = "The email or password is incorrect.";
// Valid bcrypt hash compared against when the user does not exist, so response time does not reveal accounts.
const TIMING_HASH = "$2b$12$SvFxe1lqaaoEVImKlkvpBOQaRxpKgyNLz/aTV44inIKVDApPXnPbi";

/** Verifies credentials and returns the membership to open a session for. Constant-time-ish on unknown users. */
export async function authenticate(raw: { email: string; password: string }) {
  const { email, password } = loginSchema.parse(raw);
  const user = await db.user.findUnique({
    where: { email },
    include: { memberships: { include: { organisation: true, role: true }, orderBy: { createdAt: "asc" } } },
  });
  const ok = await verifyPassword(password, user?.passwordHash ?? TIMING_HASH);
  if (!user || !ok) throw new DomainError("UNAUTHENTICATED", INVALID);
  if (user.status !== "ACTIVE") throw new DomainError("FORBIDDEN", "This account has been deactivated. Contact the platform administrator.");

  const membership = user.memberships.find((m) => m.organisation.status === "ACTIVE");
  if (!membership) throw new DomainError("FORBIDDEN", "Your organisation is currently inactive. Contact the platform administrator.");

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await recordAudit(
      tx,
      {
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
      },
      { action: "session.login", entityType: "Session", entityId: user.id, summary: `${user.name} signed in` },
    );
  });

  return { userId: user.id, membershipId: membership.id, orgType: membership.organisation.type };
}
