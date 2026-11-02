-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "OrganisationUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "designation" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganisationUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrganisationUser_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrganisationUser_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "builderId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "location" TEXT,
    "reraNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Project_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CpBuilderRelationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cpId" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "empanelmentCode" TEXT NOT NULL,
    "creditPeriodDays" INTEGER NOT NULL DEFAULT 60,
    "empanelledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CpBuilderRelationship_cpId_fkey" FOREIGN KEY ("cpId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CpBuilderRelationship_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinancingProgramme" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "financierId" TEXT NOT NULL,
    "discountRateBps" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "offerValidityDays" INTEGER NOT NULL DEFAULT 7,
    "terms" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FinancingProgramme_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FinancingProgramme_financierId_fkey" FOREIGN KEY ("financierId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "cpId" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "invoiceDate" DATETIME NOT NULL,
    "dueDate" DATETIME,
    "amountPaise" BIGINT NOT NULL,
    "gstAmountPaise" BIGINT,
    "approvedAmountPaise" BIGINT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "financingStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "latestReviewNote" TEXT,
    "submittedAt" DATETIME,
    "decidedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_cpId_fkey" FOREIGN KEY ("cpId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "comment" TEXT,
    "actorUserId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "actorOrgId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceApproval_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinancingOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "status" TEXT NOT NULL DEFAULT 'OFFERED',
    "generatedById" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATETIME NOT NULL,
    "acceptedById" TEXT,
    "acceptedAt" DATETIME,
    "consentText" TEXT,
    CONSTRAINT "FinancingOffer_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FinancingOffer_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "FinancingProgramme" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinancingRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "acceptedById" TEXT NOT NULL,
    "acceptedAt" DATETIME NOT NULL,
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    "decisionNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FinancingRequest_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FinancingRequest_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "FinancingOffer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FinancingRequest_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "FinancingProgramme" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FinancingRequest_cpId_fkey" FOREIGN KEY ("cpId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FinancingRequest_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FinancingRequest_financierId_fkey" FOREIGN KEY ("financierId") REFERENCES "Organisation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinancingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinancingEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FinancingRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InternalComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InternalComment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FinancingRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Disbursement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "mode" TEXT NOT NULL DEFAULT 'DEMO_SIMULATED',
    "beneficiaryName" TEXT NOT NULL,
    "beneficiaryAccount" TEXT NOT NULL,
    "beneficiaryIfsc" TEXT NOT NULL,
    "utr" TEXT,
    "initiatedById" TEXT NOT NULL,
    "initiatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedById" TEXT,
    "completedAt" DATETIME,
    CONSTRAINT "Disbursement_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FinancingRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "builderId" TEXT NOT NULL,
    "financierId" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_DUE',
    "reference" TEXT,
    "settledAt" DATETIME,
    "settledById" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Settlement_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FinancingRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorOrgId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Sequence" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "value" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL
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
