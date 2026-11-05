-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganisationType" AS ENUM ('PLATFORM', 'FINANCIER', 'BUILDER', 'CHANNEL_PARTNER');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RoleKey" AS ENUM ('SUPER_ADMIN', 'FINANCE_OPS', 'BUILDER_ACCOUNTS', 'CP_ADMIN');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CLARIFICATION_REQUESTED', 'REJECTED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "FinancingStatus" AS ENUM ('NOT_REQUESTED', 'REQUESTED', 'OFFER_GENERATED', 'ACCEPTED_BY_CP', 'PENDING_APPROVAL', 'APPROVED', 'DISBURSEMENT_INITIATED', 'DISBURSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('NOT_DUE', 'DUE', 'SETTLED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "ProgrammeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'CLARIFICATION_REQUESTED', 'RESUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DisbursementStatus" AS ENUM ('INITIATED', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "type" "OrganisationType" NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "gstin" TEXT,
    "pan" TEXT,
    "reraNumber" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" "RoleKey" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationUser" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "designation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganisationUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "location" TEXT,
    "reraNumber" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CpBuilderRelationship" (
    "id" TEXT NOT NULL,
    "cpId" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "empanelmentCode" TEXT NOT NULL,
    "creditPeriodDays" INTEGER NOT NULL DEFAULT 60,
    "empanelledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CpBuilderRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancingProgramme" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "financierId" TEXT NOT NULL,
    "discountRateBps" INTEGER NOT NULL,
    "status" "ProgrammeStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "offerValidityDays" INTEGER NOT NULL DEFAULT 7,
    "terms" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancingProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "cpId" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "amountPaise" BIGINT NOT NULL,
    "gstAmountPaise" BIGINT,
    "approvedAmountPaise" BIGINT,
    "description" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "financingStatus" "FinancingStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "latestReviewNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceDocument" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceApproval" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "fromStatus" "InvoiceStatus",
    "toStatus" "InvoiceStatus" NOT NULL,
    "comment" TEXT,
    "actorUserId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "actorOrgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancingOffer" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "invoiceAmountPaise" BIGINT NOT NULL,
    "approvedAmountPaise" BIGINT NOT NULL,
    "discountRateBps" INTEGER NOT NULL,
    "discountAmountPaise" BIGINT NOT NULL,
    "chargesPaise" BIGINT NOT NULL DEFAULT 0,
    "netPayablePaise" BIGINT NOT NULL,
    "termsSnapshot" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'OFFERED',
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "consentText" TEXT,

    CONSTRAINT "FinancingOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancingRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "cpId" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "financierId" TEXT NOT NULL,
    "approvedAmountPaise" BIGINT NOT NULL,
    "discountRateBps" INTEGER NOT NULL,
    "discountAmountPaise" BIGINT NOT NULL,
    "chargesPaise" BIGINT NOT NULL DEFAULT 0,
    "netPayablePaise" BIGINT NOT NULL,
    "status" "FinancingStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "acceptedById" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancingEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromStatus" "FinancingStatus",
    "toStatus" "FinancingStatus" NOT NULL,
    "note" TEXT,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalComment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disbursement" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "status" "DisbursementStatus" NOT NULL DEFAULT 'INITIATED',
    "mode" TEXT NOT NULL DEFAULT 'DEMO_SIMULATED',
    "beneficiaryName" TEXT NOT NULL,
    "beneficiaryAccount" TEXT NOT NULL,
    "beneficiaryIfsc" TEXT NOT NULL,
    "utr" TEXT,
    "initiatedById" TEXT NOT NULL,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Disbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "financierId" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'NOT_DUE',
    "reference" TEXT,
    "settledAt" TIMESTAMP(3),
    "settledById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorOrgId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Organisation_type_status_idx" ON "Organisation"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE INDEX "OrganisationUser_organisationId_idx" ON "OrganisationUser"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationUser_userId_organisationId_key" ON "OrganisationUser"("userId", "organisationId");

-- CreateIndex
CREATE INDEX "Project_builderId_status_idx" ON "Project"("builderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_builderId_code_key" ON "Project"("builderId", "code");

-- CreateIndex
CREATE INDEX "CpBuilderRelationship_builderId_idx" ON "CpBuilderRelationship"("builderId");

-- CreateIndex
CREATE UNIQUE INDEX "CpBuilderRelationship_cpId_builderId_key" ON "CpBuilderRelationship"("cpId", "builderId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancingProgramme_code_key" ON "FinancingProgramme"("code");

-- CreateIndex
CREATE INDEX "FinancingProgramme_builderId_status_effectiveFrom_idx" ON "FinancingProgramme"("builderId", "status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_reference_key" ON "Invoice"("reference");

-- CreateIndex
CREATE INDEX "Invoice_builderId_status_idx" ON "Invoice"("builderId", "status");

-- CreateIndex
CREATE INDEX "Invoice_cpId_status_idx" ON "Invoice"("cpId", "status");

-- CreateIndex
CREATE INDEX "Invoice_financingStatus_idx" ON "Invoice"("financingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_cpId_builderId_invoiceNumber_key" ON "Invoice"("cpId", "builderId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceDocument_storageKey_key" ON "InvoiceDocument"("storageKey");

-- CreateIndex
CREATE INDEX "InvoiceDocument_invoiceId_idx" ON "InvoiceDocument"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceDocument_sha256_idx" ON "InvoiceDocument"("sha256");

-- CreateIndex
CREATE INDEX "InvoiceApproval_invoiceId_createdAt_idx" ON "InvoiceApproval"("invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancingOffer_reference_key" ON "FinancingOffer"("reference");

-- CreateIndex
CREATE INDEX "FinancingOffer_invoiceId_status_idx" ON "FinancingOffer"("invoiceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FinancingRequest_reference_key" ON "FinancingRequest"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "FinancingRequest_invoiceId_key" ON "FinancingRequest"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancingRequest_offerId_key" ON "FinancingRequest"("offerId");

-- CreateIndex
CREATE INDEX "FinancingRequest_financierId_status_idx" ON "FinancingRequest"("financierId", "status");

-- CreateIndex
CREATE INDEX "FinancingRequest_builderId_status_idx" ON "FinancingRequest"("builderId", "status");

-- CreateIndex
CREATE INDEX "FinancingRequest_cpId_status_idx" ON "FinancingRequest"("cpId", "status");

-- CreateIndex
CREATE INDEX "FinancingEvent_requestId_createdAt_idx" ON "FinancingEvent"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "InternalComment_requestId_createdAt_idx" ON "InternalComment"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Disbursement_requestId_key" ON "Disbursement"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Disbursement_reference_key" ON "Disbursement"("reference");

-- CreateIndex
CREATE INDEX "Disbursement_status_idx" ON "Disbursement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_requestId_key" ON "Settlement"("requestId");

-- CreateIndex
CREATE INDEX "Settlement_builderId_status_idx" ON "Settlement"("builderId", "status");

-- CreateIndex
CREATE INDEX "Settlement_financierId_status_idx" ON "Settlement"("financierId", "status");

-- CreateIndex
CREATE INDEX "Settlement_dueDate_idx" ON "Settlement"("dueDate");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorOrgId_createdAt_idx" ON "AuditLog"("actorOrgId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "OrganisationUser" ADD CONSTRAINT "OrganisationUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationUser" ADD CONSTRAINT "OrganisationUser_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationUser" ADD CONSTRAINT "OrganisationUser_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CpBuilderRelationship" ADD CONSTRAINT "CpBuilderRelationship_cpId_fkey" FOREIGN KEY ("cpId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CpBuilderRelationship" ADD CONSTRAINT "CpBuilderRelationship_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancingProgramme" ADD CONSTRAINT "FinancingProgramme_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancingProgramme" ADD CONSTRAINT "FinancingProgramme_financierId_fkey" FOREIGN KEY ("financierId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_cpId_fkey" FOREIGN KEY ("cpId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDocument" ADD CONSTRAINT "InvoiceDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceApproval" ADD CONSTRAINT "InvoiceApproval_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancingOffer" ADD CONSTRAINT "FinancingOffer_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancingOffer" ADD CONSTRAINT "FinancingOffer_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "FinancingProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancingRequest" ADD CONSTRAINT "FinancingRequest_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancingRequest" ADD CONSTRAINT "FinancingRequest_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "FinancingOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancingRequest" ADD CONSTRAINT "FinancingRequest_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "FinancingProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancingRequest" ADD CONSTRAINT "FinancingRequest_cpId_fkey" FOREIGN KEY ("cpId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancingRequest" ADD CONSTRAINT "FinancingRequest_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancingRequest" ADD CONSTRAINT "FinancingRequest_financierId_fkey" FOREIGN KEY ("financierId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancingEvent" ADD CONSTRAINT "FinancingEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FinancingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalComment" ADD CONSTRAINT "InternalComment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FinancingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FinancingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FinancingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
