/**
 * Tamper-evident audit chain.
 *
 * Every AuditLog row has a gapless position `seq` (1, 2, 3, …) in one global chain and
 *   hash = HMAC-SHA256( key[hashKeyId], canonicalJson({ v, seq, createdAt, actorUserId, actorName,
 *          actorOrgId, actorRole, action, entityType, entityId, summary, metadata, prevHash, keyId }) )
 * where `prevHash` is the `hash` of row `seq - 1` (null for the first row). Because the hash is keyed
 * (AUDIT_HMAC_KEY, see audit-keys.ts), someone with write access to the database but not the key
 * cannot recompute a consistent chain after editing it.
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
 * into a single chain, and refuse to extend a head that is unsealed or fails its HMAC (fail closed).
 * Rows that predate the chain (seq <= AuditChainState.legacyCutoffSeq) are sealed exactly once by
 * `sealLegacyAuditRows`; a missing hash anywhere else is reported as a broken link and never re-sealed.
 * Daily anchors are HMAC-signed statements of the head; they are also exported for write-once storage
 * so that removal of the newest rows can be detected even if the database copy is altered.
 *
 * This module has no server-only imports so the seed and the CLI scripts can use it directly.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuditLog, Prisma } from "../generated/prisma/client";
import { auditKeyring, type AuditKeyring } from "./audit-keys";

export const AUDIT_HASH_VERSION = 1;
export const ANCHOR_STATEMENT_TYPE = "brickflow.audit.anchor";
/** Fixed log event name for published anchors, so log pipelines can route them to archival storage. */
export const ANCHOR_LOG_EVENT = "audit.anchor.published";

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

export function auditHashInput(row: AuditHashFields, keyId: string): string {
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
    keyId,
  });
}

function hmacHex(key: Buffer, input: string): string {
  return createHmac("sha256", key).update(input, "utf8").digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** HMAC of a row under the given key (defaults to the current key). */
export function computeAuditHash(row: AuditHashFields, keyId?: string, keyring: AuditKeyring = auditKeyring()): string {
  const id = keyId ?? keyring.currentKeyId;
  const key = keyring.keys.get(id);
  if (!key) throw new AuditChainIntegrityError(`Unknown audit key id "${id}"`);
  return hmacHex(key, auditHashInput(row, id));
}

type RowCheck = { ok: true } | { ok: false; reason: "unsealed" | "unknown_key" | "hash_mismatch" };

function checkRowHash(row: AuditHashFields & { hash: string | null; hashKeyId: string | null }, keyring: AuditKeyring): RowCheck {
  if (row.hash === null || row.hashKeyId === null) return { ok: false, reason: "unsealed" };
  const key = keyring.keys.get(row.hashKeyId);
  if (!key) return { ok: false, reason: "unknown_key" };
  return sameHex(hmacHex(key, auditHashInput(row, row.hashKeyId)), row.hash) ? { ok: true } : { ok: false, reason: "hash_mismatch" };
}

/** Raised when the chain cannot be safely extended; the caller's transaction must roll back. */
export class AuditChainIntegrityError extends Error {
  constructor(
    message: string,
    readonly seq: bigint | null = null,
  ) {
    super(message);
    this.name = "AuditChainIntegrityError";
  }
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
 * as the head. Refuses (AuditChainIntegrityError) when the head is unsealed or fails its HMAC, so a
 * damaged chain is never extended or silently repaired.
 */
export async function appendAuditEntry(client: AuditClient, entry: AuditEntryData, keyring: AuditKeyring = auditKeyring()): Promise<AuditLog> {
  await lockChain(client);
  const head = await client.auditLog.findFirst({ orderBy: { seq: "desc" } });
  if (head) {
    const check = checkRowHash(head, keyring);
    if (!check.ok) {
      const why = check.reason === "unsealed" ? "has no hash" : check.reason === "unknown_key" ? `was sealed with an unknown key (${head.hashKeyId})` : "does not match its hash";
      throw new AuditChainIntegrityError(`Audit chain head (entry ${head.seq}) ${why}; refusing to append`, head.seq);
    }
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
  const keyId = keyring.currentKeyId;
  return client.auditLog.create({ data: { ...fields, hash: computeAuditHash(fields, keyId, keyring), hashKeyId: keyId } });
}

export interface LegacySealResult {
  status: "sealed" | "already_sealed" | "nothing_to_seal";
  cutoffSeq: bigint;
  sealed: number;
}

/**
 * Seals the rows that existed before the chain (seq <= legacyCutoffSeq), in seq order, exactly once:
 * the state row is claimed with a conditional update in the same transaction, so a second run (or a
 * concurrent one) does nothing. Rows above the cutoff are never touched.
 */
export async function sealLegacyAuditRows(tx: AuditClient, keyring: AuditKeyring = auditKeyring()): Promise<LegacySealResult> {
  await lockChain(tx);
  const state = await tx.auditChainState.findUnique({ where: { id: 1 } });
  if (!state) throw new AuditChainIntegrityError("AuditChainState is missing; apply the database migrations first");
  if (state.legacySealedAt) return { status: "already_sealed", cutoffSeq: state.legacyCutoffSeq, sealed: 0 };
  const claimed = await tx.auditChainState.updateMany({ where: { id: 1, legacySealedAt: null }, data: { legacySealedAt: new Date() } });
  if (claimed.count !== 1) return { status: "already_sealed", cutoffSeq: state.legacyCutoffSeq, sealed: 0 };
  if (state.legacyCutoffSeq === 0n) return { status: "nothing_to_seal", cutoffSeq: 0n, sealed: 0 };

  let prevHash: string | null = null;
  let cursor = 1n;
  let sealed = 0;
  const keyId = keyring.currentKeyId;
  for (;;) {
    const rows = await tx.auditLog.findMany({ where: { seq: { gte: cursor, lte: state.legacyCutoffSeq } }, orderBy: { seq: "asc" }, take: 500 });
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.seq !== cursor) throw new AuditChainIntegrityError(`Legacy audit entry ${cursor} is missing; refusing to seal`, cursor);
      if (row.hash !== null) throw new AuditChainIntegrityError(`Legacy audit entry ${row.seq} already has a hash; refusing to seal`, row.seq);
      const hash = computeAuditHash({ ...row, prevHash }, keyId, keyring);
      await tx.auditLog.update({ where: { id: row.id }, data: { prevHash, hash, hashKeyId: keyId } });
      prevHash = hash;
      cursor += 1n;
      sealed += 1;
    }
  }
  if (cursor !== state.legacyCutoffSeq + 1n) throw new AuditChainIntegrityError(`Legacy audit entries end at ${cursor - 1n}, expected ${state.legacyCutoffSeq}`, cursor);
  // The first post-cutoff row (if any) must have been written after sealing, i.e. it links to the legacy head.
  const next = await tx.auditLog.findUnique({ where: { seq: state.legacyCutoffSeq + 1n } });
  if (next && next.prevHash !== prevHash) throw new AuditChainIntegrityError(`Audit entry ${next.seq} does not link to the sealed legacy entries`, next.seq);
  return { status: "sealed", cutoffSeq: state.legacyCutoffSeq, sealed };
}

/* ----------------------------------------------------------------------------------------------
 * Signed anchors
 * -------------------------------------------------------------------------------------------- */

export interface AnchorStatement {
  type: typeof ANCHOR_STATEMENT_TYPE;
  v: 1;
  day: string;
  seq: string;
  headHash: string;
  keyId: string;
  anchoredAt: string;
}

export interface SignedAnchor {
  statement: AnchorStatement;
  signature: string;
}

function signStatement(statement: AnchorStatement, keyring: AuditKeyring): string {
  const key = keyring.keys.get(statement.keyId);
  if (!key) throw new AuditChainIntegrityError(`Unknown audit key id "${statement.keyId}"`);
  return hmacHex(key, canonicalJson({ ...statement }));
}

export function verifyAnchorSignature(anchor: SignedAnchor, keyring: AuditKeyring = auditKeyring()): boolean {
  const key = keyring.keys.get(anchor.statement.keyId);
  if (!key || anchor.statement.type !== ANCHOR_STATEMENT_TYPE || typeof anchor.signature !== "string") return false;
  return sameHex(hmacHex(key, canonicalJson({ ...anchor.statement })), anchor.signature);
}

export function anchorFromRow(row: { day: string; seq: bigint; hash: string; keyId: string; signature: string; anchoredAt: Date }): SignedAnchor {
  return {
    statement: { type: ANCHOR_STATEMENT_TYPE, v: 1, day: row.day, seq: row.seq.toString(), headHash: row.hash, keyId: row.keyId, anchoredAt: row.anchoredAt.toISOString() },
    signature: row.signature,
  };
}

/** Parses an exported anchor file (one signed anchor JSON object per line). Throws on malformed lines. */
export function parseAnchorFile(text: string): SignedAnchor[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`Anchor file line ${index + 1} is not valid JSON`);
      }
      const candidate = parsed as Partial<SignedAnchor>;
      const s = candidate.statement as Partial<AnchorStatement> | undefined;
      if (!s || typeof candidate.signature !== "string" || typeof s.day !== "string" || typeof s.seq !== "string" || !/^\d+$/.test(s.seq) || typeof s.headHash !== "string" || typeof s.keyId !== "string") {
        throw new Error(`Anchor file line ${index + 1} is not a signed anchor`);
      }
      return candidate as SignedAnchor;
    });
}

export function serialiseAnchorFile(anchors: SignedAnchor[]): string {
  return anchors.map((a) => JSON.stringify(a)).join("\n") + (anchors.length ? "\n" : "");
}

export async function listSignedAnchors(client: AuditClient): Promise<SignedAnchor[]> {
  return (await client.auditAnchor.findMany({ orderBy: { seq: "asc" } })).map(anchorFromRow);
}

/* ----------------------------------------------------------------------------------------------
 * Verification
 * -------------------------------------------------------------------------------------------- */

export type ChainBreakReason =
  | "sequence_gap"
  | "unsealed"
  | "unknown_key"
  | "prev_hash_mismatch"
  | "hash_mismatch"
  | "anchor_signature_invalid"
  | "anchor_mismatch"
  | "truncated";

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
  unknown_key: "Entry sealed with an unknown key",
  prev_hash_mismatch: "Link to the previous entry does not match",
  hash_mismatch: "Entry content does not match its hash",
  anchor_signature_invalid: "Daily anchor signature is invalid",
  anchor_mismatch: "Entry differs from its signed daily anchor",
  truncated: "Entries removed after a signed daily anchor",
};

export interface VerifyOptions {
  batchSize?: number;
  /** Signed anchors from an external copy (e.g. write-once storage), checked in addition to the table. */
  externalAnchors?: SignedAnchor[];
  keyring?: AuditKeyring;
}

/** Walks the whole chain in seq order and reports the first broken link, if any. Read-only. */
export async function verifyAuditChain(client: AuditClient, options: VerifyOptions = {}): Promise<ChainVerification> {
  const batchSize = options.batchSize ?? 1_000;
  const keyring = options.keyring ?? auditKeyring();
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
      const check = checkRowHash(row, keyring);
      if (!check.ok && check.reason !== "hash_mismatch") {
        const detail = check.reason === "unsealed" ? `entry ${row.seq} has no hash` : `entry ${row.seq} was sealed with unknown key "${row.hashKeyId}"`;
        return withHead(client, result({ seq: row.seq, auditId: row.id, reason: check.reason, detail }));
      }
      if (row.prevHash !== prevHash) {
        return withHead(client, result({ seq: row.seq, auditId: row.id, reason: "prev_hash_mismatch", detail: `entry ${row.seq} does not link to entry ${row.seq - 1n}` }));
      }
      if (!check.ok) {
        return withHead(client, result({ seq: row.seq, auditId: row.id, reason: "hash_mismatch", detail: `entry ${row.seq} was modified after it was recorded` }));
      }
      prevHash = row.hash;
      verifiedThroughSeq = row.seq;
      checkedRows += 1;
      expectedSeq += 1n;
    }
    if (rows.length < batchSize) break;
  }

  const anchors = [...(await listSignedAnchors(client)), ...(options.externalAnchors ?? [])].sort((a, b) => (BigInt(a.statement.seq) < BigInt(b.statement.seq) ? -1 : 1));
  if (anchors.length === 0) return result(null);
  const head = verifiedThroughSeq ?? 0n;
  const anchoredSeqs = [...new Set(anchors.map((a) => BigInt(a.statement.seq)).filter((s) => s <= head))];
  const anchored = await client.auditLog.findMany({ where: { seq: { in: anchoredSeqs } }, select: { id: true, seq: true, hash: true } });
  const bySeq = new Map(anchored.map((r) => [r.seq, r]));
  let checked = 0;
  for (const anchor of anchors) {
    const seq = BigInt(anchor.statement.seq);
    if (!verifyAnchorSignature(anchor, keyring)) {
      return result({ seq, auditId: null, reason: "anchor_signature_invalid", detail: `the anchor of ${anchor.statement.day} is not signed by a known key` }, checked);
    }
    if (seq > head) {
      return result({ seq: head + 1n, auditId: null, reason: "truncated", detail: `the anchor of ${anchor.statement.day} covers entry ${seq}, but the chain ends at entry ${head}` }, checked);
    }
    const row = bySeq.get(seq);
    if (!row || row.hash !== anchor.statement.headHash) {
      return result({ seq, auditId: row?.id ?? null, reason: "anchor_mismatch", detail: `entry ${seq} differs from the anchor of ${anchor.statement.day}` }, checked);
    }
    checked += 1;
  }
  return result(null, checked);
}

/** Verifies the chain and stores the outcome as an AuditChainCheck row (shown in the admin console). */
export async function runAuditChainCheck(client: AuditClient, triggeredBy: { id: string | null; name: string }, options: VerifyOptions = {}) {
  const started = performance.now();
  const verification = await verifyAuditChain(client, options);
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
  anchor: SignedAnchor;
  created: boolean;
}

/**
 * Records an HMAC-signed statement of the current chain head for the given UTC day (once per day;
 * existing anchors are never changed). Refuses to anchor a chain that fails verification. Callers
 * should publish the returned anchor (log line `audit.anchor.published`, `npm run audit:export-anchors`).
 */
export async function anchorAuditHead(client: AuditClient, now: Date = new Date(), keyring: AuditKeyring = auditKeyring()): Promise<AuditAnchorResult | null> {
  const verification = await verifyAuditChain(client, { keyring });
  if (verification.status === "BROKEN") throw new AuditChainIntegrityError(`Audit chain is broken at entry ${verification.broken?.seq}; refusing to anchor`, verification.broken?.seq ?? null);
  if (verification.verifiedThroughSeq === null || verification.headHash === null) return null;
  const day = now.toISOString().slice(0, 10);
  const existing = await client.auditAnchor.findUnique({ where: { day } });
  if (existing) return { anchor: anchorFromRow(existing), created: false };
  const statement: AnchorStatement = {
    type: ANCHOR_STATEMENT_TYPE,
    v: 1,
    day,
    seq: verification.verifiedThroughSeq.toString(),
    headHash: verification.headHash,
    keyId: keyring.currentKeyId,
    anchoredAt: now.toISOString(),
  };
  const signature = signStatement(statement, keyring);
  try {
    await client.auditAnchor.create({ data: { day, seq: verification.verifiedThroughSeq, hash: verification.headHash, keyId: statement.keyId, signature, anchoredAt: now } });
    return { anchor: { statement, signature }, created: true };
  } catch (error) {
    const raced = await client.auditAnchor.findUnique({ where: { day } });
    if (raced) return { anchor: anchorFromRow(raced), created: false };
    throw error;
  }
}

/** Convenience for scripts holding a root client. */
export async function sealLegacyAuditRowsInTransaction(client: RootClient): Promise<LegacySealResult> {
  return client.$transaction((tx) => sealLegacyAuditRows(tx), { timeout: 10 * 60_000, maxWait: 30_000 });
}
