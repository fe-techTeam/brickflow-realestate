import { describe, expect, it } from "vitest";
import type { OrganisationType, RoleKey } from "@/generated/prisma/enums";
import { authorize, can, PERMISSIONS, permissionsFor, type Permission } from "./permissions";

const SUBJECTS: Record<RoleKey, { role: RoleKey; orgType: OrganisationType }> = {
  CP_ADMIN: { role: "CP_ADMIN", orgType: "CHANNEL_PARTNER" },
  BUILDER_ACCOUNTS: { role: "BUILDER_ACCOUNTS", orgType: "BUILDER" },
  FINANCE_OPS: { role: "FINANCE_OPS", orgType: "FINANCIER" },
  SUPER_ADMIN: { role: "SUPER_ADMIN", orgType: "PLATFORM" },
};

/** The complete expected matrix: anything not listed must be denied. */
const EXPECTED: Record<Permission, RoleKey[]> = {
  "invoice.read": ["CP_ADMIN", "BUILDER_ACCOUNTS", "FINANCE_OPS", "SUPER_ADMIN"],
  "invoice.submit": ["CP_ADMIN"],
  "invoice.respond": ["CP_ADMIN"],
  "invoice.review": ["BUILDER_ACCOUNTS"],
  "invoice.approve": ["BUILDER_ACCOUNTS"],
  "document.read": ["CP_ADMIN", "BUILDER_ACCOUNTS", "FINANCE_OPS", "SUPER_ADMIN"],
  "offer.generate": ["CP_ADMIN"],
  "offer.accept": ["CP_ADMIN"],
  "financing.read": ["CP_ADMIN", "BUILDER_ACCOUNTS", "FINANCE_OPS", "SUPER_ADMIN"],
  "financing.decide": ["FINANCE_OPS"],
  "financing.comment": ["FINANCE_OPS"],
  "payout.release": ["FINANCE_OPS"],
  "settlement.record": ["FINANCE_OPS"],
  "programme.read": ["BUILDER_ACCOUNTS", "FINANCE_OPS", "SUPER_ADMIN"],
  "programme.manage": ["SUPER_ADMIN"],
  "organisation.read": ["CP_ADMIN", "BUILDER_ACCOUNTS", "FINANCE_OPS", "SUPER_ADMIN"],
  "organisation.manage": ["SUPER_ADMIN"],
  "user.manage": ["SUPER_ADMIN"],
  "settings.manage": ["SUPER_ADMIN"],
  "audit.read": ["CP_ADMIN", "BUILDER_ACCOUNTS", "FINANCE_OPS", "SUPER_ADMIN"],
};

describe("permission map", () => {
  it("covers every permission in the expected matrix", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...PERMISSIONS].sort());
  });

  for (const permission of PERMISSIONS) {
    it(`grants ${permission} only to ${EXPECTED[permission].join(", ")}`, () => {
      for (const [role, subject] of Object.entries(SUBJECTS) as [RoleKey, (typeof SUBJECTS)[RoleKey]][]) {
        expect(can(subject, permission), `${role} → ${permission}`).toBe(EXPECTED[permission].includes(role));
      }
    });
  }

  it("denies everything when the role does not belong to the organisation type", () => {
    for (const permission of PERMISSIONS) {
      expect(can({ role: "SUPER_ADMIN", orgType: "CHANNEL_PARTNER" }, permission)).toBe(false);
      expect(can({ role: "CP_ADMIN", orgType: "BUILDER" }, permission)).toBe(false);
      expect(can({ role: "FINANCE_OPS", orgType: "PLATFORM" }, permission)).toBe(false);
    }
  });

  it("denies by default: no actor, unknown roles and unknown permissions", () => {
    expect(can(null, "invoice.read")).toBe(false);
    expect(can(undefined, "invoice.read")).toBe(false);
    expect(can({ role: "AUDITOR" as RoleKey, orgType: "PLATFORM" }, "audit.read")).toBe(false);
    expect(can({ role: "constructor" as RoleKey, orgType: "PLATFORM" }, "audit.read")).toBe(false);
    expect(can(SUBJECTS.SUPER_ADMIN, "invoice.delete" as Permission)).toBe(false);
    expect(permissionsFor("AUDITOR" as RoleKey)).toEqual([]);
  });

  it("authorize throws a FORBIDDEN domain error", () => {
    expect(() => authorize(SUBJECTS.CP_ADMIN, "user.manage")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() => authorize(SUBJECTS.SUPER_ADMIN, "user.manage")).not.toThrow();
  });
});
