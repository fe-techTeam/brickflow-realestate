import "server-only";
import { ANCHOR_LOG_EVENT, anchorAuditHead, CHAIN_BREAK_LABELS, runAuditChainCheck, type ChainBreakReason } from "@/lib/audit-chain";
import { recordAudit } from "../audit";
import type { Actor } from "../auth/session";
import { db } from "../db";
import { conflict, forbidden } from "../errors";
import { logger } from "../observability/logger";

function requirePlatform(actor: Actor) {
  if (actor.orgType !== "PLATFORM") throw forbidden();
}

function requireSuperAdmin(actor: Actor) {
  requirePlatform(actor);
  if (actor.role !== "SUPER_ADMIN") throw forbidden();
}

export interface AuditIntegrityStatus {
  status: "VERIFIED" | "BROKEN" | "EMPTY";
  checkedAt: Date;
  checkedRows: number;
  headSeq: string | null;
  verifiedThroughSeq: string | null;
  anchorsChecked: number;
  durationMs: number;
  triggeredByName: string;
  broken: { seq: string; reason: ChainBreakReason; label: string; auditId: string | null; summary: string | null; createdAt: Date | null } | null;
}

export interface AuditIntegrityOverview {
  latest: AuditIntegrityStatus | null;
  entries: number;
  latestAnchor: { day: string; seq: string; hash: string } | null;
}

function isBreakReason(value: string | null): value is ChainBreakReason {
  return value !== null && value in CHAIN_BREAK_LABELS;
}

/** The latest verification result, the chain length and the newest daily anchor. */
export async function getAuditIntegrity(actor: Actor): Promise<AuditIntegrityOverview> {
  requirePlatform(actor);
  const [check, head, anchor] = await Promise.all([
    db.auditChainCheck.findFirst({ orderBy: { checkedAt: "desc" } }),
    db.auditLog.findFirst({ orderBy: { seq: "desc" }, select: { seq: true } }),
    db.auditAnchor.findFirst({ orderBy: { seq: "desc" } }),
  ]);
  let latest: AuditIntegrityStatus | null = null;
  if (check) {
    const brokenEntry = check.brokenAuditId
      ? await db.auditLog.findUnique({ where: { id: check.brokenAuditId }, select: { summary: true, createdAt: true } })
      : null;
    latest = {
      status: check.status,
      checkedAt: check.checkedAt,
      checkedRows: check.checkedRows,
      headSeq: check.headSeq?.toString() ?? null,
      verifiedThroughSeq: check.verifiedThroughSeq?.toString() ?? null,
      anchorsChecked: check.anchorsChecked,
      durationMs: check.durationMs,
      triggeredByName: check.triggeredByName,
      broken:
        check.status === "BROKEN" && check.brokenSeq !== null && isBreakReason(check.brokenReason)
          ? {
              seq: check.brokenSeq.toString(),
              reason: check.brokenReason,
              label: CHAIN_BREAK_LABELS[check.brokenReason],
              auditId: check.brokenAuditId,
              summary: brokenEntry?.summary ?? null,
              createdAt: brokenEntry?.createdAt ?? null,
            }
          : null,
    };
  }
  return {
    latest,
    entries: Number(head?.seq ?? 0n),
    latestAnchor: anchor ? { day: anchor.day, seq: anchor.seq.toString(), hash: anchor.hash } : null,
  };
}

/**
 * Signs and records today's chain head, then writes it as an `audit.anchor.published` log line so it
 * reaches external log storage. Plain function for the daily scheduler; safe to call repeatedly.
 */
export async function publishDailyAuditAnchor(now: Date = new Date()) {
  const result = await anchorAuditHead(db, now);
  if (result) logger.info(ANCHOR_LOG_EVENT, { created: result.created, statement: result.anchor.statement, signature: result.anchor.signature });
  return result;
}

let running: Promise<unknown> | null = null;

/** Re-verifies every link of the audit chain now, stores the result and records who ran it. */
export async function verifyAuditChainNow(actor: Actor) {
  requireSuperAdmin(actor);
  if (running) throw conflict("A verification is already running. Try again in a moment.");
  const job = runAuditChainCheck(db, { id: actor.userId, name: actor.name });
  running = job;
  try {
    const { verification, check } = await job;
    const broken = verification.broken;
    if (broken) logger.error("audit.chain_broken", { seq: broken.seq, reason: broken.reason, auditId: broken.auditId, checkId: check.id });
    await db.$transaction((tx) =>
      recordAudit(tx, actor, {
        action: "audit.chain_verified",
        entityType: "AuditLog",
        entityId: check.id,
        summary: broken
          ? `Verified the audit chain: broken at entry ${broken.seq} (${CHAIN_BREAK_LABELS[broken.reason].toLowerCase()})`
          : `Verified the audit chain: ${verification.checkedRows} ${verification.checkedRows === 1 ? "entry" : "entries"} intact`,
        metadata: {
          status: verification.status,
          checkedRows: verification.checkedRows,
          verifiedThroughSeq: verification.verifiedThroughSeq,
          brokenSeq: broken?.seq ?? null,
          brokenReason: broken?.reason ?? null,
        },
      }),
    );
    return { status: verification.status, checkedRows: verification.checkedRows, verifiedThroughSeq: verification.verifiedThroughSeq?.toString() ?? null, brokenSeq: broken?.seq.toString() ?? null };
  } finally {
    running = null;
  }
}
