/**
 * Tamper-evident audit chain.
 *
 * Every AuditLog row has a gapless position `seq` (1, 2, 3, …) in one global chain and
 *   hash = SHA-256( canonicalJson({ v, seq, createdAt, actorUserId, actorName, actorOrgId, actorRole,
 *                                   action, entityType, entityId, summary, metadata, prevHash }) )
 * where `prevHash` is the `hash` of row `seq - 1` (null for the first row).
 *
 * Canonical JSON (version 1):
 * - object keys sorted by UTF-16 code unit order (`Array.prototype.sort`), at every depth;
 * - no insignificant whitespace; strings escaped exactly as `JSON.stringify` does;
 * - BigInt as a JSON string of its base-10 digits (`seq` 42 → "42");
 * - Date as a JSON string in ISO 8601 UTC with milliseconds (`toISOString()`), matching the
 *   millisecond precision of the `timestamp(3)` column;
 * - absent optional values are encoded as `null`; `undefined`, functions, symbols and non-finite
 *   numbers are rejected so two different rows can never serialise to the same text;
 * - `metadata` is hashed as the exact text stored in the column (it is already serialised JSON).
 *
 * Appends take a transaction-scoped PostgreSQL advisory lock, so concurrent writers are serialised
 * into a single chain. Deleting or editing any row breaks the link or the hash of that row; removing
 * the newest rows is caught by comparing against the daily anchors.
 *
 * This module has no server-only imports so the seed and the CLI scripts can use it directly.
 */
import { createHash } from "node:crypto";
import type { AuditLog, Prisma } from "../generated/prisma/client";

export const AUDIT_HASH_VERSION = 1;

/** Advisory lock key for the audit chain ("BFAUDIT1" as a 64-bit integer). */
const AUDIT_CHAIN_LOCK_SQL = "SELECT pg_advisory_xact_lock(4775576289346671665)";

type CanonicalValue = string | number | boolean | bigint | Date | null | CanonicalValue[] | { [key: string]: CanonicalValue };

/** Deterministic JSON encoding used for hashing; see the module comment for the exact rules. */
export function canonicalJson(value: CanonicalValue): string {
  if (value === null) return "null";
  if (value === undefined) throw new TypeError("canonicalJson: undefined is not allowed; use null");
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      return JSON.stringify(value.toString(10));
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite numbers are not allowed");
      return JSON.stringify(value);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError("canonicalJson: invalid Date");
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, CanonicalValue>)[key]!)}`).join(",")}}`;
  }
  throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`);
}

/** The columns covered by the hash. */
export interface AuditHashFields {
  seq: bigint;
  createdAt: Date;
  actorUserId: string | null;
  actorName: string;
  actorOrgId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata: string | null;
  prevHash: string | null;
}

export function auditHashInput(row: AuditHashFields): string {
  return canonicalJson({
    v: AUDIT_HASH_VERSION,
    seq: row.seq,
    createdAt: row.createdAt,
    actorUserId: row.actorUserId ?? null,
    actorName: row.actorName,
    actorOrgId: row.actorOrgId ?? null,
    actorRole: row.actorRole ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    summary: row.summary,
    metadata: row.metadata ?? null,
    prevHash: row.prevHash ?? null,
  });
}

export function computeAuditHash(row: AuditHashFields): string {
  return createHash("sha256").update(auditHashInput(row), "utf8").digest("hex");
}

type AuditClient = Prisma.TransactionClient;
type RootClient = AuditClient & { $transaction: <T>(fn: (tx: AuditClient) => Promise<T>, options?: { timeout?: number; maxWait?: number }) => Promise<T> };

async function lockChain(tx: AuditClient): Promise<void> {
  await tx.$executeRawUnsafe(AUDIT_CHAIN_LOCK_SQL);
}

export interface AuditEntryData {
  actorUserId: string | null;
  actorName: string;
  actorOrgId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata: string | null;
  createdAt?: Date;
}

/**
 * Appends one row to the chain. Must be called with an interactive-transaction client: the advisory
 * lock is held until that transaction commits or rolls back, so the next writer always sees this row
 * as the head. (Outside a transaction the lock would be released immediately.)
 */
export async function appendAuditEntry(client: AuditClient, entry: AuditEntryData): Promise<AuditLog> {
  await lockChain(client);
  let head = await client.auditLog.findFirst({ orderBy: { seq: "desc" }, select: { seq: true, hash: true } });
  if (head && head.hash === null) {
    await sealRows(client, Number.POSITIVE_INFINITY);
    head = await client.auditLog.findFirst({ orderBy: { seq: "desc" }, select: { seq: true, hash: true } });
  }
  const fields: AuditHashFields = {
    seq: (head?.seq ?? 0n) + 1n,
    createdAt: entry.createdAt ?? new Date(),
    actorUserId: entry.actorUserId,
    actorName: entry.actorName,
    actorOrgId: entry.actorOrgId,
    actorRole: entry.actorRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    metadata: entry.metadata,
    prevHash: head?.hash ?? null,
  };
  return client.auditLog.create({ data: { ...fields, hash: computeAuditHash(fields) } });
}

/** Seals up to `limit` unsealed rows (hash IS NULL) in seq order. Caller must hold the chain lock. */
async function sealRows(tx: AuditClient, limit: number): Promise<number> {
  const first = await tx.auditLog.findFirst({ where: { hash: null }, orderBy: { seq: "asc" }, select: { seq: true } });
  if (!first) return 0;
  const previous = first.seq > 1n ? await tx.auditLog.findUnique({ where: { seq: first.seq - 1n }, select: { hash: true } }) : null;
  let prevHash = previous?.hash ?? null;
  let cursor = first.seq;
  let sealed = 0;
  while (sealed < limit) {
    const rows = await tx.auditLog.findMany({ where: { seq: { gte: cursor } }, orderBy: { seq: "asc" }, take: Math.min(500, limit - sealed) });
    if (rows.length === 0) break;
    const updates: { id: string; prevHash: string | null; hash: string }[] = [];
    for (const row of rows) {
      if (row.hash === null) {
        const hash = computeAuditHash({ ...row, prevHash });
        updates.push({ id: row.id, prevHash, hash });
        prevHash = hash;
      } else {
        // Already sealed rows are never rewritten, so tampering cannot be laundered by re-sealing.
        prevHash = row.hash;
      }
    }
    for (const u of updates) {
      await tx.auditLog.updateMany({ where: { id: u.id, hash: null }, data: { prevHash: u.prevHash, hash: u.hash } });
    }
    sealed += updates.length;
    cursor = rows[rows.length - 1]!.seq + 1n;
  }
  return sealed;
}

/** Computes hashes for rows that predate the chain (or were written without one), in seq order. */
export async function sealAuditChain(client: RootClient, options: { batchSize?: number } = {}): Promise<number> {
  const batchSize = options.batchSize ?? 500;
  let total = 0;
  for (;;) {
    const sealed = await client.$transaction(
      async (tx) => {
        await lockChain(tx);
        return sealRows(tx, batchSize);
      },
      { timeout: 60_000 },
    );
    total += sealed;
    if (sealed < batchSize) return total;
  }
}

export type ChainBreakReason = "sequence_gap" | "unsealed" | "prev_hash_mismatch" | "hash_mismatch" | "anchor_mismatch" | "truncated";

export interface ChainBreak {
  seq: bigint;
  auditId: string | null;
  reason: ChainBreakReason;
  detail: string;
}

export interface ChainVerification {
  status: "VERIFIED" | "BROKEN" | "EMPTY";
  checkedRows: number;
  headSeq: bigint | null;
  headHash: string | null;
  verifiedThroughSeq: bigint | null;
  anchorsChecked: number;
  broken: ChainBreak | null;
}

export const CHAIN_BREAK_LABELS: Record<ChainBreakReason, string> = {
  sequence_gap: "Missing entry (sequence gap)",
  unsealed: "Entry without a hash",
  prev_hash_mismatch: "Link to the previous entry does not match",
  hash_mismatch: "Entry content does not match its hash",
  anchor_mismatch: "Entry differs from its published daily anchor",
  truncated: "Entries removed after a published daily anchor",
};

/** Walks the whole chain in seq order and reports the first broken link, if any. Read-only. */
export async function verifyAuditChain(client: AuditClient, options: { batchSize?: number } = {}): Promise<ChainVerification> {
  const batchSize = options.batchSize ?? 1_000;
  let expectedSeq = 1n;
  let prevHash: string | null = null;
  let checkedRows = 0;
  let verifiedThroughSeq: bigint | null = null;

  const result = (broken: ChainBreak | null, anchorsChecked = 0): ChainVerification => ({
    status: broken ? "BROKEN" : checkedRows === 0 ? "EMPTY" : "VERIFIED",
    checkedRows,
    headSeq: verifiedThroughSeq,
    headHash: prevHash,
    verifiedThroughSeq,
    anchorsChecked,
    broken,
  });

  for (;;) {
    const rows = await client.auditLog.findMany({ where: { seq: { gte: expectedSeq } }, orderBy: { seq: "asc" }, take: batchSize });
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.seq !== expectedSeq) {
        const missing = row.seq - expectedSeq === 1n ? `entry ${expectedSeq} is missing` : `entries ${expectedSeq}–${row.seq - 1n} are missing`;
        return withHead(client, result({ seq: expectedSeq, auditId: row.id, reason: "sequence_gap", detail: missing }));
      }
      if (row.hash === null) return withHead(client, result({ seq: row.seq, auditId: row.id, reason: "unsealed", detail: `entry ${row.seq} has no hash` }));
      if (row.prevHash !== prevHash) {
        return withHead(client, result({ seq: row.seq, auditId: row.id, reason: "prev_hash_mismatch", detail: `entry ${row.seq} does not link to entry ${row.seq - 1n}` }));
      }
      if (computeAuditHash(row) !== row.hash) {
        return withHead(client, result({ seq: row.seq, auditId: row.id, reason: "hash_mismatch", detail: `entry ${row.seq} was modified after it was recorded` }));
      }
      prevHash = row.hash;
      verifiedThroughSeq = row.seq;
      checkedRows += 1;
      expectedSeq += 1n;
    }
    if (rows.length < batchSize) break;
  }

  const anchors = await client.auditAnchor.findMany({ orderBy: { seq: "asc" } });
  if (anchors.length === 0) return result(null);
  const head = verifiedThroughSeq ?? 0n;
  const anchored = await client.auditLog.findMany({ where: { seq: { in: anchors.map((a) => a.seq).filter((s) => s <= head) } }, select: { id: true, seq: true, hash: true } });
  const bySeq = new Map(anchored.map((r) => [r.seq, r]));
  let checked = 0;
  for (const anchor of anchors) {
    if (anchor.seq > head) {
      return result(
        { seq: head + 1n, auditId: null, reason: "truncated", detail: `the anchor of ${anchor.day} covers entry ${anchor.seq}, but the chain ends at entry ${head}` },
        checked,
      );
    }
    const row = bySeq.get(anchor.seq);
    if (!row || row.hash !== anchor.hash) {
      return result({ seq: anchor.seq, auditId: row?.id ?? null, reason: "anchor_mismatch", detail: `entry ${anchor.seq} differs from the anchor of ${anchor.day}` }, checked);
    }
    checked += 1;
  }
  return result(null, checked);
}

/** Verifies the chain and stores the outcome as an AuditChainCheck row (shown in the admin console). */
export async function runAuditChainCheck(client: AuditClient, triggeredBy: { id: string | null; name: string }) {
  const started = performance.now();
  const verification = await verifyAuditChain(client);
  const check = await client.auditChainCheck.create({
    data: {
      status: verification.status,
      checkedRows: verification.checkedRows,
      headSeq: verification.headSeq,
      verifiedThroughSeq: verification.verifiedThroughSeq,
      brokenSeq: verification.broken?.seq ?? null,
      brokenAuditId: verification.broken?.auditId ?? null,
      brokenReason: verification.broken?.reason ?? null,
      anchorsChecked: verification.anchorsChecked,
      durationMs: Math.round(performance.now() - started),
      triggeredById: triggeredBy.id,
      triggeredByName: triggeredBy.name,
    },
  });
  return { verification, check };
}

async function withHead(client: AuditClient, verification: ChainVerification): Promise<ChainVerification> {
  const head = await client.auditLog.findFirst({ orderBy: { seq: "desc" }, select: { seq: true, hash: true } });
  return { ...verification, headSeq: head?.seq ?? null, headHash: head?.hash ?? null };
}

export interface AuditAnchorResult {
  day: string;
  seq: bigint;
  hash: string;
  created: boolean;
}

/**
 * Records the current chain head as the anchor for the given UTC day (once per day; existing anchors are
 * never changed). Refuses to anchor a chain that fails verification. Intended for a daily scheduled job.
 */
export async function anchorAuditHead(client: AuditClient, now: Date = new Date()): Promise<AuditAnchorResult | null> {
  const verification = await verifyAuditChain(client);
  if (verification.status === "BROKEN") throw new Error(`Audit chain is broken at entry ${verification.broken?.seq}; refusing to anchor`);
  if (verification.verifiedThroughSeq === null || verification.headHash === null) return null;
  const day = now.toISOString().slice(0, 10);
  const existing = await client.auditAnchor.findUnique({ where: { day } });
  if (existing) return { day, seq: existing.seq, hash: existing.hash, created: false };
  try {
    const anchor = await client.auditAnchor.create({ data: { day, seq: verification.verifiedThroughSeq, hash: verification.headHash, anchoredAt: now } });
    return { day, seq: anchor.seq, hash: anchor.hash, created: true };
  } catch (error) {
    const raced = await client.auditAnchor.findUnique({ where: { day } });
    if (raced) return { day, seq: raced.seq, hash: raced.hash, created: false };
    throw error;
  }
}
