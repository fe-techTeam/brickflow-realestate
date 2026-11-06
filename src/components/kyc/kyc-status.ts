import type { BankAccountStatus, KycStatus, VerificationCheckStatus } from "@/generated/prisma/enums";
import type { StatusMeta } from "@/lib/status";

export const KYC_STATUS: Record<KycStatus, StatusMeta> = {
  NOT_STARTED: { label: "Not started", tone: "neutral" },
  PENDING: { label: "In progress", tone: "info" },
  VERIFIED: { label: "Verified", tone: "success" },
  REJECTED: { label: "Action needed", tone: "danger" },
  EXPIRED: { label: "Expired", tone: "warning" },
};

export type RequirementStateKey = "MISSING" | "PENDING" | "REVIEW" | "VERIFIED" | "EXPIRED" | "FAILED" | "REJECTED" | "ERROR";

export const REQUIREMENT_STATE: Record<RequirementStateKey, StatusMeta> = {
  MISSING: { label: "Not submitted", tone: "neutral" },
  PENDING: { label: "Awaiting review", tone: "info" },
  REVIEW: { label: "Under review", tone: "warning" },
  VERIFIED: { label: "Verified", tone: "success" },
  EXPIRED: { label: "Expired", tone: "warning" },
  FAILED: { label: "Not verified", tone: "danger" },
  REJECTED: { label: "Rejected", tone: "danger" },
  ERROR: { label: "Retry needed", tone: "warning" },
};

export const CHECK_STATUS: Record<VerificationCheckStatus, StatusMeta> = {
  PENDING: { label: "Awaiting review", tone: "info" },
  VERIFIED: { label: "Verified", tone: "success" },
  REVIEW_REQUIRED: { label: "Needs review", tone: "warning" },
  FAILED: { label: "Not verified", tone: "danger" },
  REJECTED: { label: "Rejected", tone: "danger" },
  ERROR: { label: "Provider error", tone: "warning" },
};

export const BANK_ACCOUNT_STATUS: Record<BankAccountStatus, StatusMeta> = {
  UNVERIFIED: { label: "Not verified", tone: "neutral" },
  VERIFIED: { label: "Verified", tone: "success" },
  REVIEW_REQUIRED: { label: "Under review", tone: "warning" },
  FAILED: { label: "Not verified", tone: "danger" },
  REJECTED: { label: "Rejected", tone: "danger" },
};
