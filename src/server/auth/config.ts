import type { RoleKey } from "@/generated/prisma/enums";

/** Session lifetime: signed out after this much inactivity, and in any case after the absolute maximum. */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
/** `lastSeenAt` is written at most this often per session, to keep request overhead low. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

/** How long a successful step-up verification authorises sensitive actions in the same session. */
export const STEP_UP_WINDOW_MS = 5 * 60 * 1000;

/** Roles that must use two-step verification when `MFA_ENFORCED` is on. */
export const MFA_REQUIRED_ROLES: readonly RoleKey[] = ["BUILDER_ACCOUNTS", "FINANCE_OPS", "SUPER_ADMIN"];

export function parseBooleanEnv(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalised = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalised)) return true;
  if (["false", "0", "no", "off"].includes(normalised)) return false;
  throw new Error(`${name} must be "true" or "false" (got "${value}")`);
}

/** Mandatory two-step verification for privileged roles. Defaults to on in production, off elsewhere. */
export function mfaEnforced(): boolean {
  const production = process.env.NODE_ENV === "production";
  const enforced = parseBooleanEnv("MFA_ENFORCED", process.env.MFA_ENFORCED, production);
  if (production && !enforced && !warnedMfaOff) {
    warnedMfaOff = true;
    console.warn("[security] MFA_ENFORCED=false in production: two-step verification is NOT mandatory for privileged roles.");
  }
  return enforced;
}

let warnedMfaOff = false;

export function mfaRequiredForRole(role: RoleKey): boolean {
  return mfaEnforced() && MFA_REQUIRED_ROLES.includes(role);
}
