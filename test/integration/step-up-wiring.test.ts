import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { workspaceForOrgType } from "@/lib/workspaces";
import type { Actor } from "@/server/auth/session";
import { requireStepUp } from "@/server/auth/step-up";
import { totpCode } from "@/server/auth/totp";
import { encryptField, ENCRYPTION_CONTEXT, isEncryptedValue } from "@/server/crypto/field-encryption";
import { db } from "@/server/db";
import { acceptOffer, approveFinancingRequest, completeDisbursement, generateOffer, initiateDisbursement } from "@/server/services/financing";
import { setPrimaryBankAccount, submitBankAccount } from "@/server/services/kyc";
import { verifySecondFactor } from "@/server/services/mfa";
import { confirmStepUp } from "@/server/services/security";
import { acceptedInvoice, actors, DEMO_PASSWORD, expectDomainError, type DemoUser } from "./helpers";
import { createTestUser, enrolMfa, later, openSession, TEST_PASSWORD } from "./security-helpers";

let as: Record<DemoUser, Actor>;

beforeAll(async () => {
  as = await actors();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Moves the session's last confirmation outside the five-minute step-up window. */
async function expireStepUp(sessionId: string) {
  await db.session.update({ where: { id: sessionId }, data: { stepUpAt: new Date(Date.now() - 6 * 60_000) } });
}

/** A partner organisation with a verified primary payout account and a user whose password we know. */
async function partnerWithPayoutAccount(): Promise<Actor> {
  const role = await db.role.findUniqueOrThrow({ where: { key: "CP_ADMIN" } });
  const org = await db.organisation.create({ data: { type: "CHANNEL_PARTNER", name: "Harbourline Realty Advisors", legalName: "Harbourline Realty Advisors LLP" } });
  const user = await db.user.create({
    data: {
      email: `stepup-bank.${randomUUID().slice(0, 8)}@security-test.example`,
      name: "Bank Changer",
      passwordHash: bcrypt.hashSync(TEST_PASSWORD, 4),
      memberships: { create: { organisationId: org.id, roleId: role.id } },
    },
    include: { memberships: true },
  });
  await db.bankAccount.create({
    data: {
      organisationId: org.id,
      accountNumberEncrypted: encryptField("1122334455", ENCRYPTION_CONTEXT.bankAccountNumber(org.id)),
      accountNumberLast4: "4455",
      accountFingerprint: randomUUID(),
      ifsc: "HDFC0000123",
      accountHolderName: org.legalName,
      verificationStatus: "VERIFIED",
      verifiedAt: new Date(),
      isPrimary: true,
      primarySince: new Date(),
    },
  });
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    membershipId: user.memberships[0]!.id,
    orgId: org.id,
    orgName: org.name,
    orgType: "CHANNEL_PARTNER",
    role: "CP_ADMIN",
    designation: null,
    workspace: workspaceForOrgType("CHANNEL_PARTNER").key,
  };
}

describe("step-up policy", () => {
  it("is a no-op for users without an authenticator while MFA is not enforced", async () => {
    vi.stubEnv("MFA_ENFORCED", "false");
    await expect(requireStepUp(as.prestige, "offer.accept")).resolves.toBeUndefined();
    await expect(requireStepUp(as.finance, "payout.release")).resolves.toBeUndefined();
  });

  it("still applies to users who have an authenticator, enforced or not", async () => {
    vi.stubEnv("MFA_ENFORCED", "false");
    const user = await createTestUser("CP_ADMIN", "has-mfa");
    await enrolMfa(user);
    const { actor } = await openSession(user, { mfaVerified: true });
    await expect(requireStepUp(actor, "offer.accept")).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
  });

  it("applies to everyone once MFA is enforced", async () => {
    vi.stubEnv("MFA_ENFORCED", "true");
    await expect(requireStepUp(as.prestige, "offer.accept")).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
  });
});

describe("with MFA enforced, money and payout-detail actions need a fresh step-up", () => {
  it("offer.accept: refused without confirmation, accepted after the partner confirms", async () => {
    vi.stubEnv("MFA_ENFORCED", "true");
    const invoice = await acceptedInvoice(as.prestige, as.godrej);
    const offer = await generateOffer(as.prestige, invoice.id);
    const { actor } = await openSession(as.prestige);

    await expectDomainError(acceptOffer(actor, offer.id, { consent: true }), "STEP_UP_REQUIRED", /accept this early-payment offer/);
    expect((await db.financingOffer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("OFFERED");
    expect(await db.financingRequest.count({ where: { invoiceId: invoice.id } })).toBe(0);

    // Partners without an authenticator confirm with their password.
    await confirmStepUp(actor, "offer.accept", { code: DEMO_PASSWORD });
    const request = await acceptOffer(actor, offer.id, { consent: true });
    expect(request.status).toBe("PENDING_APPROVAL");
  });

  it("payout.release: initiating and completing a disbursement each need a fresh authenticator code", async () => {
    vi.stubEnv("MFA_ENFORCED", "true");
    const invoice = await acceptedInvoice(as.prestige, as.godrej);
    const offer = await generateOffer(as.prestige, invoice.id);
    const request = await acceptOffer(as.prestige, offer.id, { consent: true }).catch(async (error: { code?: string }) => {
      if (error.code !== "STEP_UP_REQUIRED") throw error;
      const { actor } = await openSession(as.prestige);
      await confirmStepUp(actor, "offer.accept", { code: DEMO_PASSWORD });
      return acceptOffer(actor, offer.id, { consent: true });
    });

    const ops = await createTestUser("FINANCE_OPS", "payout");
    const t0 = new Date(Date.now() - 90_000);
    const { secret } = await enrolMfa(ops, t0);
    const { actor, session } = await openSession(ops, { mfaVerified: true });

    // Approval itself does not ask for step-up.
    await approveFinancingRequest(actor, request.id, { note: "Within limits." });

    await expectDomainError(initiateDisbursement(actor, request.id), "STEP_UP_REQUIRED", /release this payout/);
    expect((await db.financingRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("APPROVED");
    await confirmStepUp(actor, "payout.release", { code: totpCode(secret) });
    await initiateDisbursement(actor, request.id);

    await expireStepUp(session.id);
    await expectDomainError(completeDisbursement(actor, request.id), "STEP_UP_REQUIRED");
    expect((await db.financingRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("DISBURSEMENT_INITIATED");
    await confirmStepUp(actor, "payout.release", { code: totpCode(secret, later(new Date(), 1)) });
    await completeDisbursement(actor, request.id);
    expect((await db.financingRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("DISBURSED");
  });

  it("bank.change: adding and switching the payout account need a fresh step-up", async () => {
    vi.stubEnv("MFA_ENFORCED", "true");
    const partner = await partnerWithPayoutAccount();
    const { actor, session } = await openSession(partner);
    // Unique per run, so it is never "already registered to another organisation".
    const accountNumber = `6${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
    const input = { accountNumber, confirmAccountNumber: accountNumber, ifsc: "ICIC0000456" };

    await expectDomainError(submitBankAccount(actor, input), "STEP_UP_REQUIRED", /change bank account details/);
    expect(await db.bankAccount.count({ where: { organisationId: partner.orgId } })).toBe(1);

    await confirmStepUp(actor, "bank.change", { code: TEST_PASSWORD });
    const added = await submitBankAccount(actor, input);
    expect(added.status).toBe("VERIFIED");

    await expireStepUp(session.id);
    await expectDomainError(setPrimaryBankAccount(actor, added.bankAccountId), "STEP_UP_REQUIRED");
    expect((await db.bankAccount.findUniqueOrThrow({ where: { id: added.bankAccountId } })).isPrimary).toBe(false);
    await confirmStepUp(actor, "bank.change", { code: TEST_PASSWORD });
    await setPrimaryBankAccount(actor, added.bankAccountId);
    expect((await db.bankAccount.findUniqueOrThrow({ where: { id: added.bankAccountId } })).isPrimary).toBe(true);
  });
});

describe("authenticator secrets stored in the earlier format", () => {
  it("still verify, and are re-encrypted in the current format on first use", async () => {
    const key = randomBytes(32);
    vi.stubEnv("DATA_ENCRYPTION_KEY", key.toString("base64"));
    const user = await createTestUser("CP_ADMIN", "legacy-secret");
    const t0 = new Date(Date.now() - 120_000);
    const { secret } = await enrolMfa(user, t0);
    // Rewrite the stored secret as the earlier `v1.` payload under the same key.
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(ENCRYPTION_CONTEXT.totpSecret(user.userId), "utf8"));
    const ct = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const legacy = ["v1", iv.toString("base64url"), ct.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
    await db.user.update({ where: { id: user.userId }, data: { mfaSecret: legacy } });

    await expect(verifySecondFactor(user.userId, totpCode(secret), { allowRecoveryCode: false })).resolves.toBe("totp");
    const stored = (await db.user.findUniqueOrThrow({ where: { id: user.userId } })).mfaSecret!;
    expect(isEncryptedValue(stored)).toBe(true);
    expect(stored.startsWith("enc:v1:")).toBe(true);
  });
});
