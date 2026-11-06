/**
 * KYC policy settings, read from the environment on every call so tests and operators can change
 * them without a restart of the module graph. Invalid values fail loudly instead of falling back.
 */
import type { VerificationCheckType } from "@/generated/prisma/enums";

type Env = Record<string, string | undefined>;

function intSetting(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}").`);
  return value;
}

export interface KycPolicy {
  /** Minimum name-match score (0–100) for automatic approval; anything lower goes to admin review. */
  nameMatchThreshold: Record<"GSTIN" | "PAN" | "BANK_ACCOUNT" | "UDYAM", number>;
  /** Re-use a provider result for the same input within this window instead of calling again. */
  cacheTtlHours: number;
  /** How long a verified check stays valid before it must be re-run. */
  validityDays: Record<Exclude<VerificationCheckType, "RERA_AGENT">, number>;
  coolingOffHours: number;
  reraReminderDays: number;
}

export function kycPolicy(env: Env = process.env): KycPolicy {
  const base = intSetting(env, "KYC_NAME_MATCH_THRESHOLD", 80, 0, 100);
  return {
    nameMatchThreshold: {
      GSTIN: intSetting(env, "KYC_NAME_MATCH_THRESHOLD_GSTIN", base, 0, 100),
      PAN: intSetting(env, "KYC_NAME_MATCH_THRESHOLD_PAN", base, 0, 100),
      BANK_ACCOUNT: intSetting(env, "KYC_NAME_MATCH_THRESHOLD_BANK", base, 0, 100),
      UDYAM: intSetting(env, "KYC_NAME_MATCH_THRESHOLD_UDYAM", base, 0, 100),
    },
    cacheTtlHours: intSetting(env, "VERIFICATION_CACHE_TTL_HOURS", 24, 0, 24 * 30),
    validityDays: {
      GSTIN: intSetting(env, "KYC_GSTIN_VALIDITY_DAYS", 180, 1, 3650),
      PAN: intSetting(env, "KYC_PAN_VALIDITY_DAYS", 730, 1, 3650),
      BANK_ACCOUNT: intSetting(env, "KYC_BANK_VALIDITY_DAYS", 365, 1, 3650),
      UDYAM: intSetting(env, "KYC_UDYAM_VALIDITY_DAYS", 365, 1, 3650),
      E_INVOICE: 3650,
    },
    coolingOffHours: intSetting(env, "PAYOUT_ACCOUNT_COOLING_OFF_HOURS", 72, 0, 24 * 30),
    reraReminderDays: intSetting(env, "KYC_RERA_REMINDER_DAYS", 30, 1, 365),
  };
}

/**
 * Whether the payout gate is enforced. Defaults to on in production and off elsewhere (development,
 * tests, local demos); set KYC_ENFORCED=true|false to override.
 */
export function kycEnforced(env: Env = process.env): boolean {
  const raw = env.KYC_ENFORCED?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw) throw new Error(`KYC_ENFORCED must be "true" or "false" (got "${env.KYC_ENFORCED}").`);
  return env.NODE_ENV === "production";
}
