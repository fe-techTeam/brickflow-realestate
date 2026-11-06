import type { VerificationCheckType } from "@/generated/prisma/enums";

export interface Fact {
  label: string;
  value: string;
}

const LABELS: Record<VerificationCheckType, string> = {
  GSTIN: "GST registration",
  PAN: "PAN",
  BANK_ACCOUNT: "Payout bank account",
  UDYAM: "Udyam (MSME) registration",
  E_INVOICE: "E-invoice (IRN)",
  RERA_AGENT: "RERA agent registration",
};

export function checkLabel(type: VerificationCheckType): string {
  return LABELS[type];
}

const PROVIDER_LABELS: Record<string, string> = {
  sandbox: "Verification sandbox",
  cashfree: "Cashfree Secure ID",
  quicko: "Sandbox.co.in e-invoice",
  manual: "Manual review",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

/** Human-readable facts from a stored normalised result, for the partner and admin screens. */
export function describeResult(type: VerificationCheckType, result: unknown): Fact[] {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  const facts: [string, string | null][] = [];
  switch (type) {
    case "GSTIN":
      facts.push(["Legal name", text(r.legalName)], ["Trade name", text(r.tradeName)], ["Status", text(r.providerStatus)], ["State", text(r.stateName)], ["Registered on", text(r.registrationDate)]);
      break;
    case "PAN":
      facts.push(["Name on PAN", text(r.registeredName)], ["Holder type", text(r.holderType)], ["Status", r.status ? titleCase(String(r.status)) : null]);
      break;
    case "BANK_ACCOUNT":
      facts.push(["Name at bank", text(r.beneficiaryName)], ["Bank", text(r.bankName)], ["Branch", text(r.branch)], ["IFSC", text(r.ifsc)]);
      break;
    case "UDYAM":
      facts.push(["Enterprise", text(r.enterpriseName)], ["Category", r.enterpriseType ? titleCase(String(r.enterpriseType)) : null], ["Status", r.status ? titleCase(String(r.status)) : null], ["Registered on", text(r.registrationDate)]);
      break;
    case "E_INVOICE":
      facts.push(["Status", r.status ? titleCase(String(r.status)) : null], ["Acknowledgement", text(r.ackNumber)], ["Acknowledged", text(r.ackDate)], ["Supplier GSTIN", text(r.sellerGstin)]);
      break;
    case "RERA_AGENT":
      facts.push(["Registration number", text(r.registrationNumber)], ["Valid until", text(r.validUntil)], ["Authority", r.mahaRera ? "MahaRERA" : text(r.authority)]);
      break;
  }
  return facts.filter((fact): fact is [string, string] => fact[1] !== null).map(([label, value]) => ({ label, value }));
}
