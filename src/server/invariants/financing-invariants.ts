/**
 * Database-wide consistency checks for the financing lifecycle. Read-only and set-based, so it is
 * safe to run against production at any time. Deliberately free of `server-only` and path aliases
 * so the command-line runner (`npm run check:invariants`) can import it directly.
 */

import type { PrismaClient } from "../../generated/prisma/client";
import { deriveSettlementStatus } from "../../lib/state-machines";

export type InvariantCode =
  | "INVOICE_FINANCED_WITHOUT_ACCEPTED_OFFER"
  | "INVOICE_FINANCED_WITHOUT_REQUEST"
  | "INVOICE_FINANCING_BEFORE_ACCEPTANCE"
  | "INVOICE_MULTIPLE_ACCEPTED_OFFERS"
  | "INVOICE_MULTIPLE_OPEN_OFFERS"
  | "REQUEST_STATUS_MISMATCH"
  | "REQUEST_PARTY_MISMATCH"
  | "REQUEST_OFFER_MISMATCH"
  | "REQUEST_ARITHMETIC"
  | "OFFER_ARITHMETIC"
  | "DISBURSEMENT_AMOUNT_MISMATCH"
  | "DISBURSEMENT_STATE_MISMATCH"
  | "SETTLEMENT_AMOUNT_MISMATCH"
  | "SETTLEMENT_STATE_MISMATCH"
  | "SETTLED_WITHOUT_SETTLED_AT"
  | "OPEN_SETTLEMENT_WITH_SETTLED_AT"
  | "SETTLEMENT_STATUS_STALE"
  | "MULTIPLE_ACTIVE_PROGRAMMES";

export interface InvariantViolation {
  code: InvariantCode;
  severity: "error" | "warning";
  entityType: "Invoice" | "FinancingOffer" | "FinancingRequest" | "Disbursement" | "Settlement" | "Organisation";
  entityId: string;
  message: string;
}

export interface InvariantReport {
  checkedAt: string;
  ok: boolean;
  errors: number;
  warnings: number;
  violations: InvariantViolation[];
}

interface Row {
  id: string;
  ref: string | null;
  detail: string | null;
}

type Check = {
  code: InvariantCode;
  severity: InvariantViolation["severity"];
  entityType: InvariantViolation["entityType"];
  run: (db: PrismaClient) => Promise<Row[]>;
  message: (row: Row) => string;
};

const CHECKS: Check[] = [
  {
    code: "INVOICE_FINANCED_WITHOUT_ACCEPTED_OFFER",
    severity: "error",
    entityType: "Invoice",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT i.id, i."invoiceNumber" AS ref, i."financingStatus"::text AS detail FROM "Invoice" i
      WHERE i."financingStatus" NOT IN ('NOT_REQUESTED', 'REQUESTED', 'OFFER_GENERATED')
        AND NOT EXISTS (SELECT 1 FROM "FinancingOffer" o WHERE o."invoiceId" = i.id AND o.status = 'ACCEPTED')`,
    message: (r) => `Invoice ${r.ref} is ${r.detail} but has no accepted offer.`,
  },
  {
    code: "INVOICE_FINANCED_WITHOUT_REQUEST",
    severity: "error",
    entityType: "Invoice",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT i.id, i."invoiceNumber" AS ref, i."financingStatus"::text AS detail FROM "Invoice" i
      WHERE i."financingStatus" NOT IN ('NOT_REQUESTED', 'REQUESTED', 'OFFER_GENERATED')
        AND NOT EXISTS (SELECT 1 FROM "FinancingRequest" r WHERE r."invoiceId" = i.id)`,
    message: (r) => `Invoice ${r.ref} is ${r.detail} but has no financing request.`,
  },
  {
    code: "INVOICE_FINANCING_BEFORE_ACCEPTANCE",
    severity: "error",
    entityType: "Invoice",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT i.id, i."invoiceNumber" AS ref, i.status::text || '/' || i."financingStatus"::text AS detail FROM "Invoice" i
      WHERE i.status <> 'ACCEPTED' AND i."financingStatus" <> 'NOT_REQUESTED'`,
    message: (r) => `Invoice ${r.ref} has financing activity without builder acceptance (${r.detail}).`,
  },
  {
    code: "INVOICE_MULTIPLE_ACCEPTED_OFFERS",
    severity: "error",
    entityType: "Invoice",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT i.id, i."invoiceNumber" AS ref, COUNT(o.id)::text AS detail FROM "Invoice" i
      JOIN "FinancingOffer" o ON o."invoiceId" = i.id AND o.status = 'ACCEPTED'
      GROUP BY i.id, i."invoiceNumber" HAVING COUNT(o.id) > 1`,
    message: (r) => `Invoice ${r.ref} has ${r.detail} accepted offers.`,
  },
  {
    code: "INVOICE_MULTIPLE_OPEN_OFFERS",
    severity: "error",
    entityType: "Invoice",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT i.id, i."invoiceNumber" AS ref, COUNT(o.id)::text AS detail FROM "Invoice" i
      JOIN "FinancingOffer" o ON o."invoiceId" = i.id AND o.status = 'OFFERED'
      GROUP BY i.id, i."invoiceNumber" HAVING COUNT(o.id) > 1`,
    message: (r) => `Invoice ${r.ref} has ${r.detail} open offers at once.`,
  },
  {
    code: "REQUEST_STATUS_MISMATCH",
    severity: "error",
    entityType: "FinancingRequest",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT r.id, r.reference AS ref, r.status::text || ' vs invoice ' || i."financingStatus"::text AS detail
      FROM "FinancingRequest" r JOIN "Invoice" i ON i.id = r."invoiceId"
      WHERE r.status <> i."financingStatus"`,
    message: (r) => `Request ${r.ref} status disagrees with its invoice (${r.detail}).`,
  },
  {
    code: "REQUEST_PARTY_MISMATCH",
    severity: "error",
    entityType: "FinancingRequest",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT r.id, r.reference AS ref, NULL AS detail
      FROM "FinancingRequest" r
      JOIN "Invoice" i ON i.id = r."invoiceId"
      JOIN "FinancingProgramme" p ON p.id = r."programmeId"
      WHERE r."cpId" <> i."cpId" OR r."builderId" <> i."builderId" OR r."financierId" <> p."financierId" OR p."builderId" <> i."builderId"`,
    message: (r) => `Request ${r.ref} names a partner, builder or financier that does not match its invoice and programme.`,
  },
  {
    code: "REQUEST_OFFER_MISMATCH",
    severity: "error",
    entityType: "FinancingRequest",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT r.id, r.reference AS ref, o.reference || ' (' || o.status::text || ')' AS detail
      FROM "FinancingRequest" r JOIN "FinancingOffer" o ON o.id = r."offerId"
      WHERE o.status <> 'ACCEPTED' OR o."invoiceId" <> r."invoiceId" OR o."programmeId" <> r."programmeId"
         OR o."approvedAmountPaise" <> r."approvedAmountPaise" OR o."discountRateBps" <> r."discountRateBps"
         OR o."tdsPaise" <> r."tdsPaise" OR o."financedAmountPaise" <> r."financedAmountPaise"
         OR o."discountAmountPaise" <> r."discountAmountPaise" OR o."chargesPaise" <> r."chargesPaise"
         OR o."netPayablePaise" <> r."netPayablePaise"`,
    message: (r) => `Request ${r.ref} does not carry the figures of its accepted offer ${r.detail}.`,
  },
  {
    code: "REQUEST_ARITHMETIC",
    severity: "error",
    entityType: "FinancingRequest",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT r.id, r.reference AS ref, NULL AS detail FROM "FinancingRequest" r
      WHERE r."approvedAmountPaise" - r."tdsPaise" <> r."financedAmountPaise"
         OR r."financedAmountPaise" - r."discountAmountPaise" - r."chargesPaise" <> r."netPayablePaise"
         OR r."processingFeePaise" + r."feeGstPaise" <> r."chargesPaise"
         OR r."netPayablePaise" <= 0 OR r."discountAmountPaise" < 0 OR r."tdsPaise" < 0`,
    message: (r) => `Request ${r.ref} figures do not add up (approved − TDS = financed; financed − discount − charges = net).`,
  },
  {
    code: "OFFER_ARITHMETIC",
    severity: "error",
    entityType: "FinancingOffer",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT o.id, o.reference AS ref, NULL AS detail FROM "FinancingOffer" o
      WHERE o."approvedAmountPaise" - o."tdsPaise" <> o."financedAmountPaise"
         OR o."financedAmountPaise" - o."discountAmountPaise" - o."chargesPaise" <> o."netPayablePaise"
         OR o."processingFeePaise" + o."feeGstPaise" <> o."chargesPaise"
         OR o."netPayablePaise" <= 0`,
    message: (r) => `Offer ${r.ref} figures do not add up.`,
  },
  {
    code: "DISBURSEMENT_AMOUNT_MISMATCH",
    severity: "error",
    entityType: "Disbursement",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT d.id, d.reference AS ref, d."amountPaise"::text || ' vs net ' || r."netPayablePaise"::text AS detail
      FROM "Disbursement" d JOIN "FinancingRequest" r ON r.id = d."requestId"
      WHERE d."amountPaise" <> r."netPayablePaise"`,
    message: (r) => `Disbursement ${r.ref} amount differs from the request's net payable (${r.detail} paise).`,
  },
  {
    code: "DISBURSEMENT_STATE_MISMATCH",
    severity: "error",
    entityType: "FinancingRequest",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT r.id, r.reference AS ref, r.status::text || ' / ' || COALESCE(d.status::text, 'no disbursement') AS detail
      FROM "FinancingRequest" r LEFT JOIN "Disbursement" d ON d."requestId" = r.id
      WHERE (r.status = 'DISBURSEMENT_INITIATED' AND (d.id IS NULL OR d.status <> 'INITIATED'))
         OR (r.status = 'DISBURSED' AND (d.id IS NULL OR d.status <> 'SUCCESS'))
         OR (d.id IS NOT NULL AND r.status NOT IN ('DISBURSEMENT_INITIATED', 'DISBURSED'))
         OR (d.status = 'SUCCESS' AND (d.utr IS NULL OR d."completedAt" IS NULL))`,
    message: (r) => `Request ${r.ref} and its disbursement disagree (${r.detail}).`,
  },
  {
    code: "SETTLEMENT_AMOUNT_MISMATCH",
    severity: "error",
    entityType: "Settlement",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT s.id, r.reference AS ref, s."amountPaise"::text || ' vs financed ' || r."financedAmountPaise"::text AS detail
      FROM "Settlement" s JOIN "FinancingRequest" r ON r.id = s."requestId"
      WHERE s."amountPaise" <> r."financedAmountPaise"`,
    message: (r) => `Settlement for ${r.ref} differs from the financed amount (${r.detail} paise).`,
  },
  {
    code: "SETTLEMENT_STATE_MISMATCH",
    severity: "error",
    entityType: "FinancingRequest",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT r.id, r.reference AS ref, r.status::text || ' / ' || COALESCE(s.status::text, 'no settlement') AS detail
      FROM "FinancingRequest" r LEFT JOIN "Settlement" s ON s."requestId" = r.id
      WHERE (r.status = 'DISBURSED' AND s.id IS NULL)
         OR (s.id IS NOT NULL AND r.status <> 'DISBURSED')
         OR (s.id IS NOT NULL AND (s."builderId" <> r."builderId" OR s."financierId" <> r."financierId"))`,
    message: (r) => `Request ${r.ref} and its settlement disagree (${r.detail}).`,
  },
  {
    code: "SETTLED_WITHOUT_SETTLED_AT",
    severity: "error",
    entityType: "Settlement",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT s.id, r.reference AS ref, NULL AS detail FROM "Settlement" s JOIN "FinancingRequest" r ON r.id = s."requestId"
      WHERE s.status = 'SETTLED' AND (s."settledAt" IS NULL OR s.reference IS NULL)`,
    message: (r) => `Settlement for ${r.ref} is settled without a settlement date or reference.`,
  },
  {
    code: "OPEN_SETTLEMENT_WITH_SETTLED_AT",
    severity: "error",
    entityType: "Settlement",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT s.id, r.reference AS ref, s.status::text AS detail FROM "Settlement" s JOIN "FinancingRequest" r ON r.id = s."requestId"
      WHERE s.status <> 'SETTLED' AND s."settledAt" IS NOT NULL`,
    message: (r) => `Settlement for ${r.ref} is ${r.detail} but records a settlement date.`,
  },
  {
    code: "MULTIPLE_ACTIVE_PROGRAMMES",
    severity: "error",
    entityType: "Organisation",
    run: (db) => db.$queryRaw<Row[]>`
      SELECT p."builderId" AS id, o.name AS ref, string_agg(p.code, ', ' ORDER BY p.code) AS detail
      FROM "FinancingProgramme" p JOIN "Organisation" o ON o.id = p."builderId"
      WHERE p.status = 'ACTIVE'
      GROUP BY p."builderId", o.name HAVING COUNT(*) > 1`,
    message: (r) => `Builder ${r.ref} has more than one active programme (${r.detail}).`,
  },
];

async function staleSettlements(db: PrismaClient, now: Date): Promise<InvariantViolation[]> {
  const open = await db.settlement.findMany({
    where: { status: { not: "SETTLED" } },
    select: { id: true, status: true, dueDate: true, request: { select: { reference: true } } },
  });
  return open
    .filter((s) => deriveSettlementStatus(s.dueDate, now) !== s.status)
    .map((s) => ({
      code: "SETTLEMENT_STATUS_STALE" as const,
      severity: "warning" as const,
      entityType: "Settlement" as const,
      entityId: s.id,
      message: `Settlement for ${s.request.reference} is stored as ${s.status} but is ${deriveSettlementStatus(s.dueDate, now)} today (IST); run the status recompute.`,
    }));
}

/** Scans the database and reports every violated financing invariant. */
export async function checkFinancingInvariants(db: PrismaClient, now: Date = new Date()): Promise<InvariantReport> {
  const violations: InvariantViolation[] = [];
  for (const check of CHECKS) {
    const rows = await check.run(db);
    for (const row of rows) {
      violations.push({ code: check.code, severity: check.severity, entityType: check.entityType, entityId: row.id, message: check.message(row) });
    }
  }
  violations.push(...(await staleSettlements(db, now)));
  const errors = violations.filter((v) => v.severity === "error").length;
  return { checkedAt: now.toISOString(), ok: errors === 0, errors, warnings: violations.length - errors, violations };
}
