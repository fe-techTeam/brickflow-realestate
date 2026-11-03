import { describe, expect, it } from "vitest";
import { workspaceForOrgType } from "@/lib/workspaces";
import { db } from "@/server/db";
import { setOrganisationStatus, setUserStatus } from "@/server/services/admin";
import { authenticate } from "@/server/services/auth";
import { actorFor, DEMO_PASSWORD, expectDomainError, expectValidationError, USERS } from "./helpers";

describe("authenticate", () => {
  it.each([
    ["channel partner", USERS.prestige, "CHANNEL_PARTNER", "/partner"],
    ["builder", USERS.godrej, "BUILDER", "/builder"],
    ["Veefin finance", USERS.finance, "FINANCIER", "/finance"],
    ["super admin", USERS.admin, "PLATFORM", "/admin"],
  ] as const)("signs in the %s and resolves its workspace", async (_label, email, orgType, basePath) => {
    const before = new Date();
    const result = await authenticate({ email, password: DEMO_PASSWORD });

    expect(result.orgType).toBe(orgType);
    expect(workspaceForOrgType(result.orgType).basePath).toBe(basePath);

    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { memberships: true } });
    expect(result.userId).toBe(user.id);
    expect(result.membershipId).toBe(user.memberships[0]!.id);
    expect(user.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);

    const audit = await db.auditLog.findFirst({ where: { action: "session.login", entityId: user.id }, orderBy: { createdAt: "desc" } });
    expect(audit).toMatchObject({ actorUserId: user.id, entityType: "Session" });
  });

  it("matches the email address case-insensitively", async () => {
    const result = await authenticate({ email: USERS.prestige.toUpperCase(), password: DEMO_PASSWORD });
    expect(result.orgType).toBe("CHANNEL_PARTNER");
  });

  it("rejects a wrong password with a generic message", async () => {
    await expectDomainError(authenticate({ email: USERS.prestige, password: "not-the-password" }), "UNAUTHENTICATED", /email or password is incorrect/);
  });

  it("rejects an unknown account with the same generic message", async () => {
    await expectDomainError(authenticate({ email: "nobody@brickflow.demo", password: DEMO_PASSWORD }), "UNAUTHENTICATED", /email or password is incorrect/);
  });

  it("validates the input shape", async () => {
    await expectValidationError(authenticate({ email: "not-an-email", password: DEMO_PASSWORD }), "email");
    await expectValidationError(authenticate({ email: USERS.prestige, password: "" }), "password");
  });

  it("refuses a deactivated user", async () => {
    const admin = await actorFor("admin");
    const user = await db.user.findUniqueOrThrow({ where: { email: USERS.urbannest } });
    await setUserStatus(admin, user.id, "INACTIVE");
    try {
      await expectDomainError(authenticate({ email: USERS.urbannest, password: DEMO_PASSWORD }), "FORBIDDEN", /deactivated/);
    } finally {
      await setUserStatus(admin, user.id, "ACTIVE");
    }
    await expect(authenticate({ email: USERS.urbannest, password: DEMO_PASSWORD })).resolves.toMatchObject({ orgType: "CHANNEL_PARTNER" });
  });

  it("refuses a user whose organisation is inactive", async () => {
    const admin = await actorFor("admin");
    const coastal = await actorFor("coastal");
    await setOrganisationStatus(admin, coastal.orgId, "INACTIVE");
    try {
      await expectDomainError(authenticate({ email: USERS.coastal, password: DEMO_PASSWORD }), "FORBIDDEN", /organisation is currently inactive/);
    } finally {
      await setOrganisationStatus(admin, coastal.orgId, "ACTIVE");
    }
    await expect(authenticate({ email: USERS.coastal, password: DEMO_PASSWORD })).resolves.toMatchObject({ orgType: "BUILDER" });
  });

  it("audits status changes and protects the administrator's own account and the platform", async () => {
    const admin = await actorFor("admin");
    await expectDomainError(setUserStatus(admin, admin.userId, "INACTIVE"), "CONFLICT");
    await expectDomainError(setOrganisationStatus(admin, admin.orgId, "INACTIVE"), "CONFLICT");

    const finance = await actorFor("finance");
    await expectDomainError(setUserStatus(finance, admin.userId, "INACTIVE"), "FORBIDDEN");

    const coastal = await actorFor("coastal");
    const actions = (await db.auditLog.findMany({ where: { entityId: coastal.orgId } })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["organisation.deactivated", "organisation.activated"]));
  });
});
