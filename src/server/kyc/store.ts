import "server-only";
import type { KycStatus } from "@/generated/prisma/client";
import { recordAudit } from "../audit";
import type { Actor } from "../auth/session";
import { db, type Tx } from "../db";
import { kycPolicy } from "./config";
import { deriveKycStatus, latestSnapshot, requirementsFor, type CheckSnapshot, type RequirementState, type RequirementType } from "./status";

type Client = Tx | typeof db;

const HOUR_MS = 60 * 60 * 1000;
const ORGANISATION_CHECK_TYPES = ["GSTIN", "PAN", "UDYAM", "RERA_AGENT"] as const;

/**
 * Snapshot for the payout bank account requirement: the primary account's latest check. Without a
 * primary account, the newest account's outcome is shown, but a verified-yet-unassigned account
 * still counts as pending.
 */
export async function bankAccountSnapshot(client: Client, organisationId: string): Promise<CheckSnapshot | null> {
  const accounts = await client.bankAccount.findMany({
    where: { organisationId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    include: { checks: { orderBy: { checkedAt: "desc" }, take: 10, select: { status: true, expiresAt: true, checkedAt: true } } },
  });
  const primary = accounts.find((account) => account.isPrimary);
  if (primary) return latestSnapshot(primary.checks);
  const newest = accounts.map((account) => latestSnapshot(account.checks)).find((snapshot) => snapshot !== null) ?? null;
  if (newest?.status === "VERIFIED") return { ...newest, status: "PENDING" };
  return newest;
}

export async function evaluateOrganisationKyc(client: Client, organisationId: string, now: Date) {
  const organisation = await client.organisation.findUniqueOrThrow({
    where: { id: organisationId },
    select: { id: true, name: true, type: true, gstRegistered: true, kycStatus: true },
  });
  const checks = await client.verificationCheck.findMany({
    where: { organisationId, subject: "ORGANISATION", type: { in: [...ORGANISATION_CHECK_TYPES] } },
    select: { type: true, status: true, expiresAt: true, checkedAt: true },
  });
  const snapshots: Partial<Record<RequirementType, CheckSnapshot | null>> = {};
  for (const type of ORGANISATION_CHECK_TYPES) snapshots[type] = latestSnapshot(checks.filter((check) => check.type === type));
  snapshots.BANK_ACCOUNT = await bankAccountSnapshot(client, organisationId);
  const derived = deriveKycStatus(requirementsFor(organisation.type, organisation.gstRegistered), snapshots, now);
  return { organisation, status: derived.status, items: derived.items as RequirementState[] };
}

/** Re-derives and stores the organisation's KYC status; audits a change. Call inside the transaction that changed a check. */
export async function recomputeKycStatus(tx: Tx, organisationId: string, now: Date, actor: Actor | null): Promise<KycStatus> {
  const { organisation, status } = await evaluateOrganisationKyc(tx, organisationId, now);
  if (status === organisation.kycStatus) return status;
  const updated = await tx.organisation.updateMany({
    where: { id: organisationId, kycStatus: organisation.kycStatus },
    data: { kycStatus: status, kycStatusAt: now, ...(status === "VERIFIED" ? { kycVerifiedAt: now } : {}) },
  });
  if (updated.count === 1) {
    await recordAudit(tx, actor, {
      action: "kyc.status_changed",
      entityType: "Organisation",
      entityId: organisationId,
      summary: `KYC status of ${organisation.name} changed from ${organisation.kycStatus} to ${status}`,
      metadata: { from: organisation.kycStatus, to: status },
    });
  }
  return status;
}

/** Locks the organisation row so concurrent primary-account changes serialise. */
export async function lockOrganisation(tx: Tx, organisationId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Organisation" WHERE id = ${organisationId} FOR UPDATE`;
}

export interface PrimaryChange {
  organisationId: string;
  organisationName: string;
  previousAccountLast4: string | null;
  newAccountLast4: string;
  newIfsc: string;
  coolingOffUntil: Date | null;
  changedAt: Date;
  changedById: string | null;
}

/**
 * Makes a verified account the payout account. Replacing an existing primary account starts the
 * cooling-off period; the first account an organisation registers does not.
 * The legacy Organisation bank columns are kept in step (masked) for code that still reads them.
 */
export async function assignPrimaryAccount(tx: Tx, accountId: string, actor: Actor | null, now: Date): Promise<PrimaryChange | null> {
  const account = await tx.bankAccount.findUniqueOrThrow({ where: { id: accountId }, include: { organisation: { select: { id: true, name: true } } } });
  await lockOrganisation(tx, account.organisationId);
  const current = await tx.bankAccount.findFirst({ where: { organisationId: account.organisationId, isPrimary: true, archivedAt: null } });
  if (current?.id === account.id) return null;

  const coolingOffUntil = current ? new Date(now.getTime() + kycPolicy().coolingOffHours * HOUR_MS) : null;
  if (current) await tx.bankAccount.update({ where: { id: current.id }, data: { isPrimary: false, primarySince: null, coolingOffUntil: null } });
  await tx.bankAccount.update({ where: { id: account.id }, data: { isPrimary: true, primarySince: now, coolingOffUntil } });
  await tx.organisation.update({
    where: { id: account.organisationId },
    data: { bankAccountNumber: `XXXXXXXX${account.accountNumberLast4}`, bankIfsc: account.ifsc, bankName: account.bankName },
  });

  const change: PrimaryChange = {
    organisationId: account.organisationId,
    organisationName: account.organisation.name,
    previousAccountLast4: current?.accountNumberLast4 ?? null,
    newAccountLast4: account.accountNumberLast4,
    newIfsc: account.ifsc,
    coolingOffUntil,
    changedAt: now,
    changedById: actor?.userId ?? null,
  };
  await recordAudit(tx, actor, {
    action: current ? "bank_account.primary_changed" : "bank_account.primary_set",
    entityType: "Organisation",
    entityId: account.organisationId,
    summary: current
      ? `Payout account changed from ••••${current.accountNumberLast4} to ••••${account.accountNumberLast4}; payouts paused until ${coolingOffUntil!.toISOString()}`
      : `Payout account set to ••••${account.accountNumberLast4}`,
    metadata: { bankAccountId: account.id, previousBankAccountId: current?.id ?? null, ...change },
  });
  return change;
}
