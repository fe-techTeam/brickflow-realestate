import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { OrganisationType, RoleKey } from "@/generated/prisma/enums";
import { workspaceForOrgType } from "@/lib/workspaces";
import type { Actor } from "@/server/auth/session";
import { ProviderDownError } from "@/server/connectors/errors";
import { SandboxVerificationProvider } from "@/server/connectors/verification/providers/sandbox";
import { setVerificationProvidersForTesting } from "@/server/connectors/verification/registry";
import type { CallContext, GstinInput, PanInput } from "@/server/connectors/verification/types";
import { decryptField, ENCRYPTION_CONTEXT } from "@/server/crypto/field-encryption";
import { db } from "@/server/db";
import { onPayoutAccountChanged, type PayoutAccountChangedEvent } from "@/server/kyc/events";
import { acceptOffer, approveFinancingRequest, generateOffer, initiateDisbursement } from "@/server/services/financing";
import {
  assertCpEligibleForPayout,
  getKycDocumentForActor,
  getVerificationOverview,
  listKycReviewQueue,
  payoutEligibility,
  recomputeKycStatuses,
  reraExpiryReminders,
  reviewVerificationCheck,
  setPrimaryBankAccount,
  submitBankAccount,
  submitGstin,
  submitPan,
  submitReraRegistration,
  submitUdyam,
  verifyInvoiceIrn,
} from "@/server/services/kyc";
import { acceptedInvoice, actors, expectDomainError, expectValidationError, type DemoUser } from "./helpers";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

let as: Record<DemoUser, Actor>;

beforeAll(async () => {
  as = await actors();
});

afterEach(() => {
  vi.unstubAllEnvs();
  setVerificationProvidersForTesting({});
});

/** GSTIN with a valid check character for the given PAN. */
function gstinFor(pan: string, state = "27"): string {
  const charset = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const first14 = `${state}${pan}1Z`;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = charset.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return `${first14}${charset[(36 - (sum % 36)) % 36]}`;
}

let orgSerial = 0;

/** A brand-new organisation with one member, as `getActor()` would build it. */
async function freshOrganisation(type: OrganisationType = "CHANNEL_PARTNER", legalName = "Harbourline Realty Advisors LLP"): Promise<Actor> {
  orgSerial += 1;
  const roleKey: RoleKey = type === "CHANNEL_PARTNER" ? "CP_ADMIN" : type === "BUILDER" ? "BUILDER_ACCOUNTS" : type === "FINANCIER" ? "FINANCE_OPS" : "SUPER_ADMIN";
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const tag = randomUUID().slice(0, 8);
  const org = await db.organisation.create({ data: { type, name: legalName.replace(/ LLP$/, ""), legalName } });
  const user = await db.user.create({
    data: { email: `kyc-${tag}@example.test`, name: `KYC Tester ${orgSerial}`, passwordHash: "x", memberships: { create: { organisationId: org.id, roleId: role.id } } },
    include: { memberships: true },
  });
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    membershipId: user.memberships[0]!.id,
    orgId: org.id,
    orgName: org.name,
    orgType: type,
    role: roleKey,
    designation: null,
    workspace: workspaceForOrgType(type).key,
  };
}

/** Sandbox wrapper that counts provider calls. */
class CountingSandbox extends SandboxVerificationProvider {
  calls = 0;
  override async verifyGstin(input: GstinInput, context?: CallContext) {
    this.calls += 1;
    return super.verifyGstin(input, context);
  }
  override async verifyPan(input: PanInput, context?: CallContext) {
    this.calls += 1;
    return super.verifyPan(input, context);
  }
}

const inFuture = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

async function completeCpKyc(actor: Actor, pan: string, account: string) {
  await submitGstin(actor, { gstin: gstinFor(pan) });
  await submitPan(actor, { pan });
  await submitBankAccount(actor, { accountNumber: account, confirmAccountNumber: account, ifsc: "HDFC0000123" });
  const rera = await submitReraRegistration(actor, { registrationNumber: `A518000${account.slice(-5)}`, validUntil: inFuture(400) }, null);
  await reviewVerificationCheck(as.admin, rera.checkId, { decision: "APPROVE" });
}

describe("seeded demo organisations", () => {
  it("are KYC verified with encrypted PAN and a verified primary payout account", async () => {
    const prestige = await db.organisation.findUniqueOrThrow({ where: { id: as.prestige.orgId }, include: { bankAccounts: true } });
    expect(prestige.kycStatus).toBe("VERIFIED");
    expect(prestige.panMasked).toBe("AA•••••05H");
    expect(decryptField(prestige.panEncrypted!, ENCRYPTION_CONTEXT.organisationPan(prestige.id))).toBe("AAPFP9005H");
    expect(prestige.bankAccounts).toHaveLength(1);
    expect(prestige.bankAccounts[0]).toMatchObject({ isPrimary: true, verificationStatus: "VERIFIED", accountNumberLast4: "9005" });
    expect(prestige.bankAccounts[0]!.accountNumberEncrypted).not.toContain("500100099005");
    expect(await payoutEligibility(as.prestige.orgId)).toMatchObject({ eligible: true, reasons: [] });
    expect((await db.organisation.findUniqueOrThrow({ where: { id: as.godrej.orgId } })).kycStatus).toBe("VERIFIED");
  });

  it("show a complete overview to the partner", async () => {
    const overview = await getVerificationOverview(as.prestige);
    expect(overview.kycStatus).toBe("VERIFIED");
    expect(overview.items.map((i) => [i.type, i.state])).toEqual([
      ["GSTIN", "VERIFIED"],
      ["PAN", "VERIFIED"],
      ["BANK_ACCOUNT", "VERIFIED"],
      ["RERA_AGENT", "VERIFIED"],
      ["UDYAM", "MISSING"],
    ]);
    expect(overview.bankAccounts[0]).toMatchObject({ maskedNumber: "••••9005", isPrimary: true });
    expect(JSON.stringify(overview)).not.toContain("500100099005");
    // The GSTIN is a public identifier that embeds the PAN; the PAN itself is only ever shown masked.
    expect(JSON.stringify(overview).replaceAll("27AAPFP9005H1Z6", "")).not.toContain("AAPFP9005H");
  });
});

describe("partner submissions", () => {
  it("verifies GSTIN and PAN through the sandbox and stores PAN encrypted", async () => {
    const cp = await freshOrganisation();
    const pan = "AAJFH4321K";
    const gstin = await submitGstin(cp, { gstin: gstinFor(pan).toLowerCase() });
    expect(gstin).toMatchObject({ status: "VERIFIED", reasons: [], kycStatus: "PENDING" });
    const panOutcome = await submitPan(cp, { pan });
    expect(panOutcome.status).toBe("VERIFIED");

    const org = await db.organisation.findUniqueOrThrow({ where: { id: cp.orgId } });
    expect(org).toMatchObject({ gstin: gstinFor(pan), panMasked: "AA•••••21K", pan: null, kycStatus: "PENDING" });
    expect(decryptField(org.panEncrypted!, ENCRYPTION_CONTEXT.organisationPan(org.id))).toBe(pan);

    const check = await db.verificationCheck.findFirstOrThrow({ where: { organisationId: cp.orgId, type: "PAN" } });
    expect(check).toMatchObject({ provider: "sandbox", status: "VERIFIED", inputMasked: "AA•••••21K", nameMatchScore: 100 });
    expect(check.rawResponseHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(check.result)).not.toContain(pan);
    expect(JSON.stringify(check.rawResponseRedacted)).not.toContain(pan);
    expect(check.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 700 * DAY_MS);
  });

  it("rejects malformed identifiers with field errors and never calls the provider", async () => {
    const cp = await freshOrganisation();
    await expectDomainError(submitGstin(cp, { gstin: "27AAJFH4321K1ZZ" }), "VALIDATION", /check digit/);
    await expectDomainError(submitPan(cp, { pan: "1234" }), "VALIDATION");
    await expectValidationError(submitBankAccount(cp, { accountNumber: "123456789012", confirmAccountNumber: "123456789013", ifsc: "HDFC0000123" }), "confirmAccountNumber");
    await expectDomainError(submitBankAccount(cp, { accountNumber: "123456789012", confirmAccountNumber: "123456789012", ifsc: "HDFC1000123" }), "VALIDATION", /IFSC/);
    expect(await db.verificationCheck.count({ where: { organisationId: cp.orgId } })).toBe(0);
  });

  it("records a failed check when the record does not exist", async () => {
    const cp = await freshOrganisation();
    const outcome = await submitGstin(cp, { gstin: gstinFor("AAJFH0000K") });
    expect(outcome).toMatchObject({ status: "FAILED", reasons: ["No GST registration exists for this GSTIN."], kycStatus: "REJECTED" });
    expect((await db.organisation.findUniqueOrThrow({ where: { id: cp.orgId } })).gstin).toBeNull();
  });

  it("persists an ERROR check and asks the user to retry when the provider is down", async () => {
    const cp = await freshOrganisation();
    await expectDomainError(submitPan(cp, { pan: "AAJFH5555K" }), "CONFLICT", /temporarily unavailable/);
    const check = await db.verificationCheck.findFirstOrThrow({ where: { organisationId: cp.orgId } });
    expect(check).toMatchObject({ status: "ERROR", errorKind: "PROVIDER_DOWN" });
    expect((await db.organisation.findUniqueOrThrow({ where: { id: cp.orgId } })).kycStatus).toBe("NOT_STARTED");
  });

  it("serves an identical request from cache within the TTL", async () => {
    const counting = new CountingSandbox();
    setVerificationProvidersForTesting({ gstin: counting, pan: counting });
    const cp = await freshOrganisation();
    await submitPan(cp, { pan: "AAJFH2468K" });
    const again = await submitPan(cp, { pan: "AAJFH2468K" });
    expect(counting.calls).toBe(1);
    expect(again.status).toBe("VERIFIED");
    const checks = await db.verificationCheck.findMany({ where: { organisationId: cp.orgId, type: "PAN" }, orderBy: { checkedAt: "asc" } });
    expect(checks).toHaveLength(2);
    expect(checks[1]!.cachedFromId).toBe(checks[0]!.id);

    vi.stubEnv("VERIFICATION_CACHE_TTL_HOURS", "0");
    await submitPan(cp, { pan: "AAJFH2468K" });
    expect(counting.calls).toBe(2);
  });

  it("does not share cached results between organisations", async () => {
    const counting = new CountingSandbox();
    setVerificationProvidersForTesting({ pan: counting });
    await submitPan(await freshOrganisation(), { pan: "AAJFH1357K" });
    await submitPan(await freshOrganisation(), { pan: "AAJFH1357K" });
    expect(counting.calls).toBe(2);
  });

  it("lets a channel partner declare it is not GST-registered, but not a builder", async () => {
    const cp = await freshOrganisation();
    await submitGstin(cp, { notRegistered: true });
    const overview = await getVerificationOverview(cp);
    expect(overview.items.map((i) => i.type)).not.toContain("GSTIN");
    const builder = await freshOrganisation("BUILDER", "Northgate Developers Private Limited");
    await expectDomainError(submitGstin(builder, { notRegistered: true }), "VALIDATION", /mandatory/);
  });

  it("verifies a builder with GSTIN and PAN only", async () => {
    const builder = await freshOrganisation("BUILDER", "Northgate Developers Private Limited");
    await submitGstin(builder, { gstin: gstinFor("AAHCN4455Q") });
    const pan = await submitPan(builder, { pan: "AAHCN4455Q" });
    expect(pan.kycStatus).toBe("VERIFIED");
  });

  it("records Udyam as optional for channel partners", async () => {
    const cp = await freshOrganisation();
    const outcome = await submitUdyam(cp, { udyamNumber: "UDYAM-MH-19-0012346" });
    expect(outcome.status).toBe("VERIFIED");
    expect(outcome.kycStatus).toBe("NOT_STARTED");
  });

  it("refuses platform accounts", async () => {
    await expectDomainError(submitPan(as.admin, { pan: "AAJFH2468K" }), "FORBIDDEN");
  });
});

describe("name-match review", () => {
  it("routes a name mismatch to the admin queue, where approval completes it", async () => {
    const cp = await freshOrganisation();
    const outcome = await submitPan(cp, { pan: "AAJFH1111K" });
    expect(outcome.status).toBe("REVIEW_REQUIRED");
    expect(outcome.reasons[0]).toMatch(/SANDBOX UNRELATED TRADERS PRIVATE LIMITED.*below the 80% threshold/);

    const queue = await listKycReviewQueue(as.admin);
    const item = queue.find((q) => q.id === outcome.checkId);
    expect(item).toMatchObject({ type: "PAN", status: "REVIEW_REQUIRED", organisation: { id: cp.orgId } });

    await expectDomainError(reviewVerificationCheck(cp, outcome.checkId, { decision: "APPROVE" }), "FORBIDDEN");
    await expectValidationError(reviewVerificationCheck(as.admin, outcome.checkId, { decision: "REJECT", note: "no" }), "note");
    await reviewVerificationCheck(as.admin, outcome.checkId, { decision: "APPROVE", note: "Trade name confirmed from the partnership deed." });
    const check = await db.verificationCheck.findUniqueOrThrow({ where: { id: outcome.checkId } });
    expect(check).toMatchObject({ status: "VERIFIED", reviewedById: as.admin.userId, reviewNote: "Trade name confirmed from the partnership deed." });
    await expectDomainError(reviewVerificationCheck(as.admin, outcome.checkId, { decision: "REJECT", note: "Changed my mind about this." }), "CONFLICT", /already been decided/);
    expect((await listKycReviewQueue(as.admin)).some((q) => q.id === outcome.checkId)).toBe(false);
    const audit = await db.auditLog.findMany({ where: { entityId: cp.orgId }, select: { action: true } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["kyc.pan_checked", "kyc.check_approved", "kyc.status_changed"]));
  });

  it("rejects with a reason, and hides superseded submissions from the queue", async () => {
    const cp = await freshOrganisation();
    const first = await submitPan(cp, { pan: "AAJFH1111K" });
    const second = await submitPan(cp, { pan: "AAJFH9876K" });
    expect(second.status).toBe("VERIFIED");
    expect((await listKycReviewQueue(as.admin)).some((q) => q.id === first.checkId)).toBe(false);
    await expectDomainError(reviewVerificationCheck(as.admin, first.checkId, { decision: "APPROVE" }), "CONFLICT", /newer submission/);

    const other = await freshOrganisation();
    const mismatch = await submitPan(other, { pan: "AAJFH1111K" });
    await reviewVerificationCheck(as.admin, mismatch.checkId, { decision: "REJECT", note: "Name on PAN belongs to another entity." });
    expect((await db.organisation.findUniqueOrThrow({ where: { id: other.orgId } })).kycStatus).toBe("REJECTED");
  });

  it("honours a configured threshold", async () => {
    vi.stubEnv("KYC_NAME_MATCH_THRESHOLD_PAN", "0");
    expect((await submitPan(await freshOrganisation(), { pan: "AAJFH1111K" })).status).toBe("VERIFIED");
  });
});

describe("bank accounts and change safety", () => {
  it("makes the first verified account the payout account without a cooling-off", async () => {
    const cp = await freshOrganisation();
    const outcome = await submitBankAccount(cp, { accountNumber: "9988776655", confirmAccountNumber: "9988776655", ifsc: "hdfc0000123" });
    expect(outcome.status).toBe("VERIFIED");
    const account = await db.bankAccount.findUniqueOrThrow({ where: { id: outcome.bankAccountId } });
    expect(account).toMatchObject({ isPrimary: true, coolingOffUntil: null, verificationStatus: "VERIFIED", accountNumberLast4: "6655", ifsc: "HDFC0000123", beneficiaryName: "HARBOURLINE REALTY ADVISORS LLP" });
    expect(decryptField(account.accountNumberEncrypted, ENCRYPTION_CONTEXT.bankAccountNumber(cp.orgId))).toBe("9988776655");
    expect((await db.organisation.findUniqueOrThrow({ where: { id: cp.orgId } })).bankAccountNumber).toBe("XXXXXXXX6655");
    await expectDomainError(submitBankAccount(cp, { accountNumber: "9988776655", confirmAccountNumber: "9988776655", ifsc: "HDFC0000123" }), "CONFLICT", /already your verified payout account/);
  });

  it("starts a cooling-off period when the payout account changes, blocks payouts and emits an event", async () => {
    const cp = await freshOrganisation();
    await completeCpKyc(cp, "AAJFH3030K", "1122334455");
    expect(await payoutEligibility(cp.orgId)).toMatchObject({ eligible: true, kycStatus: "VERIFIED" });

    const events: PayoutAccountChangedEvent[] = [];
    const unsubscribe = onPayoutAccountChanged((event) => {
      events.push(event);
    });
    const second = await submitBankAccount(cp, { accountNumber: "5566778899", confirmAccountNumber: "5566778899", ifsc: "ICIC0000456" });
    const before = await db.bankAccount.findUniqueOrThrow({ where: { id: second.bankAccountId } });
    expect(before.isPrimary).toBe(false);

    const now = new Date();
    await setPrimaryBankAccount(cp, second.bankAccountId, { now });
    unsubscribe();
    const after = await db.bankAccount.findUniqueOrThrow({ where: { id: second.bankAccountId } });
    expect(after.isPrimary).toBe(true);
    expect(after.coolingOffUntil!.getTime()).toBe(now.getTime() + 72 * HOUR_MS);
    expect(await db.bankAccount.count({ where: { organisationId: cp.orgId, isPrimary: true } })).toBe(1);
    expect(events).toEqual([expect.objectContaining({ type: "payout_account.changed", organisationId: cp.orgId, previousAccountLast4: "4455", newAccountLast4: "8899", coolingOffUntil: after.coolingOffUntil })]);
    expect((await db.auditLog.findFirstOrThrow({ where: { entityId: cp.orgId, action: "bank_account.primary_changed" } })).summary).toMatch(/••••4455 to ••••8899/);

    const blocked = await payoutEligibility(cp.orgId, new Date(now.getTime() + HOUR_MS));
    expect(blocked.eligible).toBe(false);
    expect(blocked.reasons[0]).toMatch(/changed recently/);
    vi.stubEnv("KYC_ENFORCED", "true");
    await expectDomainError(assertCpEligibleForPayout(cp.orgId, new Date(now.getTime() + HOUR_MS)), "CONFLICT", /changed recently/);
    await assertCpEligibleForPayout(cp.orgId, new Date(now.getTime() + 73 * HOUR_MS));
  });

  it("uses a configurable cooling-off window", async () => {
    vi.stubEnv("PAYOUT_ACCOUNT_COOLING_OFF_HOURS", "24");
    const cp = await freshOrganisation();
    await submitBankAccount(cp, { accountNumber: "7000000123", confirmAccountNumber: "7000000123", ifsc: "HDFC0000123" });
    const now = new Date();
    const second = await submitBankAccount(cp, { accountNumber: "7000000456", confirmAccountNumber: "7000000456", ifsc: "HDFC0000123", makePrimary: true }, { now });
    const account = await db.bankAccount.findUniqueOrThrow({ where: { id: second.bankAccountId } });
    expect(account.isPrimary).toBe(true);
    expect(account.coolingOffUntil!.getTime()).toBe(now.getTime() + 24 * HOUR_MS);
  });

  it("refuses to make an unverified or foreign account primary", async () => {
    const cp = await freshOrganisation();
    const failed = await submitBankAccount(cp, { accountNumber: "8000000000", confirmAccountNumber: "8000000000", ifsc: "HDFC0000123" });
    expect(failed.status).toBe("FAILED");
    await expectDomainError(setPrimaryBankAccount(cp, failed.bankAccountId), "CONFLICT", /Only a verified bank account/);
    const prestigeAccount = await db.bankAccount.findFirstOrThrow({ where: { organisationId: as.prestige.orgId } });
    await expectDomainError(setPrimaryBankAccount(cp, prestigeAccount.id), "NOT_FOUND");
  });

  it("flags an account already registered to another organisation for review", async () => {
    const cp = await freshOrganisation();
    const outcome = await submitBankAccount(cp, { accountNumber: "500100099005", confirmAccountNumber: "500100099005", ifsc: "DEMO0000501" });
    expect(outcome.status).toBe("REVIEW_REQUIRED");
    expect(outcome.reasons).toContain("This bank account is already registered to another organisation on BrickFlow.");
    expect((await db.bankAccount.findUniqueOrThrow({ where: { id: outcome.bankAccountId } })).isPrimary).toBe(false);

    await reviewVerificationCheck(as.admin, outcome.checkId, { decision: "APPROVE", note: "Shared group treasury account confirmed." });
    const approved = await db.bankAccount.findUniqueOrThrow({ where: { id: outcome.bankAccountId } });
    expect(approved).toMatchObject({ verificationStatus: "VERIFIED", isPrimary: true, coolingOffUntil: null });
  });
});

describe("RERA agent registration (manual)", () => {
  it("records the certificate for admin review and serves the document only to its owner and admins", async () => {
    const cp = await freshOrganisation();
    const outcome = await submitReraRegistration(cp, { registrationNumber: "a51800012345", validUntil: inFuture(200) }, { name: "rera.pdf", type: "application/pdf", bytes: PDF });
    expect(outcome).toMatchObject({ status: "PENDING", kycStatus: "PENDING" });
    const check = await db.verificationCheck.findUniqueOrThrow({ where: { id: outcome.checkId }, include: { documents: true } });
    expect(check).toMatchObject({ type: "RERA_AGENT", provider: "manual", inputMasked: "A51800012345", result: { registrationNumber: "A51800012345", mahaRera: true } });
    expect(check.documents).toHaveLength(1);
    const documentId = check.documents[0]!.id;
    expect((await getKycDocumentForActor(cp, documentId)).mimeType).toBe("application/pdf");
    expect((await getKycDocumentForActor(as.admin, documentId)).id).toBe(documentId);
    await expectDomainError(getKycDocumentForActor(as.prestige, documentId), "NOT_FOUND");

    expect((await listKycReviewQueue(as.admin)).find((q) => q.id === outcome.checkId)).toMatchObject({ status: "PENDING", documentId });
  });

  it("validates the expiry date and the certificate file", async () => {
    const cp = await freshOrganisation();
    await expectDomainError(submitReraRegistration(cp, { registrationNumber: "A51800012345", validUntil: inFuture(-1) }, null), "VALIDATION", /expired/);
    await expectDomainError(submitReraRegistration(cp, { registrationNumber: "A51800012345", validUntil: inFuture(30) }, { name: "x.exe", type: "application/octet-stream", bytes: new Uint8Array([1, 2, 3, 4, 5]) }), "VALIDATION", /PDF, PNG or JPEG/);
    await expectDomainError(submitReraRegistration(as.godrej, { registrationNumber: "A51800012345", validUntil: inFuture(30) }, null), "FORBIDDEN");
  });

  it("exposes expiry reminders and expires KYC when the registration lapses", async () => {
    const cp = await freshOrganisation();
    await completeCpKyc(cp, "AAJFH7070K", "3300112244");
    const reraCheck = await db.verificationCheck.findFirstOrThrow({ where: { organisationId: cp.orgId, type: "RERA_AGENT" } });
    await db.verificationCheck.update({ where: { id: reraCheck.id }, data: { expiresAt: new Date(Date.now() + 10 * DAY_MS) } });

    const reminders = await reraExpiryReminders(new Date(), 30);
    expect(reminders.find((r) => r.organisationId === cp.orgId)).toMatchObject({ registrationNumber: reraCheck.inputMasked, daysRemaining: 10, expired: false });
    expect((await reraExpiryReminders(new Date(), 5)).some((r) => r.organisationId === cp.orgId)).toBe(false);

    const later = new Date(Date.now() + 11 * DAY_MS);
    await recomputeKycStatuses(later);
    expect((await db.organisation.findUniqueOrThrow({ where: { id: cp.orgId } })).kycStatus).toBe("EXPIRED");
    expect((await reraExpiryReminders(later, 30)).find((r) => r.organisationId === cp.orgId)).toMatchObject({ expired: true });
    expect((await payoutEligibility(cp.orgId, later)).reasons[0]).toMatch(/expired/);
  });
});

describe("payout gate in the financing service", () => {
  it("is a no-op unless KYC_ENFORCED is on", async () => {
    const cp = await freshOrganisation();
    await assertCpEligibleForPayout(cp.orgId);
    vi.stubEnv("KYC_ENFORCED", "true");
    await expectDomainError(assertCpEligibleForPayout(cp.orgId), "CONFLICT", /Complete your KYC/);
  });

  it("blocks offer acceptance for a partner whose KYC lapsed, and allows it once restored", async () => {
    vi.stubEnv("KYC_ENFORCED", "true");
    const invoice = await acceptedInvoice(as.urbannest, as.godrej, { cp: "urbannest", amount: "250000" });
    const offer = await generateOffer(as.urbannest, invoice.id);

    const panCheck = await db.verificationCheck.findFirstOrThrow({ where: { organisationId: as.urbannest.orgId, type: "PAN" } });
    await db.verificationCheck.update({ where: { id: panCheck.id }, data: { status: "REVIEW_REQUIRED" } });
    await expectDomainError(acceptOffer(as.urbannest, offer.id, { consent: true }), "CONFLICT", /still in progress/);
    expect((await db.financingOffer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("OFFERED");

    await db.verificationCheck.update({ where: { id: panCheck.id }, data: { status: "VERIFIED" } });
    const request = await acceptOffer(as.urbannest, offer.id, { consent: true });
    expect(request.status).toBe("PENDING_APPROVAL");
  });
});

describe("payout release during a payout-account cooling-off", () => {
  it("blocks the financier from initiating a disbursement until the cooling-off ends", async () => {
    const invoice = await acceptedInvoice(as.urbannest, as.skyline, { cp: "urbannest", builder: "skyline", amount: "180000" });
    const offer = await generateOffer(as.urbannest, invoice.id);
    const request = await acceptOffer(as.urbannest, offer.id, { consent: true });
    await approveFinancingRequest(as.finance, request.id, { note: "Within limits." });

    const changed = await submitBankAccount(as.urbannest, { accountNumber: "4455667788", confirmAccountNumber: "4455667788", ifsc: "HDFC0000123", makePrimary: true });
    expect(changed.status).toBe("VERIFIED");
    const account = await db.bankAccount.findUniqueOrThrow({ where: { id: changed.bankAccountId } });
    expect(account.coolingOffUntil).not.toBeNull();

    vi.stubEnv("KYC_ENFORCED", "true");
    await expectDomainError(initiateDisbursement(as.finance, request.id), "CONFLICT", /changed its payout account recently/);
    expect((await db.financingRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("APPROVED");
    expect(await db.disbursement.count({ where: { requestId: request.id } })).toBe(0);

    await db.bankAccount.update({ where: { id: account.id }, data: { coolingOffUntil: new Date(Date.now() - 1000) } });
    const disbursement = await initiateDisbursement(as.finance, request.id);
    expect(disbursement.beneficiaryAccount).toBe("XXXX7788");
  });
});

describe("e-invoice verification", () => {
  it("records an IRN check against the supplier and flags a supplier mismatch", async () => {
    const active = await verifyInvoiceIrn({ organisationId: as.prestige.orgId, irn: "ab".repeat(32), supplierGstin: "27AAPFP9005H1Z6" });
    expect(active.status).toBe("VERIFIED");
    const cancelled = await verifyInvoiceIrn({ organisationId: as.prestige.orgId, irn: `ffff${"a".repeat(60)}` });
    expect(cancelled).toMatchObject({ status: "FAILED", reasons: ["The e-invoice has been cancelled on the Invoice Registration Portal."] });
    const check = await db.verificationCheck.findUniqueOrThrow({ where: { id: active.checkId } });
    expect(check).toMatchObject({ type: "E_INVOICE", subject: "INVOICE", inputMasked: "abababab…ababab" });
    expect((await db.organisation.findUniqueOrThrow({ where: { id: as.prestige.orgId } })).kycStatus).toBe("VERIFIED");
  });

  it("surfaces a provider outage as a retryable error", async () => {
    setVerificationProvidersForTesting({
      eInvoice: {
        provider: "quicko",
        verifyEInvoice: async () => {
          throw new ProviderDownError("down", { provider: "quicko", operation: "e_invoice.verify" });
        },
      },
    });
    await expectDomainError(verifyInvoiceIrn({ organisationId: as.prestige.orgId, irn: "cd".repeat(32) }), "CONFLICT", /temporarily unavailable/);
  });
});
