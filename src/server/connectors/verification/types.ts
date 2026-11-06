/**
 * Normalised verification results. Every provider adapter maps its own response into these shapes,
 * so the KYC workflow never depends on a provider's field names.
 */
import type { NameMatch } from "@/lib/verification/name-match";

export type CheckType = "GSTIN" | "PAN" | "BANK_ACCOUNT" | "UDYAM" | "E_INVOICE";

export interface CallContext {
  requestId?: string;
  /** Unique per call; required by providers that de-duplicate on a caller reference. */
  verificationId?: string;
}

export interface GstinInput {
  gstin: string;
  /** Registered name used for the provider's name match, when supported. */
  name?: string;
}

export interface GstinResult {
  gstin: string;
  status: "ACTIVE" | "CANCELLED" | "SUSPENDED" | "INACTIVE";
  providerStatus: string;
  legalName: string | null;
  tradeName: string | null;
  stateCode: string;
  stateName: string | null;
  /** yyyy-mm-dd */
  registrationDate: string | null;
  constitution: string | null;
  taxpayerType: string | null;
  nameMatch: NameMatch | null;
}

export interface PanInput {
  pan: string;
  name?: string;
}

export interface PanResult {
  pan: string;
  status: "VALID" | "INVALID" | "DELETED" | "DEACTIVATED";
  holderType: string | null;
  registeredName: string | null;
  nameMatch: NameMatch | null;
  aadhaarSeeded: boolean | null;
}

export interface BankAccountInput {
  accountNumber: string;
  ifsc: string;
  name?: string;
}

export type BankAccountStatusCode = "ACCOUNT_VALID" | "INVALID_ACCOUNT" | "ACCOUNT_BLOCKED" | "INVALID_IFSC" | "NRE_ACCOUNT";

export interface BankAccountResult {
  accountLast4: string;
  ifsc: string;
  status: "VALID" | "INVALID";
  statusCode: BankAccountStatusCode;
  beneficiaryName: string | null;
  bankName: string | null;
  branch: string | null;
  city: string | null;
  nameMatch: NameMatch | null;
  /** Bank reference of the penny-drop transfer, when one was made. */
  utr: string | null;
}

export interface UdyamInput {
  udyamNumber: string;
  /** Organisation name, for providers that match it; others ignore it. */
  name?: string;
}

export interface UdyamResult {
  udyamNumber: string;
  status: "ACTIVE" | "CANCELLED";
  enterpriseName: string | null;
  enterpriseType: "MICRO" | "SMALL" | "MEDIUM" | null;
  organisationType: string | null;
  majorActivity: string | null;
  /** yyyy-mm-dd */
  registrationDate: string | null;
  classificationYear: string | null;
}

export interface EInvoiceInput {
  irn: string;
  /** The supplier's GSTIN, when known; narrows the lookup at providers that accept it. */
  supplierGstin?: string;
}

export interface EInvoiceResult {
  irn: string;
  status: "ACTIVE" | "CANCELLED";
  ackNumber: string | null;
  /** ISO timestamp as reported by the portal (IST). */
  ackDate: string | null;
  ewayBillNumber: string | null;
  sellerGstin: string | null;
  buyerGstin: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  /** Total invoice value in paise, as a decimal string. */
  totalValuePaise: string | null;
}

/** What every adapter returns: the normalised result plus provenance for the audit trail. */
export interface ProviderOutcome<T> {
  result: T;
  provider: string;
  providerReference: string | null;
  /** Raw body text, used only to compute the stored hash; never persisted. */
  rawBody: string;
  /** Raw body parsed; persisted only after redaction. */
  rawJson: unknown;
}

export interface GstinVerifier {
  readonly provider: string;
  verifyGstin(input: GstinInput, context?: CallContext): Promise<ProviderOutcome<GstinResult>>;
}

export interface PanVerifier {
  readonly provider: string;
  verifyPan(input: PanInput, context?: CallContext): Promise<ProviderOutcome<PanResult>>;
}

export interface BankAccountVerifier {
  readonly provider: string;
  verifyBankAccount(input: BankAccountInput, context?: CallContext): Promise<ProviderOutcome<BankAccountResult>>;
}

export interface UdyamVerifier {
  readonly provider: string;
  verifyUdyam(input: UdyamInput, context?: CallContext): Promise<ProviderOutcome<UdyamResult>>;
}

export interface EInvoiceVerifier {
  readonly provider: string;
  verifyEInvoice(input: EInvoiceInput, context?: CallContext): Promise<ProviderOutcome<EInvoiceResult>>;
}

export type CheckResultMap = {
  GSTIN: GstinResult;
  PAN: PanResult;
  BANK_ACCOUNT: BankAccountResult;
  UDYAM: UdyamResult;
  E_INVOICE: EInvoiceResult;
};
