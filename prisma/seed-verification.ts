/**
 * Seeds KYC state for the demonstration datasets: every organisation gets sandbox-provider checks
 * recorded as VERIFIED, its PAN stored encrypted, and its bank account (if any) registered as a
 * verified primary payout account, so the early-payment flow works with KYC enforcement on.
 */
import { createHash } from "node:crypto";
import type { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { maskAccountNumber, maskGstin, maskPan } from "../src/lib/verification/masking";
import { gstStateName, isMahaReraAgentNumber, panHolderType } from "../src/lib/verification/validation";
import { encryptField, ENCRYPTION_CONTEXT, fingerprintField } from "../src/server/crypto/field-encryption";

const DAY = 24 * 60 * 60 * 1000;
const PROVIDER = "sandbox";

const VALIDITY_DAYS = { GSTIN: 180, PAN: 730, BANK_ACCOUNT: 365 } as const;

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const reference = (key: string) => `SBX-${hash(key).slice(0, 12).toUpperCase()}`;
const fingerprint = (type: string, cacheKey: string) => fingerprintField(`${type}|${cacheKey}`, "verification-input");
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export async function seedVerification(db: PrismaClient, now: Date): Promise<void> {
  const organisations = await db.organisation.findMany({ where: { type: { not: "PLATFORM" } } });
  const checkedAt = new Date(now.getTime() - 7 * DAY);
  const expires = (days: number) => new Date(checkedAt.getTime() + days * DAY);

  for (const org of organisations) {
    const checks: Prisma.VerificationCheckUncheckedCreateInput[] = [];
    const base = { organisationId: org.id, provider: PROVIDER, status: "VERIFIED" as const, nameMatchScore: 100, checkedAt, createdAt: checkedAt };

    if (org.gstin) {
      const result = {
        gstin: org.gstin,
        status: "ACTIVE",
        providerStatus: "Active",
        legalName: org.legalName.toUpperCase(),
        tradeName: org.name.toUpperCase(),
        stateCode: org.gstin.slice(0, 2),
        stateName: gstStateName(org.gstin),
        registrationDate: "2019-04-01",
        constitution: panHolderType(org.gstin.slice(2, 12)),
        taxpayerType: "Regular",
        nameMatch: { score: 100, band: "EXACT", source: "local" },
      };
      checks.push({
        ...base,
        type: "GSTIN",
        inputFingerprint: fingerprint("GSTIN", `${org.gstin}|${org.legalName}`),
        inputMasked: maskGstin(org.gstin),
        providerReference: reference(`gstin:${org.gstin}`),
        result,
        rawResponseHash: hash(result),
        expiresAt: expires(VALIDITY_DAYS.GSTIN),
      });
    }

    if (org.pan) {
      const result = {
        pan: maskPan(org.pan),
        status: "VALID",
        holderType: panHolderType(org.pan),
        registeredName: org.legalName.toUpperCase(),
        nameMatch: { score: 100, band: "EXACT", source: "provider" },
        aadhaarSeeded: null,
      };
      checks.push({
        ...base,
        type: "PAN",
        inputFingerprint: fingerprint("PAN", `${org.pan}|${org.legalName}`),
        inputMasked: maskPan(org.pan),
        providerReference: reference(`pan:${org.pan}`),
        result,
        rawResponseHash: hash(result),
        expiresAt: expires(VALIDITY_DAYS.PAN),
      });
    }

    if (org.type === "CHANNEL_PARTNER" && org.reraNumber) {
      const validUntil = isoDay(new Date(now.getTime() + 2 * 365 * DAY));
      const result = { registrationNumber: org.reraNumber, validUntil, mahaRera: isMahaReraAgentNumber(org.reraNumber), authority: "MahaRERA" };
      checks.push({
        ...base,
        provider: "manual",
        nameMatchScore: null,
        type: "RERA_AGENT",
        inputFingerprint: fingerprint("RERA_AGENT", org.reraNumber),
        inputMasked: org.reraNumber,
        result,
        rawResponseHash: hash(result),
        reviewedByName: "Arjun Shah",
        reviewedAt: checkedAt,
        reviewNote: "Certificate checked against the MahaRERA agent register.",
        expiresAt: new Date(`${validUntil}T23:59:59.999+05:30`),
      });
    }

    if (org.bankAccountNumber && org.bankIfsc) {
      const account = await db.bankAccount.create({
        data: {
          organisationId: org.id,
          accountNumberEncrypted: encryptField(org.bankAccountNumber, ENCRYPTION_CONTEXT.bankAccountNumber(org.id)),
          accountNumberLast4: org.bankAccountNumber.slice(-4),
          accountFingerprint: fingerprintField(`${org.bankIfsc}:${org.bankAccountNumber}`, "bank-account"),
          ifsc: org.bankIfsc,
          bankName: org.bankName,
          branch: "Main Branch",
          accountHolderName: org.legalName,
          beneficiaryName: org.legalName.toUpperCase(),
          verificationStatus: "VERIFIED",
          verifiedAt: checkedAt,
          isPrimary: true,
          primarySince: checkedAt,
          createdAt: checkedAt,
        },
      });
      const result = {
        accountLast4: account.accountNumberLast4,
        ifsc: org.bankIfsc,
        status: "VALID",
        statusCode: "ACCOUNT_VALID",
        beneficiaryName: org.legalName.toUpperCase(),
        bankName: org.bankName,
        branch: "Main Branch",
        city: org.city,
        nameMatch: { score: 100, band: "EXACT", source: "provider" },
        utr: null,
      };
      checks.push({
        ...base,
        type: "BANK_ACCOUNT",
        subject: "BANK_ACCOUNT",
        bankAccountId: account.id,
        inputFingerprint: fingerprint("BANK_ACCOUNT", `${org.bankIfsc}:${org.bankAccountNumber}|${org.legalName}`),
        inputMasked: `${maskAccountNumber(org.bankAccountNumber)} · ${org.bankIfsc}`,
        providerReference: reference(`bank:${org.bankIfsc}:${org.bankAccountNumber}`),
        result,
        rawResponseHash: hash(result),
        expiresAt: expires(VALIDITY_DAYS.BANK_ACCOUNT),
      });
    }

    if (checks.length > 0) await db.verificationCheck.createMany({ data: checks });
    await db.organisation.update({
      where: { id: org.id },
      data: {
        panEncrypted: org.pan ? encryptField(org.pan, ENCRYPTION_CONTEXT.organisationPan(org.id)) : null,
        panMasked: org.pan ? maskPan(org.pan) : null,
        gstRegistered: Boolean(org.gstin),
        kycStatus: "VERIFIED",
        kycStatusAt: checkedAt,
        kycVerifiedAt: checkedAt,
      },
    });
  }
}
