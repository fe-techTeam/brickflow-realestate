/**
 * Derives an organisation's KYC status from its latest checks. Pure, so the rules are unit-tested.
 *
 * Required checks by organisation type:
 *   Channel partner  GSTIN (when GST-registered), PAN, payout bank account, RERA agent registration; Udyam optional
 *   Builder          GSTIN, PAN
 *   Financier        GSTIN, PAN
 *
 * Precedence over the required checks: nothing submitted → NOT_STARTED; any failed or rejected →
 * REJECTED; any verified check past its validity → EXPIRED; all verified → VERIFIED; otherwise PENDING.
 */
import type { KycStatus, OrganisationType, VerificationCheckStatus, VerificationCheckType } from "@/generated/prisma/enums";

export type RequirementType = Exclude<VerificationCheckType, "E_INVOICE">;

export interface Requirement {
  type: RequirementType;
  required: boolean;
}

export type ItemState = "MISSING" | "PENDING" | "REVIEW" | "VERIFIED" | "EXPIRED" | "FAILED" | "REJECTED" | "ERROR";

export interface CheckSnapshot {
  status: VerificationCheckStatus;
  expiresAt: Date | null;
  checkedAt: Date;
}

export interface RequirementState extends Requirement {
  state: ItemState;
}

export function requirementsFor(type: OrganisationType, gstRegistered: boolean): Requirement[] {
  switch (type) {
    case "CHANNEL_PARTNER":
      return [
        ...(gstRegistered ? [{ type: "GSTIN" as const, required: true }] : []),
        { type: "PAN", required: true },
        { type: "BANK_ACCOUNT", required: true },
        { type: "RERA_AGENT", required: true },
        { type: "UDYAM", required: false },
      ];
    case "BUILDER":
    case "FINANCIER":
      return [
        { type: "GSTIN", required: true },
        { type: "PAN", required: true },
      ];
    case "PLATFORM":
      return [];
  }
}

export function itemState(snapshot: CheckSnapshot | null | undefined, now: Date): ItemState {
  if (!snapshot) return "MISSING";
  switch (snapshot.status) {
    case "VERIFIED":
      return snapshot.expiresAt && snapshot.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : "VERIFIED";
    case "PENDING":
      return "PENDING";
    case "REVIEW_REQUIRED":
      return "REVIEW";
    case "FAILED":
      return "FAILED";
    case "REJECTED":
      return "REJECTED";
    case "ERROR":
      return "ERROR";
  }
}

export function deriveKycStatus(requirements: Requirement[], snapshots: Partial<Record<RequirementType, CheckSnapshot | null>>, now: Date): { status: KycStatus; items: RequirementState[] } {
  const items = requirements.map((requirement) => ({ ...requirement, state: itemState(snapshots[requirement.type], now) }));
  const required = items.filter((item) => item.required);
  let status: KycStatus;
  if (required.length === 0) status = "VERIFIED";
  else if (required.every((item) => item.state === "MISSING")) status = "NOT_STARTED";
  else if (required.some((item) => item.state === "FAILED" || item.state === "REJECTED")) status = "REJECTED";
  else if (required.some((item) => item.state === "EXPIRED")) status = "EXPIRED";
  else if (required.every((item) => item.state === "VERIFIED")) status = "VERIFIED";
  else status = "PENDING";
  return { status, items };
}

/** Latest meaningful check: provider errors never displace an earlier real outcome. */
export function latestSnapshot<T extends CheckSnapshot>(checks: T[]): T | null {
  const sorted = [...checks].sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());
  return sorted.find((check) => check.status !== "ERROR") ?? sorted[0] ?? null;
}
