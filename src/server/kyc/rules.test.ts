import { describe, expect, it } from "vitest";
import type { BankAccountResult, GstinResult, PanResult, UdyamResult } from "../connectors/verification/types";
import { kycEnforced, kycPolicy } from "./config";
import { evaluateBankAccount, evaluateEInvoice, evaluateGstin, evaluatePan, evaluateUdyam } from "./evaluate";
import { deriveKycStatus, latestSnapshot, requirementsFor, type CheckSnapshot } from "./status";

const ORG = { legalName: "Prestige Realty Partners LLP (Demo)", name: "Prestige Realty Partners", pan: "AAPFP9005H" };

const GSTIN: GstinResult = {
  gstin: "27AAPFP9005H1ZX",
  status: "ACTIVE",
  providerStatus: "Active",
  legalName: "PRESTIGE REALTY PARTNERS LLP",
  tradeName: "PRESTIGE REALTY",
  stateCode: "27",
  stateName: "Maharashtra",
  registrationDate: "2019-04-01",
  constitution: "Limited Liability Partnership",
  taxpayerType: "Regular",
  nameMatch: null,
};

const PAN: PanResult = { pan: "AAPFP9005H", status: "VALID", holderType: "Firm", registeredName: "PRESTIGE REALTY PARTNERS LLP", nameMatch: null, aadhaarSeeded: null };

const BANK: BankAccountResult = {
  accountLast4: "9005",
  ifsc: "HDFC0000001",
  status: "VALID",
  statusCode: "ACCOUNT_VALID",
  beneficiaryName: "PRESTIGE REALTY PARTNERS",
  bankName: "HDFC BANK",
  branch: "ANDHERI",
  city: "MUMBAI",
  nameMatch: null,
  utr: "404223241811",
};

describe("check evaluation", () => {
  it("verifies an active GSTIN whose name and PAN match", () => {
    expect(evaluateGstin(GSTIN, ORG, 80)).toMatchObject({ status: "VERIFIED", reasons: [], nameMatch: { score: 100 } });
  });

  it("fails a cancelled GSTIN and routes a name or PAN mismatch to review", () => {
    expect(evaluateGstin({ ...GSTIN, status: "CANCELLED", providerStatus: "Cancelled" }, ORG, 80)).toMatchObject({ status: "FAILED", reasons: ["The GST registration is cancelled."] });
    const renamed = evaluateGstin({ ...GSTIN, legalName: "OTHER BUILDERS PVT LTD", tradeName: null }, ORG, 80);
    expect(renamed.status).toBe("REVIEW_REQUIRED");
    expect(renamed.reasons[0]).toMatch(/below the 80% threshold/);
    expect(evaluateGstin(GSTIN, { ...ORG, pan: "AAPFP1234H" }, 80)).toMatchObject({ status: "REVIEW_REQUIRED", reasons: [expect.stringMatching(/PAN inside this GSTIN/)] });
  });

  it("applies the configured threshold to provider scores", () => {
    const partial = { ...PAN, registeredName: "PRESTIGE R P", nameMatch: { score: 72, band: "PARTIAL" as const, source: "provider" as const } };
    expect(evaluatePan(partial, { ...ORG, legalName: "zzz", name: "zzz" }, 70).status).toBe("VERIFIED");
    expect(evaluatePan(partial, { ...ORG, legalName: "zzz", name: "zzz" }, 80).status).toBe("REVIEW_REQUIRED");
    expect(evaluatePan({ ...PAN, status: "DELETED" }, ORG, 80)).toMatchObject({ status: "FAILED" });
    expect(evaluatePan({ ...PAN, registeredName: null }, ORG, 80).status).toBe("REVIEW_REQUIRED");
  });

  it("verifies a matching bank account, fails invalid ones and flags shared accounts", () => {
    expect(evaluateBankAccount(BANK, ORG, 80).status).toBe("VERIFIED");
    expect(evaluateBankAccount({ ...BANK, status: "INVALID", statusCode: "ACCOUNT_BLOCKED", beneficiaryName: null }, ORG, 80)).toMatchObject({
      status: "FAILED",
      reasons: ["The bank reports that this account is blocked or frozen."],
    });
    expect(evaluateBankAccount({ ...BANK, beneficiaryName: "RAMESH KUMAR" }, ORG, 80).status).toBe("REVIEW_REQUIRED");
    expect(evaluateBankAccount(BANK, ORG, 80, { usedByOtherOrganisations: 1 })).toMatchObject({
      status: "REVIEW_REQUIRED",
      reasons: ["This bank account is already registered to another organisation on BrickFlow."],
    });
  });

  it("evaluates Udyam and e-invoice results", () => {
    const udyam: UdyamResult = { udyamNumber: "UDYAM-MH-12-1234567", status: "ACTIVE", enterpriseName: "PRESTIGE REALTY PARTNERS", enterpriseType: "MICRO", organisationType: null, majorActivity: null, registrationDate: null, classificationYear: null };
    expect(evaluateUdyam(udyam, ORG, 80).status).toBe("VERIFIED");
    expect(evaluateUdyam({ ...udyam, status: "CANCELLED" }, ORG, 80).status).toBe("FAILED");
    const invoice = { irn: "a".repeat(64), status: "ACTIVE" as const, ackNumber: "1", ackDate: null, ewayBillNumber: null, sellerGstin: "27AAPFP9005H1ZX", buyerGstin: null, documentNumber: null, documentDate: null, totalValuePaise: null };
    expect(evaluateEInvoice(invoice, { supplierGstin: "27AAPFP9005H1ZX" }).status).toBe("VERIFIED");
    expect(evaluateEInvoice(invoice, { supplierGstin: "29AAICP2912R1ZR" }).status).toBe("REVIEW_REQUIRED");
    expect(evaluateEInvoice({ ...invoice, status: "CANCELLED" }).status).toBe("FAILED");
  });
});

describe("KYC status derivation", () => {
  const now = new Date("2026-11-06T10:00:00Z");
  const at = (days: number) => new Date(now.getTime() + days * 86_400_000);
  const snap = (status: CheckSnapshot["status"], expiresInDays = 100, checkedDaysAgo = 1): CheckSnapshot => ({ status, expiresAt: at(expiresInDays), checkedAt: at(-checkedDaysAgo) });
  const cp = requirementsFor("CHANNEL_PARTNER", true);

  it("lists the required checks per organisation type", () => {
    expect(cp).toEqual([
      { type: "GSTIN", required: true },
      { type: "PAN", required: true },
      { type: "BANK_ACCOUNT", required: true },
      { type: "RERA_AGENT", required: true },
      { type: "UDYAM", required: false },
    ]);
    expect(requirementsFor("CHANNEL_PARTNER", false).map((r) => r.type)).not.toContain("GSTIN");
    expect(requirementsFor("BUILDER", false)).toEqual([
      { type: "GSTIN", required: true },
      { type: "PAN", required: true },
    ]);
    expect(requirementsFor("FINANCIER", true).every((r) => r.required)).toBe(true);
  });

  it("derives each status with the documented precedence", () => {
    const all = { GSTIN: snap("VERIFIED"), PAN: snap("VERIFIED"), BANK_ACCOUNT: snap("VERIFIED"), RERA_AGENT: snap("VERIFIED") };
    expect(deriveKycStatus(cp, {}, now).status).toBe("NOT_STARTED");
    expect(deriveKycStatus(cp, all, now).status).toBe("VERIFIED");
    expect(deriveKycStatus(cp, { ...all, UDYAM: snap("FAILED") }, now).status).toBe("VERIFIED");
    expect(deriveKycStatus(cp, { ...all, RERA_AGENT: snap("PENDING") }, now).status).toBe("PENDING");
    expect(deriveKycStatus(cp, { ...all, PAN: snap("REVIEW_REQUIRED") }, now).status).toBe("PENDING");
    expect(deriveKycStatus(cp, { GSTIN: snap("VERIFIED") }, now).status).toBe("PENDING");
    expect(deriveKycStatus(cp, { ...all, BANK_ACCOUNT: snap("VERIFIED", -1) }, now).status).toBe("EXPIRED");
    expect(deriveKycStatus(cp, { ...all, BANK_ACCOUNT: snap("VERIFIED", -1), PAN: snap("REJECTED") }, now).status).toBe("REJECTED");
    expect(deriveKycStatus(cp, { ...all, GSTIN: snap("FAILED") }, now).status).toBe("REJECTED");
    expect(deriveKycStatus(requirementsFor("PLATFORM", false), {}, now).status).toBe("VERIFIED");
  });

  it("does not let a provider error displace an earlier outcome", () => {
    const verified = snap("VERIFIED", 100, 5);
    const error = snap("ERROR", 0, 1);
    expect(latestSnapshot([verified, error])).toBe(verified);
    expect(latestSnapshot([error])).toBe(error);
    expect(latestSnapshot([])).toBeNull();
  });
});

describe("KYC policy", () => {
  it("reads thresholds and windows from the environment with validation", () => {
    expect(kycPolicy({}).nameMatchThreshold.BANK_ACCOUNT).toBe(80);
    expect(kycPolicy({ KYC_NAME_MATCH_THRESHOLD: "70", KYC_NAME_MATCH_THRESHOLD_PAN: "90" }).nameMatchThreshold).toMatchObject({ GSTIN: 70, PAN: 90 });
    expect(kycPolicy({ PAYOUT_ACCOUNT_COOLING_OFF_HOURS: "48" }).coolingOffHours).toBe(48);
    expect(() => kycPolicy({ KYC_NAME_MATCH_THRESHOLD: "101" })).toThrow(/between 0 and 100/);
  });

  it("enforces KYC by default only in production", () => {
    expect(kycEnforced({ NODE_ENV: "production" })).toBe(true);
    expect(kycEnforced({ NODE_ENV: "test" })).toBe(false);
    expect(kycEnforced({ NODE_ENV: "production", KYC_ENFORCED: "false" })).toBe(false);
    expect(kycEnforced({ NODE_ENV: "development", KYC_ENFORCED: "true" })).toBe(true);
    expect(() => kycEnforced({ KYC_ENFORCED: "maybe" })).toThrow();
  });
});
