-- CreateEnum
CREATE TYPE "InvoiceDocumentScanStatus" AS ENUM ('CLEAN', 'NOT_SCANNED');

-- CreateEnum
CREATE TYPE "InvoiceDuplicateKind" AS ENUM ('NEAR_DUPLICATE', 'SAME_IRN', 'SAME_DOCUMENT_OTHER_PARTNER', 'EXTERNAL_REGISTRY');

-- CreateEnum
CREATE TYPE "InvoiceDuplicateFlagStatus" AS ENUM ('OPEN', 'CLEARED', 'CONFIRMED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "agreementBrokerageBps" INTEGER,
ADD COLUMN     "agreementBrokeragePaise" BIGINT,
ADD COLUMN     "agreementDate" TIMESTAMP(3),
ADD COLUMN     "agreementRegistrationNumber" TEXT,
ADD COLUMN     "agreementValuePaise" BIGINT,
ADD COLUMN     "bookingTower" TEXT,
ADD COLUMN     "bookingUnit" TEXT,
ADD COLUMN     "buyerInitials" TEXT,
ADD COLUMN     "cgstPaise" BIGINT,
ADD COLUMN     "eInvoiceAckDate" TIMESTAMP(3),
ADD COLUMN     "eInvoiceAckNumber" TEXT,
ADD COLUMN     "gstRateBps" INTEGER,
ADD COLUMN     "igstPaise" BIGINT,
ADD COLUMN     "irn" TEXT,
ADD COLUMN     "placeOfSupplyStateCode" TEXT,
ADD COLUMN     "recipientGstin" TEXT,
ADD COLUMN     "sgstPaise" BIGINT,
ADD COLUMN     "supplierGstin" TEXT,
ADD COLUMN     "taxableValuePaise" BIGINT,
ADD COLUMN     "tdsRateBps" INTEGER;

-- AlterTable
ALTER TABLE "InvoiceApproval" ADD COLUMN     "attestation" JSONB,
ADD COLUMN     "attestedAt" TIMESTAMP(3),
ADD COLUMN     "attestedById" TEXT,
ADD COLUMN     "attestedByName" TEXT;

-- AlterTable
ALTER TABLE "InvoiceDocument" ADD COLUMN     "pageCount" INTEGER,
ADD COLUMN     "scanStatus" "InvoiceDocumentScanStatus",
ADD COLUMN     "validatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "InvoiceFingerprint" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supplierKey" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "numberKey" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "totalPaise" BIGINT NOT NULL,
    "irn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceDuplicateFlag" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "matchedInvoiceId" TEXT,
    "externalRef" TEXT,
    "kind" "InvoiceDuplicateKind" NOT NULL,
    "detail" TEXT NOT NULL,
    "status" "InvoiceDuplicateFlagStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceDuplicateFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceMatchPolicy" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "attestationOptional" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceMatchPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceFingerprint_invoiceId_key" ON "InvoiceFingerprint"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceFingerprint_fingerprint_key" ON "InvoiceFingerprint"("fingerprint");

-- CreateIndex
CREATE INDEX "InvoiceFingerprint_supplierKey_recipientKey_totalPaise_idx" ON "InvoiceFingerprint"("supplierKey", "recipientKey", "totalPaise");

-- CreateIndex
CREATE INDEX "InvoiceFingerprint_irn_idx" ON "InvoiceFingerprint"("irn");

-- CreateIndex
CREATE INDEX "InvoiceDuplicateFlag_invoiceId_status_idx" ON "InvoiceDuplicateFlag"("invoiceId", "status");

-- CreateIndex
CREATE INDEX "InvoiceDuplicateFlag_matchedInvoiceId_idx" ON "InvoiceDuplicateFlag"("matchedInvoiceId");

-- CreateIndex
CREATE INDEX "InvoiceDuplicateFlag_status_createdAt_idx" ON "InvoiceDuplicateFlag"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceMatchPolicy_programmeId_key" ON "InvoiceMatchPolicy"("programmeId");

-- CreateIndex
CREATE INDEX "Invoice_irn_idx" ON "Invoice"("irn");

-- AddForeignKey
ALTER TABLE "InvoiceFingerprint" ADD CONSTRAINT "InvoiceFingerprint_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDuplicateFlag" ADD CONSTRAINT "InvoiceDuplicateFlag_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDuplicateFlag" ADD CONSTRAINT "InvoiceDuplicateFlag_matchedInvoiceId_fkey" FOREIGN KEY ("matchedInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: snapshot both organisations' GSTINs and the taxable value on existing invoices.
UPDATE "Invoice" AS i
SET "supplierGstin" = NULLIF(upper(regexp_replace(cp."gstin", '\s', '', 'g')), ''),
    "recipientGstin" = NULLIF(upper(regexp_replace(b."gstin", '\s', '', 'g')), '')
FROM "Organisation" AS cp, "Organisation" AS b
WHERE cp."id" = i."cpId" AND b."id" = i."builderId";

UPDATE "Invoice"
SET "taxableValuePaise" = "amountPaise" - "gstAmountPaise"
WHERE "gstAmountPaise" IS NOT NULL AND "taxableValuePaise" IS NULL;

-- Backfill: register a fingerprint for every existing invoice. Must stay identical to
-- canonicalFingerprintInput() in src/lib/invoice-integrity/fingerprint.ts (version 1).
INSERT INTO "InvoiceFingerprint" ("id", "invoiceId", "fingerprint", "version", "supplierKey", "recipientKey", "numberKey", "invoiceDate", "totalPaise", "irn")
SELECT 'fpb_' || k."invoiceId",
       k."invoiceId",
       encode(sha256(convert_to('v1|' || k."supplierKey" || '|' || k."recipientKey" || '|' || k."numberKey" || '|' || to_char(k."invoiceDate", 'YYYY-MM-DD') || '|' || k."totalPaise"::text || '|' || coalesce(k."irn", ''), 'UTF8')), 'hex'),
       1,
       k."supplierKey",
       k."recipientKey",
       k."numberKey",
       k."invoiceDate",
       k."totalPaise",
       k."irn"
FROM (
  SELECT i."id" AS "invoiceId",
         coalesce(i."supplierGstin", 'ORG:' || i."cpId") AS "supplierKey",
         coalesce(i."recipientGstin", 'ORG:' || i."builderId") AS "recipientKey",
         upper(regexp_replace(i."invoiceNumber", '[^A-Za-z0-9]', '', 'g')) AS "numberKey",
         i."invoiceDate",
         i."amountPaise" AS "totalPaise",
         lower(i."irn") AS "irn"
  FROM "Invoice" AS i
) AS k
ON CONFLICT DO NOTHING;
