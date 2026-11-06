import type { OrganisationType, RoleKey } from "@/generated/prisma/enums";
import { forbidden } from "../errors";

/**
 * Central permission map. Services call `authorize(actor, permission)` in addition to their
 * organisation-ownership and organisation-type checks. Anything not granted here is denied.
 */
export const PERMISSIONS = [
  "invoice.read",
  "invoice.submit",
  "invoice.respond",
  "invoice.review",
  "invoice.approve",
  "document.read",
  "offer.generate",
  "offer.accept",
  "financing.read",
  "financing.decide",
  "financing.comment",
  "payout.release",
  "settlement.record",
  "programme.read",
  "programme.manage",
  "organisation.read",
  "organisation.manage",
  "user.manage",
  "settings.manage",
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const GRANTS: Readonly<Record<RoleKey, readonly Permission[]>> = {
  CP_ADMIN: ["invoice.read", "invoice.submit", "invoice.respond", "document.read", "offer.generate", "offer.accept", "financing.read", "organisation.read", "audit.read"],
  BUILDER_ACCOUNTS: ["invoice.read", "invoice.review", "invoice.approve", "document.read", "financing.read", "programme.read", "organisation.read", "audit.read"],
  FINANCE_OPS: [
    "invoice.read",
    "document.read",
    "financing.read",
    "financing.decide",
    "financing.comment",
    "payout.release",
    "settlement.record",
    "programme.read",
    "organisation.read",
    "audit.read",
  ],
  SUPER_ADMIN: [
    "invoice.read",
    "document.read",
    "financing.read",
    "programme.read",
    "programme.manage",
    "organisation.read",
    "organisation.manage",
    "user.manage",
    "settings.manage",
    "audit.read",
  ],
};

/** Each role exists only inside one kind of organisation; a mismatched pair is granted nothing. */
const ROLE_ORG_TYPE: Readonly<Record<RoleKey, OrganisationType>> = {
  CP_ADMIN: "CHANNEL_PARTNER",
  BUILDER_ACCOUNTS: "BUILDER",
  FINANCE_OPS: "FINANCIER",
  SUPER_ADMIN: "PLATFORM",
};

export interface PermissionSubject {
  role: RoleKey;
  orgType: OrganisationType;
}

export function can(actor: PermissionSubject | null | undefined, permission: Permission): boolean {
  if (!actor) return false;
  if (!Object.hasOwn(ROLE_ORG_TYPE, actor.role) || ROLE_ORG_TYPE[actor.role] !== actor.orgType) return false;
  return GRANTS[actor.role].includes(permission);
}

export function authorize(actor: PermissionSubject, permission: Permission): void {
  if (!can(actor, permission)) throw forbidden();
}

export function permissionsFor(role: RoleKey): readonly Permission[] {
  return GRANTS[role] ?? [];
}
