/**
 * Turns a normalised provider result into a check outcome. Pure: no I/O, so every rule is unit-tested.
 *
 *   VERIFIED         the record is valid and every rule passed
 *   REVIEW_REQUIRED  the record is valid but a rule (name match, PAN linkage, duplicate account) needs an admin
 *   FAILED           the record is invalid, cancelled or blocked
 */
import { matchNames, type NameMatch } from "@/lib/verification/name-match";
import { panFromGstin } from "@/lib/verification/validation";
import type { BankAccountResult, EInvoiceResult, GstinResult, PanResult, UdyamResult } from "../connectors/verification/types";

export interface OrganisationNames {
  legalName: string;
  name: string;
  pan?: string | null;
}

export interface Evaluation {
  status: "VERIFIED" | "REVIEW_REQUIRED" | "FAILED";
  reasons: string[];
  nameMatch: NameMatch | null;
}

function best(...matches: (NameMatch | null)[]): NameMatch | null {
  return matches.reduce<NameMatch | null>((top, match) => (match && (!top || match.score > top.score) ? match : top), null);
}

function nameRule(label: string, registered: string | null, match: NameMatch | null, threshold: number, reasons: string[]): boolean {
  if (!registered) {
    reasons.push(`The ${label} did not return a registered name to compare.`);
    return false;
  }
  if (!match || match.score < threshold) {
    reasons.push(`The ${label} name "${registered}" matches the organisation name at ${match?.score ?? 0}%, below the ${threshold}% threshold.`);
    return false;
  }
  return true;
}

function outcome(passed: boolean, reasons: string[], nameMatch: NameMatch | null): Evaluation {
  return { status: passed ? "VERIFIED" : "REVIEW_REQUIRED", reasons, nameMatch };
}

export function evaluateGstin(result: GstinResult, org: OrganisationNames, threshold: number): Evaluation {
  const candidates = [org.legalName, org.name];
  const nameMatch = best(result.nameMatch, matchNames(result.legalName, candidates), matchNames(result.tradeName, candidates));
  if (result.status !== "ACTIVE") {
    return { status: "FAILED", reasons: [`The GST registration is ${result.providerStatus.toLowerCase()}.`], nameMatch };
  }
  const reasons: string[] = [];
  let passed = nameRule("GST registration", result.legalName ?? result.tradeName, nameMatch, threshold, reasons);
  if (org.pan && panFromGstin(result.gstin) !== org.pan) {
    reasons.push("The PAN inside this GSTIN differs from the PAN on file for the organisation.");
    passed = false;
  }
  return outcome(passed, reasons, nameMatch);
}

export function evaluatePan(result: PanResult, org: OrganisationNames, threshold: number): Evaluation {
  const nameMatch = best(result.nameMatch, matchNames(result.registeredName, [org.legalName, org.name]));
  if (result.status !== "VALID") {
    return { status: "FAILED", reasons: [`The Income Tax Department reports this PAN as ${result.status.toLowerCase()}.`], nameMatch };
  }
  const reasons: string[] = [];
  return outcome(nameRule("PAN", result.registeredName, nameMatch, threshold, reasons), reasons, nameMatch);
}

const BANK_FAILURE: Record<Exclude<BankAccountResult["statusCode"], "ACCOUNT_VALID">, string> = {
  INVALID_ACCOUNT: "The bank reports that this account number does not exist.",
  ACCOUNT_BLOCKED: "The bank reports that this account is blocked or frozen.",
  INVALID_IFSC: "The IFSC is not valid for this account.",
  NRE_ACCOUNT: "NRE accounts cannot receive payouts.",
};

export function evaluateBankAccount(result: BankAccountResult, org: OrganisationNames, threshold: number, options: { usedByOtherOrganisations?: number } = {}): Evaluation {
  const nameMatch = best(result.nameMatch, matchNames(result.beneficiaryName, [org.legalName, org.name]));
  if (result.status !== "VALID" || result.statusCode !== "ACCOUNT_VALID") {
    const code = result.statusCode === "ACCOUNT_VALID" ? "INVALID_ACCOUNT" : result.statusCode;
    return { status: "FAILED", reasons: [BANK_FAILURE[code]], nameMatch };
  }
  const reasons: string[] = [];
  let passed = nameRule("bank account holder", result.beneficiaryName, nameMatch, threshold, reasons);
  if ((options.usedByOtherOrganisations ?? 0) > 0) {
    reasons.push("This bank account is already registered to another organisation on BrickFlow.");
    passed = false;
  }
  return outcome(passed, reasons, nameMatch);
}

export function evaluateUdyam(result: UdyamResult, org: OrganisationNames, threshold: number): Evaluation {
  const nameMatch = matchNames(result.enterpriseName, [org.legalName, org.name]);
  if (result.status !== "ACTIVE") return { status: "FAILED", reasons: ["The Udyam registration has been cancelled."], nameMatch };
  const reasons: string[] = [];
  return outcome(nameRule("Udyam registration", result.enterpriseName, nameMatch, threshold, reasons), reasons, nameMatch);
}

export function evaluateEInvoice(result: EInvoiceResult, expected: { supplierGstin?: string | null; buyerGstin?: string | null } = {}): Evaluation {
  if (result.status !== "ACTIVE") return { status: "FAILED", reasons: ["The e-invoice has been cancelled on the Invoice Registration Portal."], nameMatch: null };
  const reasons: string[] = [];
  if (expected.supplierGstin && result.sellerGstin && result.sellerGstin !== expected.supplierGstin) reasons.push("The e-invoice was issued by a different supplier GSTIN.");
  if (expected.buyerGstin && result.buyerGstin && result.buyerGstin !== expected.buyerGstin) reasons.push("The e-invoice was issued to a different recipient GSTIN.");
  return outcome(reasons.length === 0, reasons, null);
}
