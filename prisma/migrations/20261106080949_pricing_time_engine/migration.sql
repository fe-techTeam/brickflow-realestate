-- Pricing engine, IST business calendar and idempotent money transitions.
-- Existing offers and requests are backfilled as legacy flat-percentage quotes with no TDS:
-- the financed amount equals the builder-approved amount, matching how they were priced.

-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('FLAT_PERCENT', 'ANNUAL_RATE');

-- CreateEnum
CREATE TYPE "HolidayRule" AS ENUM ('NONE', 'NEXT_BUSINESS_DAY');

-- AlterTable
ALTER TABLE "FinancingOffer" ADD COLUMN     "annualisedRateBps" INTEGER,
ADD COLUMN     "feeGstPaise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "financedAmountPaise" BIGINT,
ADD COLUMN     "pricedDueDate" TIMESTAMP(3),
ADD COLUMN     "pricingMode" "PricingMode" NOT NULL DEFAULT 'FLAT_PERCENT',
ADD COLUMN     "pricingRuleVersion" TEXT NOT NULL DEFAULT 'flat/2026-04',
ADD COLUMN     "pricingSnapshot" JSONB,
ADD COLUMN     "processingFeePaise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "tdsPaise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "tenorDays" INTEGER;

-- AlterTable
ALTER TABLE "FinancingProgramme" ADD COLUMN     "feeGstRateBps" INTEGER NOT NULL DEFAULT 1800,
ADD COLUMN     "holidayRule" "HolidayRule" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "invoiceGstRateBps" INTEGER NOT NULL DEFAULT 1800,
ADD COLUMN     "maxTenorDays" INTEGER,
ADD COLUMN     "minDiscountPaise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "minTenorDays" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "pricingMode" "PricingMode" NOT NULL DEFAULT 'FLAT_PERCENT',
ADD COLUMN     "processingFeeBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "processingFeeFlatPaise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "tdsDeducted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tdsRateBps" INTEGER NOT NULL DEFAULT 200;

-- AlterTable
ALTER TABLE "FinancingRequest" ADD COLUMN     "annualisedRateBps" INTEGER,
ADD COLUMN     "feeGstPaise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "financedAmountPaise" BIGINT,
ADD COLUMN     "pricedDueDate" TIMESTAMP(3),
ADD COLUMN     "pricingMode" "PricingMode" NOT NULL DEFAULT 'FLAT_PERCENT',
ADD COLUMN     "pricingRuleVersion" TEXT NOT NULL DEFAULT 'flat/2026-04',
ADD COLUMN     "pricingSnapshot" JSONB,
ADD COLUMN     "processingFeePaise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "tdsPaise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "tenorDays" INTEGER;

-- Backfill legacy rows, then enforce the column.
UPDATE "FinancingOffer" SET "financedAmountPaise" = "approvedAmountPaise" WHERE "financedAmountPaise" IS NULL;
UPDATE "FinancingRequest" SET "financedAmountPaise" = "approvedAmountPaise" WHERE "financedAmountPaise" IS NULL;
ALTER TABLE "FinancingOffer" ALTER COLUMN "financedAmountPaise" SET NOT NULL;
ALTER TABLE "FinancingRequest" ALTER COLUMN "financedAmountPaise" SET NOT NULL;

-- CreateTable
CREATE TABLE "BusinessHoliday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancingIdempotencyKey" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "resultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancingIdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessHoliday_date_key" ON "BusinessHoliday"("date");

-- CreateIndex
CREATE INDEX "FinancingIdempotencyKey_createdAt_idx" ON "FinancingIdempotencyKey"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancingIdempotencyKey_actorUserId_scope_key_key" ON "FinancingIdempotencyKey"("actorUserId", "scope", "key");
