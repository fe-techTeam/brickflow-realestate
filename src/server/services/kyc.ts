import "server-only";
import { z } from "zod";
import type { KycStatus, OrganisationType, Prisma, VerificationCheckStatus, VerificationCheckType } from "@/generated/prisma/client";
import { maskAccountNumber, maskGstin, maskPan, maskUdyam } from "@/lib/verification/masking";
import { isMahaReraAgentNumber, validateAccountNumber, validateGstin, validateIfsc, validateIrn, validatePan, validateReraAgentNumber, validateUdyam } from "@/lib/verification/validation";
import { recordAudit } from "../audit";
import { assertOrgType, type Actor } from "../auth/session";
import { VerificationConfigError, verification } from "../connectors/verification/registry";
import { decryptField, encryptField, ENCRYPTION_CONTEXT, fingerprintField, isEncryptedValue } from "../crypto/field-encryption";
import { db, type Tx } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { kycEnforced, kycPolicy } from "../kyc/config";
import { checkLabel, describeResult, providerLabel, type Fact } from "../kyc/describe";
import { evaluateBankAccount, evaluateEInvoice, evaluateGstin, evaluatePan, evaluateUdyam, type OrganisationNames } from "../kyc/evaluate";
import { emitPayoutAccountChanged } from "../kyc/events";
import { persistCheck, runProviderCheck, sha256Hex, inputFingerprint, type PreparedCheck } from "../kyc/runner";
import { latestSnapshot, type ItemState, type RequirementType } from "../kyc/status";
import { assignPrimaryAccount, evaluateOrganisationKyc, recomputeKycStatus, type PrimaryChange } from "../kyc/store";
import { newStorageKey, sha256, storage } from "../storage";

const DAY_MS = 24 * 60 * 60 * 1000;
const MANUAL_PROVIDER = "manual";
const MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024;

export interface UploadedDocument {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface CallOptions {
  requestId?: string;
  now?: Date;
}

export interface CheckOutcome {
  checkId: string;
  status: VerificationCheckStatus;
  reasons: string[];
  kycStatus: KycStatus;
}

/* ----------------------------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------------------------- */

const VERIFIABLE_ORG_TYPES: OrganisationType[] = ["CHANNEL_PARTNER", "BUILDER", "FINANCIER"];

async function ownOrganisation(actor: Actor) {
  if (!VERIFIABLE_ORG_TYPES.includes(actor.orgType)) throw forbidden();
  const organisation = await db.organisation.findUnique({ where: { id: actor.orgId } });
  if (!organisation) throw notFound("Organisation not found.");
  return organisation;
}

type OrganisationRow = Awaited<ReturnType<typeof ownOrganisation>>;

function organisationPan(organisation: Pick<OrganisationRow, "id" | "pan" | "panEncrypted">): string | null {
  if (organisation.panEncrypted && isEncryptedValue(organisation.panEncrypted)) {
    return decryptField(organisation.panEncrypted, ENCRYPTION_CONTEXT.organisationPan(organisation.id));
  }
  return organisation.pan ?? null;
}

function namesOf(organisation: OrganisationRow): OrganisationNames {
  return { legalName: organisation.legalName, name: organisation.name, pan: organisationPan(organisation) };
}

/** Resolves a provider, turning a configuration problem into a user-safe error. */
function resolveProvider<T>(get: () => T): T {
  try {
    return get();
  } catch (error) {
    if (error instanceof VerificationConfigError) {
      console.error(JSON.stringify({ level: "error", component: "kyc", msg: "verification provider misconfigured", error: error.message }));
      throw conflict("Verification is not available at the moment. Our team has been alerted.");
    }
    throw error;
  }
}

function field(name: string, result: { ok: true; value: string } | { ok: false; error: string }): string {
  if (!result.ok) throw invalid(result.error, { [name]: [result.error] });
  return result.value;
}

async function finalise(
  actor: Actor | null,
  organisationId: string,
  prepared: PreparedCheck,
  now: Date,
  audit: { action: string; summary: string },
  extra?: (tx: Tx, checkId: string) => Promise<PrimaryChange | null | void>,
): Promise<CheckOutcome> {
  const effects: { change: PrimaryChange | null } = { change: null };
  const outcome = await db.$transaction(async (tx) => {
    const check = await persistCheck(tx, prepared);
    effects.change = (extra ? await extra(tx, check.id) : null) ?? null;
    const kycStatus = await recomputeKycStatus(tx, organisationId, now, actor);
    await recordAudit(tx, actor, {
      action: audit.action,
      entityType: "Organisation",
      entityId: organisationId,
      summary: `${audit.summary}: ${prepared.status.replace("_", " ").toLowerCase()}`,
      metadata: { checkId: check.id, status: prepared.status, provider: prepared.data.provider, fromCache: prepared.fromCache, reasons: prepared.reasons },
    });
    return { checkId: check.id, status: prepared.status, reasons: prepared.reasons, kycStatus };
  });
  if (effects.change) await emitPayoutAccountChanged(effects.change);
  return outcome;
}

/* ----------------------------------------------------------------------------------------------
 * Partner submissions
 * -------------------------------------------------------------------------------------------- */

const gstinSchema = z.union([z.object({ notRegistered: z.literal(true) }), z.object({ gstin: z.string().trim().min(1, "Enter the GSTIN").max(20) })]);

export async function submitGstin(actor: Actor, raw: { gstin?: string; notRegistered?: boolean }, options: CallOptions = {}): Promise<CheckOutcome | { kycStatus: KycStatus }> {
  const organisation = await ownOrganisation(actor);
  const input = gstinSchema.parse(raw.notRegistered ? { notRegistered: true } : { gstin: raw.gstin ?? "" });
  const now = options.now ?? new Date();

  if ("notRegistered" in input) {
    if (organisation.type !== "CHANNEL_PARTNER") throw invalid("GST registration is mandatory for this organisation type.");
    return db.$transaction(async (tx) => {
      await tx.organisation.update({ where: { id: organisation.id }, data: { gstRegistered: false } });
      await recordAudit(tx, actor, { action: "kyc.gst_not_registered", entityType: "Organisation", entityId: organisation.id, summary: `${organisation.name} declared that it is not registered under GST` });
      return { kycStatus: await recomputeKycStatus(tx, organisation.id, now, actor) };
    });
  }

  const gstin = field("gstin", validateGstin(input.gstin));
  const verifier = resolveProvider(() => verification.gstin());
  const names = namesOf(organisation);
  const threshold = kycPolicy().nameMatchThreshold.GSTIN;
  const prepared = await runProviderCheck({
    organisationId: organisation.id,
    type: "GSTIN",
    cacheKey: `${gstin}|${organisation.legalName}`,
    inputMasked: maskGstin(gstin),
    provider: verifier.provider,
    requestedById: actor.userId,
    requestId: options.requestId,
    now,
    call: (context) => verifier.verifyGstin({ gstin, name: organisation.legalName }, context),
    evaluate: (result) => evaluateGstin(result, names, threshold),
  });
  return finalise(actor, organisation.id, prepared, now, { action: "kyc.gstin_checked", summary: `GSTIN ${maskGstin(gstin)} checked` }, async (tx) => {
    if (prepared.status !== "FAILED") await tx.organisation.update({ where: { id: organisation.id }, data: { gstin, gstRegistered: true } });
  });
}

const panSchema = z.object({ pan: z.string().trim().min(1, "Enter the PAN").max(12) });

export async function submitPan(actor: Actor, raw: { pan: string }, options: CallOptions = {}): Promise<CheckOutcome> {
  const organisation = await ownOrganisation(actor);
  const pan = field("pan", validatePan(panSchema.parse(raw).pan));
  const now = options.now ?? new Date();
  const verifier = resolveProvider(() => verification.pan());
  const names = namesOf(organisation);
  const threshold = kycPolicy().nameMatchThreshold.PAN;
  const prepared = await runProviderCheck({
    organisationId: organisation.id,
    type: "PAN",
    cacheKey: `${pan}|${organisation.legalName}`,
    inputMasked: maskPan(pan),
    provider: verifier.provider,
    requestedById: actor.userId,
    requestId: options.requestId,
    now,
    call: (context) => verifier.verifyPan({ pan, name: organisation.legalName }, context),
    evaluate: (result) => evaluatePan(result, names, threshold),
  });
  return finalise(actor, organisation.id, prepared, now, { action: "kyc.pan_checked", summary: `PAN ${maskPan(pan)} checked` }, async (tx) => {
    if (prepared.status === "FAILED") return;
    await tx.organisation.update({
      where: { id: organisation.id },
      // The legacy plaintext column is cleared whenever a new PAN is stored encrypted.
      data: { panEncrypted: encryptField(pan, ENCRYPTION_CONTEXT.organisationPan(organisation.id)), panMasked: maskPan(pan), pan: null },
    });
  });
}

const udyamSchema = z.object({ udyamNumber: z.string().trim().min(1, "Enter the Udyam registration number").max(30) });

export async function submitUdyam(actor: Actor, raw: { udyamNumber: string }, options: CallOptions = {}): Promise<CheckOutcome> {
  const organisation = await ownOrganisation(actor);
  const udyamNumber = field("udyamNumber", validateUdyam(udyamSchema.parse(raw).udyamNumber));
  const now = options.now ?? new Date();
  const verifier = resolveProvider(() => verification.udyam());
  const names = namesOf(organisation);
  const threshold = kycPolicy().nameMatchThreshold.UDYAM;
  const prepared = await runProviderCheck({
    organisationId: organisation.id,
    type: "UDYAM",
    cacheKey: `${udyamNumber}|${organisation.legalName}`,
    inputMasked: maskUdyam(udyamNumber),
    provider: verifier.provider,
    requestedById: actor.userId,
    requestId: options.requestId,
    now,
    call: (context) => verifier.verifyUdyam({ udyamNumber, name: organisation.legalName }, context),
    evaluate: (result) => evaluateUdyam(result, names, threshold),
  });
  return finalise(actor, organisation.id, prepared, now, { action: "kyc.udyam_checked", summary: `Udyam ${maskUdyam(udyamNumber)} checked` });
}

/* ----------------------------------------------------------------------------------------------
 * Bank accounts
 * -------------------------------------------------------------------------------------------- */

const bankSchema = z
  .object({
    accountNumber: z.string().trim().min(1, "Enter the account number").max(30),
    confirmAccountNumber: z.string().trim().min(1, "Re-enter the account number").max(30),
    ifsc: z.string().trim().min(1, "Enter the IFSC").max(15),
    accountHolderName: z.string().trim().max(120).optional(),
    makePrimary: z.boolean().optional(),
  })
  .refine((value) => value.accountNumber.replace(/\s/g, "") === value.confirmAccountNumber.replace(/\s/g, ""), {
    path: ["confirmAccountNumber"],
    message: "The account numbers do not match",
  });

export function bankAccountFingerprint(ifsc: string, accountNumber: string): string {
  return fingerprintField(`${ifsc}:${accountNumber}`, "bank-account");
}

/**
 * Registers a payout account and verifies it by penny drop. The first verified account becomes the
 * payout account immediately; replacing an existing one (makePrimary) starts the cooling-off period.
 */
export async function submitBankAccount(
  actor: Actor,
  raw: { accountNumber: string; confirmAccountNumber: string; ifsc: string; accountHolderName?: string; makePrimary?: boolean },
  options: CallOptions = {},
): Promise<CheckOutcome & { bankAccountId: string }> {
  const organisation = await ownOrganisation(actor);
  const input = bankSchema.parse(raw);
  const accountNumber = field("accountNumber", validateAccountNumber(input.accountNumber));
  const ifsc = field("ifsc", validateIfsc(input.ifsc));
  const now = options.now ?? new Date();
  const fingerprint = bankAccountFingerprint(ifsc, accountNumber);

  let account = await db.bankAccount.findUnique({ where: { organisationId_accountFingerprint: { organisationId: organisation.id, accountFingerprint: fingerprint } } });
  if (account && !account.archivedAt && account.verificationStatus === "VERIFIED") {
    throw conflict(account.isPrimary ? "This account is already your verified payout account." : "This account is already verified. Make it your payout account from the list below.");
  }
  const verifier = resolveProvider(() => verification.bankAccount());
  const usedByOtherOrganisations = await db.bankAccount.count({ where: { accountFingerprint: fingerprint, organisationId: { not: organisation.id }, archivedAt: null } });

  const holder = input.accountHolderName || organisation.legalName;
  if (!account) {
    account = await db.bankAccount.create({
      data: {
        organisationId: organisation.id,
        accountNumberEncrypted: encryptField(accountNumber, ENCRYPTION_CONTEXT.bankAccountNumber(organisation.id)),
        accountNumberLast4: accountNumber.slice(-4),
        accountFingerprint: fingerprint,
        ifsc,
        accountHolderName: holder,
        createdById: actor.userId,
      },
    });
  } else {
    account = await db.bankAccount.update({ where: { id: account.id }, data: { archivedAt: null, accountHolderName: holder, verificationStatus: "UNVERIFIED" } });
  }

  const names = namesOf(organisation);
  const threshold = kycPolicy().nameMatchThreshold.BANK_ACCOUNT;
  const bankAccountId = account.id;
  const prepared = await runProviderCheck({
    organisationId: organisation.id,
    type: "BANK_ACCOUNT",
    subject: "BANK_ACCOUNT",
    bankAccountId,
    cacheKey: `${ifsc}:${accountNumber}|${organisation.legalName}`,
    inputMasked: `${maskAccountNumber(accountNumber)} · ${ifsc}`,
    provider: verifier.provider,
    requestedById: actor.userId,
    requestId: options.requestId,
    now,
    call: (context) => verifier.verifyBankAccount({ accountNumber, ifsc, name: organisation.legalName }, context),
    evaluate: (result) => evaluateBankAccount(result, names, threshold, { usedByOtherOrganisations }),
  });
  const result = (prepared.result ?? {}) as { beneficiaryName?: string | null; bankName?: string | null; branch?: string | null };
  const outcome = await finalise(actor, organisation.id, prepared, now, { action: "kyc.bank_account_checked", summary: `Bank account ${maskAccountNumber(accountNumber)} (${ifsc}) checked` }, async (tx) => {
    await tx.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        verificationStatus: prepared.status === "VERIFIED" ? "VERIFIED" : prepared.status === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "FAILED",
        verifiedAt: prepared.status === "VERIFIED" ? now : null,
        beneficiaryName: result.beneficiaryName ?? null,
        bankName: result.bankName ?? null,
        branch: result.branch ?? null,
      },
    });
    if (prepared.status !== "VERIFIED") return null;
    const hasPrimary = await tx.bankAccount.count({ where: { organisationId: organisation.id, isPrimary: true, archivedAt: null } });
    if (hasPrimary === 0 || input.makePrimary) return assignPrimaryAccount(tx, bankAccountId, actor, now);
    return null;
  });
  return { ...outcome, bankAccountId };
}

export async function setPrimaryBankAccount(actor: Actor, bankAccountId: string, options: CallOptions = {}) {
  const organisation = await ownOrganisation(actor);
  const now = options.now ?? new Date();
  const account = await db.bankAccount.findUnique({ where: { id: bankAccountId }, include: { checks: { orderBy: { checkedAt: "desc" }, take: 10 } } });
  if (!account || account.organisationId !== organisation.id || account.archivedAt) throw notFound("Bank account not found.");
  if (account.isPrimary) throw conflict("This is already your payout account.");
  const latest = latestSnapshot(account.checks);
  if (account.verificationStatus !== "VERIFIED" || latest?.status !== "VERIFIED") throw conflict("Only a verified bank account can receive payouts.");
  if (latest.expiresAt && latest.expiresAt <= now) throw conflict("This account's verification has expired. Verify it again first.");

  const change = await db.$transaction(async (tx) => {
    const result = await assignPrimaryAccount(tx, account.id, actor, now);
    await recomputeKycStatus(tx, organisation.id, now, actor);
    return result;
  });
  if (change) await emitPayoutAccountChanged(change);
  return change;
}

/* ----------------------------------------------------------------------------------------------
 * RERA agent registration (manual review: MahaRERA has no public API)
 * -------------------------------------------------------------------------------------------- */

const reraSchema = z.object({
  registrationNumber: z.string().trim().min(1, "Enter the registration number").max(40),
  validUntil: z.iso.date("Enter the expiry date"),
});

function certificateKind(file: UploadedDocument): { extension: string; mimeType: string } | null {
  const b = file.bytes;
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { extension: "pdf", mimeType: "application/pdf" };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { extension: "png", mimeType: "image/png" };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { extension: "jpg", mimeType: "image/jpeg" };
  return null;
}

export async function submitReraRegistration(actor: Actor, raw: { registrationNumber: string; validUntil: string }, file: UploadedDocument | null, options: CallOptions = {}): Promise<CheckOutcome> {
  assertOrgType(actor, "CHANNEL_PARTNER");
  const organisation = await ownOrganisation(actor);
  const input = reraSchema.parse(raw);
  const registrationNumber = field("registrationNumber", validateReraAgentNumber(input.registrationNumber));
  const now = options.now ?? new Date();
  const expiresAt = new Date(`${input.validUntil}T23:59:59.999+05:30`);
  if (expiresAt.getTime() <= now.getTime()) throw invalid("The registration has already expired. Renew it before submitting.", { validUntil: ["The registration has expired"] });

  let document: { kind: { extension: string; mimeType: string }; file: UploadedDocument } | null = null;
  if (file && file.bytes.length > 0) {
    if (file.bytes.length > MAX_CERTIFICATE_BYTES) throw invalid("The certificate must be 5 MB or smaller.", { certificate: ["The certificate must be 5 MB or smaller"] });
    const kind = certificateKind(file);
    if (!kind) throw invalid("Upload the certificate as a PDF, PNG or JPEG.", { certificate: ["Upload a PDF, PNG or JPEG"] });
    document = { kind, file };
  }
  const storageKey = document ? newStorageKey("kyc", document.kind.extension) : null;
  if (document && storageKey) await storage().put(storageKey, document.file.bytes, document.kind.mimeType);

  const mahaRera = isMahaReraAgentNumber(registrationNumber);
  const result = { registrationNumber, validUntil: input.validUntil, mahaRera, authority: mahaRera ? "MahaRERA" : "RERA" };
  try {
    const outcome = await db.$transaction(async (tx) => {
      const check = await tx.verificationCheck.create({
        data: {
          organisationId: organisation.id,
          type: "RERA_AGENT",
          inputFingerprint: inputFingerprint("RERA_AGENT", registrationNumber),
          inputMasked: registrationNumber,
          provider: MANUAL_PROVIDER,
          status: "PENDING",
          result,
          reasons: ["Awaiting review of the registration certificate."],
          rawResponseHash: sha256Hex(JSON.stringify(result)),
          requestId: options.requestId ?? null,
          requestedById: actor.userId,
          checkedAt: now,
          expiresAt,
        },
      });
      if (document && storageKey) {
        await tx.kycDocument.create({
          data: {
            organisationId: organisation.id,
            checkId: check.id,
            kind: "RERA_CERTIFICATE",
            fileName: document.file.name.slice(0, 200) || `rera-certificate.${document.kind.extension}`,
            storageKey,
            mimeType: document.kind.mimeType,
            sizeBytes: document.file.bytes.length,
            sha256: sha256(document.file.bytes),
            uploadedById: actor.userId,
          },
        });
      }
      await tx.organisation.update({ where: { id: organisation.id }, data: { reraNumber: registrationNumber } });
      const kycStatus = await recomputeKycStatus(tx, organisation.id, now, actor);
      await recordAudit(tx, actor, {
        action: "kyc.rera_submitted",
        entityType: "Organisation",
        entityId: organisation.id,
        summary: `RERA agent registration ${registrationNumber} submitted for review (valid until ${input.validUntil})`,
        metadata: { checkId: check.id, validUntil: input.validUntil, certificate: Boolean(document) },
      });
      return { checkId: check.id, status: check.status, reasons: check.reasons, kycStatus };
    });
    return outcome;
  } catch (error) {
    if (storageKey) await storage().delete(storageKey).catch(() => undefined);
    throw error;
  }
}

/* ----------------------------------------------------------------------------------------------
 * E-invoice (IRN), for invoice integrity checks
 * -------------------------------------------------------------------------------------------- */

/**
 * Verifies an IRN online and records the check against the supplier organisation. Not part of the
 * KYC status; invoice flows call this when an IRN is present.
 */
export async function verifyInvoiceIrn(input: {
  organisationId: string;
  irn: string;
  invoiceId?: string;
  supplierGstin?: string | null;
  buyerGstin?: string | null;
  requestedById?: string | null;
  requestId?: string;
  now?: Date;
}): Promise<{ checkId: string; status: VerificationCheckStatus; reasons: string[] }> {
  const irn = field("irn", validateIrn(input.irn));
  const now = input.now ?? new Date();
  const verifier = resolveProvider(() => verification.eInvoice());
  const prepared = await runProviderCheck({
    organisationId: input.organisationId,
    type: "E_INVOICE",
    subject: "INVOICE",
    subjectRef: input.invoiceId ?? null,
    cacheKey: `${irn}|${input.supplierGstin ?? ""}`,
    inputMasked: `${irn.slice(0, 8)}…${irn.slice(-6)}`,
    provider: verifier.provider,
    requestedById: input.requestedById ?? null,
    requestId: input.requestId,
    now,
    call: (context) => verifier.verifyEInvoice({ irn, supplierGstin: input.supplierGstin ?? undefined }, context),
    evaluate: (result) => evaluateEInvoice(result, { supplierGstin: input.supplierGstin, buyerGstin: input.buyerGstin }),
  });
  const check = await db.$transaction(async (tx) => {
    const created = await persistCheck(tx, prepared);
    await recordAudit(tx, null, {
      action: "kyc.e_invoice_checked",
      entityType: input.invoiceId ? "Invoice" : "Organisation",
      entityId: input.invoiceId ?? input.organisationId,
      summary: `E-invoice IRN ${created.inputMasked} checked: ${prepared.status.toLowerCase()}`,
      metadata: { checkId: created.id, status: prepared.status, reasons: prepared.reasons },
    });
    return created;
  });
  return { checkId: check.id, status: prepared.status, reasons: prepared.reasons };
}

/* ----------------------------------------------------------------------------------------------
 * Admin review
 * -------------------------------------------------------------------------------------------- */

const reviewSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("APPROVE"), note: z.string().trim().max(1000).optional() }),
  z.object({ decision: z.literal("REJECT"), note: z.string().trim().min(10, "Give a reason of at least 10 characters").max(1000) }),
]);

const REVIEWABLE: VerificationCheckStatus[] = ["PENDING", "REVIEW_REQUIRED"];

export async function reviewVerificationCheck(actor: Actor, checkId: string, raw: { decision: "APPROVE" | "REJECT"; note?: string }, options: CallOptions = {}) {
  assertOrgType(actor, "PLATFORM");
  const input = reviewSchema.parse(raw);
  const now = options.now ?? new Date();
  const check = await db.verificationCheck.findUnique({ where: { id: checkId }, include: { organisation: { select: { id: true, name: true } } } });
  if (!check) throw notFound("Verification not found.");
  if (!REVIEWABLE.includes(check.status)) throw conflict("This verification has already been decided.");
  const newer = await db.verificationCheck.count({
    where: { organisationId: check.organisationId, type: check.type, bankAccountId: check.bankAccountId, status: { not: "ERROR" }, checkedAt: { gt: check.checkedAt } },
  });
  if (newer > 0) throw conflict("A newer submission exists for this check. Review the latest one instead.");

  const approved = input.decision === "APPROVE";
  const effects: { change: PrimaryChange | null } = { change: null };
  await db.$transaction(async (tx) => {
    const updated = await tx.verificationCheck.updateMany({
      where: { id: check.id, status: { in: REVIEWABLE } },
      data: { status: approved ? "VERIFIED" : "REJECTED", reviewedById: actor.userId, reviewedByName: actor.name, reviewedAt: now, reviewNote: input.note || null },
    });
    if (updated.count !== 1) throw conflict("This verification has already been decided.");
    if (check.bankAccountId) {
      await tx.bankAccount.update({ where: { id: check.bankAccountId }, data: { verificationStatus: approved ? "VERIFIED" : "REJECTED", verifiedAt: approved ? now : null } });
      if (approved) {
        const hasPrimary = await tx.bankAccount.count({ where: { organisationId: check.organisationId, isPrimary: true, archivedAt: null } });
        if (hasPrimary === 0) effects.change = await assignPrimaryAccount(tx, check.bankAccountId, actor, now);
      }
    }
    await recordAudit(tx, actor, {
      action: approved ? "kyc.check_approved" : "kyc.check_rejected",
      entityType: "Organisation",
      entityId: check.organisationId,
      summary: `${approved ? "Approved" : "Rejected"} ${checkLabel(check.type)} (${check.inputMasked}) for ${check.organisation.name}`,
      metadata: { checkId: check.id, decision: input.decision, note: input.note ?? null, previousStatus: check.status },
    });
    await recomputeKycStatus(tx, check.organisationId, now, actor);
  });
  if (effects.change) await emitPayoutAccountChanged(effects.change);
}

/* ----------------------------------------------------------------------------------------------
 * Payout gate
 * -------------------------------------------------------------------------------------------- */

export interface PayoutEligibility {
  eligible: boolean;
  kycStatus: KycStatus | null;
  reasons: string[];
  coolingOffUntil: Date | null;
}

const KYC_REASON: Record<Exclude<KycStatus, "VERIFIED">, string> = {
  NOT_STARTED: "Complete your KYC verification before accepting early-payment offers.",
  PENDING: "Your KYC verification is still in progress. You can accept offers once it is complete.",
  REJECTED: "Your KYC verification needs attention. Update the details on the Verification page.",
  EXPIRED: "Part of your KYC verification has expired. Renew it on the Verification page.",
};

/** Read-only payout readiness for a channel partner, derived live from the checks (not the cached status). */
export async function payoutEligibility(cpId: string, now: Date = new Date()): Promise<PayoutEligibility> {
  const organisation = await db.organisation.findUnique({ where: { id: cpId }, select: { id: true, type: true } });
  if (!organisation || organisation.type !== "CHANNEL_PARTNER") return { eligible: false, kycStatus: null, reasons: ["Payouts are only available to channel partners."], coolingOffUntil: null };
  const { status } = await evaluateOrganisationKyc(db, cpId, now);
  const reasons: string[] = [];
  if (status !== "VERIFIED") reasons.push(KYC_REASON[status]);
  const primary = await db.bankAccount.findFirst({ where: { organisationId: cpId, isPrimary: true, archivedAt: null } });
  let coolingOffUntil: Date | null = null;
  if (!primary) reasons.push("Add and verify a payout bank account before accepting early-payment offers.");
  else if (primary.verificationStatus !== "VERIFIED") reasons.push("Your payout bank account is not verified yet.");
  else if (primary.coolingOffUntil && primary.coolingOffUntil > now) {
    coolingOffUntil = primary.coolingOffUntil;
    reasons.push(`Your payout account was changed recently. For your security, early payments resume after ${formatIst(primary.coolingOffUntil)}.`);
  }
  return { eligible: reasons.length === 0, kycStatus: status, reasons, coolingOffUntil };
}

function formatIst(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date);
}

/**
 * Gate for the financing service: a channel partner may accept an early-payment offer, and be paid
 * out, only with VERIFIED KYC and a verified payout account outside its cooling-off period.
 * Enforced when KYC_ENFORCED is on (default in production). `audience: "financier"` words the
 * refusal for the financier releasing the payout instead of the partner.
 */
export async function assertCpEligibleForPayout(cpId: string, now: Date = new Date(), options: { audience?: "partner" | "financier" } = {}): Promise<void> {
  if (!kycEnforced()) return;
  const eligibility = await payoutEligibility(cpId, now);
  if (eligibility.eligible) return;
  if (options.audience !== "financier") throw conflict(eligibility.reasons[0]!);
  if (eligibility.coolingOffUntil) {
    throw conflict(`The channel partner changed its payout account recently. The payout can be released after ${formatIst(eligibility.coolingOffUntil)}.`);
  }
  throw conflict("The channel partner's KYC or payout account is not verified, so the payout cannot be released yet.");
}

/* ----------------------------------------------------------------------------------------------
 * Scheduled maintenance (to be wired to the job scheduler)
 * -------------------------------------------------------------------------------------------- */

/** Re-derives every organisation's KYC status so expiries take effect. Returns the number changed. */
export async function recomputeKycStatuses(now: Date = new Date()): Promise<{ checked: number; changed: number }> {
  const organisations = await db.organisation.findMany({ where: { type: { in: VERIFIABLE_ORG_TYPES } }, select: { id: true, kycStatus: true } });
  let changed = 0;
  for (const organisation of organisations) {
    const status = await db.$transaction((tx) => recomputeKycStatus(tx, organisation.id, now, null));
    if (status !== organisation.kycStatus) changed += 1;
  }
  return { checked: organisations.length, changed };
}

export interface ReraReminder {
  organisationId: string;
  organisationName: string;
  contactEmail: string | null;
  registrationNumber: string;
  expiresAt: Date;
  daysRemaining: number;
  expired: boolean;
}

/** RERA registrations that expire within `withinDays` (or already have), latest verified check per organisation. */
export async function reraExpiryReminders(now: Date = new Date(), withinDays: number = kycPolicy().reraReminderDays): Promise<ReraReminder[]> {
  const horizon = new Date(now.getTime() + withinDays * DAY_MS);
  const checks = await db.verificationCheck.findMany({
    where: { type: "RERA_AGENT", status: "VERIFIED", expiresAt: { lte: horizon } },
    orderBy: { checkedAt: "desc" },
    include: { organisation: { select: { name: true, contactEmail: true } } },
  });
  const reminders: ReraReminder[] = [];
  const seen = new Set<string>();
  for (const check of checks) {
    if (seen.has(check.organisationId)) continue;
    seen.add(check.organisationId);
    const newer = await db.verificationCheck.findFirst({
      where: { organisationId: check.organisationId, type: "RERA_AGENT", status: { not: "ERROR" }, checkedAt: { gt: check.checkedAt } },
      select: { id: true },
    });
    if (newer) continue;
    const expiresAt = check.expiresAt!;
    reminders.push({
      organisationId: check.organisationId,
      organisationName: check.organisation.name,
      contactEmail: check.organisation.contactEmail,
      registrationNumber: check.inputMasked,
      expiresAt,
      daysRemaining: Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS),
      expired: expiresAt <= now,
    });
  }
  return reminders.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
}

/* ----------------------------------------------------------------------------------------------
 * Read models
 * -------------------------------------------------------------------------------------------- */

export interface CheckView {
  id: string;
  type: VerificationCheckType;
  status: VerificationCheckStatus;
  inputMasked: string;
  provider: string;
  checkedAt: Date;
  expiresAt: Date | null;
  reasons: string[];
  nameMatchScore: number | null;
  reviewNote: string | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  facts: Fact[];
  documentId: string | null;
}

type CheckRow = Prisma.VerificationCheckGetPayload<{ include: { documents: { select: { id: true } } } }>;

function toCheckView(check: CheckRow): CheckView {
  return {
    id: check.id,
    type: check.type,
    status: check.status,
    inputMasked: check.inputMasked,
    provider: providerLabel(check.provider),
    checkedAt: check.checkedAt,
    expiresAt: check.expiresAt,
    reasons: check.reasons,
    nameMatchScore: check.nameMatchScore,
    reviewNote: check.reviewNote,
    reviewedByName: check.reviewedByName,
    reviewedAt: check.reviewedAt,
    facts: describeResult(check.type, check.result),
    documentId: check.documents[0]?.id ?? null,
  };
}

export interface BankAccountView {
  id: string;
  maskedNumber: string;
  ifsc: string;
  bankName: string | null;
  branch: string | null;
  accountHolderName: string;
  beneficiaryName: string | null;
  status: string;
  isPrimary: boolean;
  coolingOffUntil: Date | null;
  verifiedAt: Date | null;
  latest: CheckView | null;
}

export async function getVerificationOverview(actor: Actor, now: Date = new Date()) {
  const organisation = await ownOrganisation(actor);
  const { status, items } = await evaluateOrganisationKyc(db, organisation.id, now);
  const checks = await db.verificationCheck.findMany({
    where: { organisationId: organisation.id, subject: { in: ["ORGANISATION", "BANK_ACCOUNT"] } },
    orderBy: { checkedAt: "desc" },
    take: 200,
    include: { documents: { select: { id: true } } },
  });
  const latestByType = new Map<VerificationCheckType, CheckView>();
  for (const check of checks) {
    if (check.subject !== "ORGANISATION" || latestByType.has(check.type)) continue;
    if (check.status === "ERROR" && checks.some((other) => other.type === check.type && other.subject === "ORGANISATION" && other.status !== "ERROR")) continue;
    latestByType.set(check.type, toCheckView(check));
  }
  const accounts = await db.bankAccount.findMany({ where: { organisationId: organisation.id, archivedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }] });
  const bankAccounts: BankAccountView[] = accounts.map((account) => {
    const latest = latestSnapshot(checks.filter((check) => check.bankAccountId === account.id));
    return {
      id: account.id,
      maskedNumber: `••••${account.accountNumberLast4}`,
      ifsc: account.ifsc,
      bankName: account.bankName,
      branch: account.branch,
      accountHolderName: account.accountHolderName,
      beneficiaryName: account.beneficiaryName,
      status: account.verificationStatus,
      isPrimary: account.isPrimary,
      coolingOffUntil: account.coolingOffUntil && account.coolingOffUntil > now ? account.coolingOffUntil : null,
      verifiedAt: account.verifiedAt,
      latest: latest ? toCheckView(latest) : null,
    };
  });
  const primary = bankAccounts.find((account) => account.isPrimary) ?? null;
  const requirementItems = items.map((item) => ({
    type: item.type as RequirementType,
    required: item.required,
    state: item.state as ItemState,
    label: checkLabel(item.type),
    latest: item.type === "BANK_ACCOUNT" ? (primary?.latest ?? bankAccounts[0]?.latest ?? null) : (latestByType.get(item.type) ?? null),
  }));
  const payout = organisation.type === "CHANNEL_PARTNER" ? await payoutEligibility(organisation.id, now) : null;

  return {
    organisation: {
      id: organisation.id,
      name: organisation.name,
      legalName: organisation.legalName,
      type: organisation.type,
      gstRegistered: organisation.gstRegistered,
      gstin: organisation.gstin,
      panMasked: organisation.panMasked ?? (organisation.pan ? maskPan(organisation.pan) : null),
      reraNumber: organisation.reraNumber,
    },
    kycStatus: status,
    enforced: kycEnforced(),
    items: requirementItems,
    bankAccounts,
    payout,
    coolingOffHours: kycPolicy().coolingOffHours,
  };
}

export type VerificationOverview = Awaited<ReturnType<typeof getVerificationOverview>>;

export async function listKycReviewQueue(actor: Actor) {
  assertOrgType(actor, "PLATFORM");
  const candidates = await db.verificationCheck.findMany({
    where: { status: { in: REVIEWABLE }, subject: { in: ["ORGANISATION", "BANK_ACCOUNT"] } },
    orderBy: { checkedAt: "asc" },
    take: 200,
    include: {
      documents: { select: { id: true } },
      organisation: { select: { id: true, name: true, legalName: true, type: true, kycStatus: true } },
      bankAccount: { select: { accountNumberLast4: true, ifsc: true, accountHolderName: true, beneficiaryName: true } },
    },
  });
  if (candidates.length === 0) return [];
  const latest = await db.verificationCheck.groupBy({
    by: ["organisationId", "type", "bankAccountId"],
    where: { organisationId: { in: [...new Set(candidates.map((c) => c.organisationId))] }, status: { not: "ERROR" } },
    _max: { checkedAt: true },
  });
  const key = (c: { organisationId: string; type: string; bankAccountId: string | null }) => `${c.organisationId}|${c.type}|${c.bankAccountId ?? ""}`;
  const newest = new Map(latest.map((row) => [key(row), row._max.checkedAt?.getTime() ?? 0]));
  return candidates
    .filter((check) => (newest.get(key(check)) ?? 0) <= check.checkedAt.getTime())
    .map((check) => ({
      ...toCheckView(check),
      label: checkLabel(check.type),
      organisation: check.organisation,
      bankAccount: check.bankAccount,
    }));
}

export type KycQueueItem = Awaited<ReturnType<typeof listKycReviewQueue>>[number];

export async function listOrganisationKycStatuses(actor: Actor) {
  assertOrgType(actor, "PLATFORM");
  return db.organisation.findMany({
    where: { type: { in: VERIFIABLE_ORG_TYPES } },
    orderBy: [{ kycStatus: "asc" }, { name: "asc" }],
    select: { id: true, name: true, type: true, kycStatus: true, kycStatusAt: true, kycVerifiedAt: true },
  });
}

/** Certificate download: the owning organisation or a platform administrator. */
export async function getKycDocumentForActor(actor: Actor, documentId: string) {
  const document = await db.kycDocument.findUnique({ where: { id: documentId } });
  if (!document) throw notFound("Document not found.");
  if (actor.orgType !== "PLATFORM" && document.organisationId !== actor.orgId) throw notFound("Document not found.");
  return document;
}
