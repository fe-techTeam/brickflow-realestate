-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VerificationCheckType" AS ENUM ('GSTIN', 'PAN', 'BANK_ACCOUNT', 'UDYAM', 'E_INVOICE', 'RERA_AGENT');

-- CreateEnum
CREATE TYPE "VerificationSubject" AS ENUM ('ORGANISATION', 'BANK_ACCOUNT', 'INVOICE');

-- CreateEnum
CREATE TYPE "VerificationCheckStatus" AS ENUM ('PENDING', 'VERIFIED', 'REVIEW_REQUIRED', 'FAILED', 'REJECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "BankAccountStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REVIEW_REQUIRED', 'FAILED', 'REJECTED');

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "gstRegistered" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "kycStatusAt" TIMESTAMP(3),
ADD COLUMN     "kycVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "panEncrypted" TEXT,
ADD COLUMN     "panMasked" TEXT;

-- Organisations without a GSTIN on file are treated as not GST-registered.
UPDATE "Organisation" SET "gstRegistered" = ("gstin" IS NOT NULL);

-- Encryption of existing PAN and bank account numbers needs DATA_ENCRYPTION_KEY, so it runs in
-- scripts/migrate-kyc-data.ts (invoked by the container entrypoint after migrations), not here.

-- CreateTable
CREATE TABLE "VerificationCheck" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "type" "VerificationCheckType" NOT NULL,
    "subject" "VerificationSubject" NOT NULL DEFAULT 'ORGANISATION',
    "subjectRef" TEXT,
    "inputFingerprint" TEXT NOT NULL,
    "inputMasked" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "status" "VerificationCheckStatus" NOT NULL,
    "result" JSONB,
    "nameMatchScore" INTEGER,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errorKind" TEXT,
    "errorCode" TEXT,
    "rawResponseHash" TEXT,
    "rawResponseRedacted" JSONB,
    "cachedFromId" TEXT,
    "requestId" TEXT,
    "requestedById" TEXT,
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "accountNumberEncrypted" TEXT NOT NULL,
    "accountNumberLast4" TEXT NOT NULL,
    "accountFingerprint" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "bankName" TEXT,
    "branch" TEXT,
    "accountHolderName" TEXT NOT NULL,
    "beneficiaryName" TEXT,
    "verificationStatus" "BankAccountStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "primarySince" TIMESTAMP(3),
    "coolingOffUntil" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycDocument" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "checkId" TEXT,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationCheck_organisationId_type_checkedAt_idx" ON "VerificationCheck"("organisationId", "type", "checkedAt");

-- CreateIndex
CREATE INDEX "VerificationCheck_type_provider_inputFingerprint_checkedAt_idx" ON "VerificationCheck"("type", "provider", "inputFingerprint", "checkedAt");

-- CreateIndex
CREATE INDEX "VerificationCheck_status_checkedAt_idx" ON "VerificationCheck"("status", "checkedAt");

-- CreateIndex
CREATE INDEX "VerificationCheck_bankAccountId_checkedAt_idx" ON "VerificationCheck"("bankAccountId", "checkedAt");

-- CreateIndex
CREATE INDEX "VerificationCheck_type_expiresAt_idx" ON "VerificationCheck"("type", "expiresAt");

-- CreateIndex
CREATE INDEX "BankAccount_accountFingerprint_idx" ON "BankAccount"("accountFingerprint");

-- CreateIndex
CREATE INDEX "BankAccount_organisationId_isPrimary_idx" ON "BankAccount"("organisationId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_organisationId_accountFingerprint_key" ON "BankAccount"("organisationId", "accountFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "KycDocument_storageKey_key" ON "KycDocument"("storageKey");

-- CreateIndex
CREATE INDEX "KycDocument_organisationId_kind_idx" ON "KycDocument"("organisationId", "kind");

-- CreateIndex
CREATE INDEX "Organisation_kycStatus_idx" ON "Organisation"("kycStatus");

-- AddForeignKey
ALTER TABLE "VerificationCheck" ADD CONSTRAINT "VerificationCheck_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCheck" ADD CONSTRAINT "VerificationCheck_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "VerificationCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
