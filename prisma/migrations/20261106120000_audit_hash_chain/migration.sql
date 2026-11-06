-- Tamper-evident audit chain: a gapless global position (seq) plus prevHash/hash/hashKeyId per row,
-- HMAC-signed daily anchors of the chain head, and a record of every verification run.
--
-- Existing rows receive seq in (createdAt, id) order here, and the highest such seq is fixed as the
-- legacy cutoff in "AuditChainState". Those rows (and only those) are sealed once by
-- `npm run audit:backfill`, which needs AUDIT_HMAC_KEY and therefore cannot run in SQL.

-- CreateEnum
CREATE TYPE "AuditChainStatus" AS ENUM ('VERIFIED', 'BROKEN', 'EMPTY');

-- DropIndex
DROP INDEX "AuditLog_createdAt_idx";

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "hash" TEXT,
ADD COLUMN "hashKeyId" TEXT,
ADD COLUMN "prevHash" TEXT,
ADD COLUMN "seq" BIGINT;

-- Backfill the chain position of existing rows in insertion order.
UPDATE "AuditLog" AS a
SET "seq" = ordered.position
FROM (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS position
  FROM "AuditLog"
) AS ordered
WHERE a."id" = ordered."id";

ALTER TABLE "AuditLog" ALTER COLUMN "seq" SET NOT NULL;

-- CreateTable
CREATE TABLE "AuditChainState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "legacyCutoffSeq" BIGINT NOT NULL,
    "legacySealedAt" TIMESTAMP(3),

    CONSTRAINT "AuditChainState_pkey" PRIMARY KEY ("id")
);

-- Fix the legacy cutoff once; an empty log has nothing to seal.
INSERT INTO "AuditChainState" ("id", "legacyCutoffSeq", "legacySealedAt")
SELECT 1, COALESCE(MAX("seq"), 0), CASE WHEN COUNT(*) = 0 THEN CURRENT_TIMESTAMP ELSE NULL END
FROM "AuditLog";

-- CreateTable
CREATE TABLE "AuditAnchor" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "hash" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "anchoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditAnchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditChainCheck" (
    "id" TEXT NOT NULL,
    "status" "AuditChainStatus" NOT NULL,
    "checkedRows" INTEGER NOT NULL,
    "headSeq" BIGINT,
    "verifiedThroughSeq" BIGINT,
    "brokenSeq" BIGINT,
    "brokenAuditId" TEXT,
    "brokenReason" TEXT,
    "anchorsChecked" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL,
    "triggeredById" TEXT,
    "triggeredByName" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditChainCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditAnchor_day_key" ON "AuditAnchor"("day");

-- CreateIndex
CREATE INDEX "AuditAnchor_seq_idx" ON "AuditAnchor"("seq");

-- CreateIndex
CREATE INDEX "AuditChainCheck_checkedAt_idx" ON "AuditChainCheck"("checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_seq_key" ON "AuditLog"("seq");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt", "id");
