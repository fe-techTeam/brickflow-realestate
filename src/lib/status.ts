import type {
  DisbursementStatus,
  FinancingStatus,
  InvoiceStatus,
  OfferStatus,
  ProgrammeStatus,
  RecordStatus,
  SettlementStatus,
} from "@/generated/prisma/enums";

export type StatusTone = "neutral" | "info" | "warning" | "success" | "danger" | "kota" | "basalt";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
}

export const INVOICE_STATUS: Record<InvoiceStatus, StatusMeta> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SUBMITTED: { label: "Pending approval", tone: "info" },
  UNDER_REVIEW: { label: "Under review", tone: "basalt" },
  CLARIFICATION_REQUESTED: { label: "Clarification requested", tone: "warning" },
  REJECTED: { label: "Rejected", tone: "danger" },
  ACCEPTED: { label: "Accepted", tone: "success" },
};

export const FINANCING_STATUS: Record<FinancingStatus, StatusMeta> = {
  NOT_REQUESTED: { label: "Not requested", tone: "neutral" },
  REQUESTED: { label: "Requested", tone: "info" },
  OFFER_GENERATED: { label: "Offer generated", tone: "kota" },
  ACCEPTED_BY_CP: { label: "Accepted by CP", tone: "info" },
  PENDING_APPROVAL: { label: "Pending Veefin approval", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  DISBURSEMENT_INITIATED: { label: "Disbursement initiated", tone: "basalt" },
  DISBURSED: { label: "Disbursed", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

export const SETTLEMENT_STATUS: Record<SettlementStatus, StatusMeta> = {
  NOT_DUE: { label: "Not due", tone: "neutral" },
  DUE: { label: "Due", tone: "warning" },
  SETTLED: { label: "Settled", tone: "success" },
  OVERDUE: { label: "Overdue", tone: "danger" },
};

export const PROGRAMME_STATUS: Record<ProgrammeStatus, StatusMeta> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ACTIVE: { label: "Active", tone: "success" },
  SUSPENDED: { label: "Suspended", tone: "warning" },
  CLOSED: { label: "Closed", tone: "danger" },
};

export const OFFER_STATUS: Record<OfferStatus, StatusMeta> = {
  OFFERED: { label: "Open offer", tone: "kota" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  SUPERSEDED: { label: "Superseded", tone: "neutral" },
};

export const DISBURSEMENT_STATUS: Record<DisbursementStatus, StatusMeta> = {
  INITIATED: { label: "Processing (demo)", tone: "basalt" },
  SUCCESS: { label: "Paid (demo)", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
};

export const RECORD_STATUS: Record<RecordStatus, StatusMeta> = {
  ACTIVE: { label: "Active", tone: "success" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
};

/** Financing statuses at which the CP has an in-flight or completed request. */
export const FINANCING_IN_FLIGHT: FinancingStatus[] = [
  "ACCEPTED_BY_CP",
  "PENDING_APPROVAL",
  "APPROVED",
  "DISBURSEMENT_INITIATED",
  "DISBURSED",
];
