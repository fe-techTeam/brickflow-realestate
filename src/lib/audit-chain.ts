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
 * Trust anchors, all HMAC-signed so database access alone cannot change them:
 * - AuditChainState: the legacy cutoff fixed by the migration and when it was sealed, signed by the
 *   current key. Unsigned means the chain is not initialised and every append is refused.
 * - AuditKeyEpoch: the seq range each key sealed. Closed ranges are signed by the successor key, the
 *   open range by its own (current) key, so key ids only move forward and a retired key cannot
 *   validate rows after its range.
 * - AuditAnchor: daily signed statements of the head, also exported for write-once storage.
 *
 * Appends take a transaction-scoped PostgreSQL advisory lock (one global chain under concurrency) and
 * fail closed: they are refused unless the state, the key ranges and the head all verify. Nothing is
 * ever sealed implicitly; legacy rows are sealed only by the explicit operator command.
 *
 * This module has no server-only imports so the seed and the CLI scripts can use it directly.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuditKeyEpoch, AuditLog, Prisma } from "../generated/prisma/client";
import { auditKeyring, type AuditKeyring } from "./audit-keys";

export const AUDIT_HASH_VERSION = 1;
export const ANCHOR_STATEMENT_TYPE = "brickflow.audit.anchor";
const STATE_STATEMENT_TYPE = "brickflow.audit.state";
const EPOCH_STATEMENT_TYPE = "brickflow.audit.key_epoch";
/** Fixed log event name for published anchors, so log pipelines can route them to archival storage. */
export const ANCHOR_LOG_EVENT = "audit.anchor.published";
export const SEAL_COMMAND = "npm run audit:seal-legacy";

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

function signWith(keyring: AuditKeyring, keyId: string, input: string): string {
  const key = keyring.keys.get(keyId);
  if (!key) throw new AuditChainIntegrityError("key_unknown", `Audit key "${keyId}" is not configured`);
  return hmacHex(key, input);
}

function validSignature(keyring: AuditKeyring, keyId: string, input: string, signature: string): boolean {
  const key = keyring.keys.get(keyId);
  return Boolean(key) && sameHex(hmacHex(key!, input), signature);
}

/** HMAC of a row under the given key (defaults to the current key). */
export function computeAuditHash(row: AuditHashFields, keyId?: string, keyring: AuditKeyring = auditKeyring()): string {
  const id = keyId ?? keyring.currentKeyId;
  return signWith(keyring, id, auditHashInput(row, id));
}

export type AuditChainErrorCode =
  | "chain_unsealed"
  | "state_invalid"
  | "epoch_invalid"
  | "head_invalid"
  | "key_unknown"
  | "seal_refused"
  | "rotation_refused"
  | "anchor_refused";

/** Raised when the chain cannot be safely extended or changed; the caller's transaction must roll back. */
export class AuditChainIntegrityError extends Error {
  constructor(
    readonly code: AuditChainErrorCode,
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

/* ----------------------------------------------------------------------------------------------
 * Signed chain state and key epochs
 * -------------------------------------------------------------------------------------------- */

type StateRow = { legacyCutoffSeq: bigint; legacySealedAt: Date | null; keyId: string | null; signature: string | null };

function stateStatement(cutoff: bigint, sealedAt: Date, keyId: string): string {
  return canonicalJson({ type: STATE_STATEMENT_TYPE, v: 1, legacyCutoffSeq: cutoff, legacySealedAt: sealedAt, keyId });
}

type EpochRow = Pick<AuditKeyEpoch, "keyId" | "fromSeq" | "toSeq" | "signedByKeyId" | "signature">;

function epochStatement(epoch: Pick<EpochRow, "keyId" | "fromSeq" | "toSeq" | "signedByKeyId">): string {
  return canonicalJson({ type: EPOCH_STATEMENT_TYPE, v: 1, keyId: epoch.keyId, fromSeq: epoch.fromSeq, toSeq: epoch.toSeq, signedByKeyId: epoch.signedByKeyId });
}

function signEpoch(keyring: AuditKeyring, epoch: Pick<EpochRow, "keyId" | "fromSeq" | "toSeq" | "signedByKeyId">): string {
  return signWith(keyring, epoch.signedByKeyId, epochStatement(epoch));
}

type Check = { ok: true } | { ok: false; code: AuditChainErrorCode; detail: string };

/** The state row must be signed by `expectedKeyId` (normally the current key) and mark the chain sealed. */
function checkState(state: StateRow | null, keyring: AuditKeyring, expectedKeyId: string = keyring.currentKeyId): Check {
  if (!state) return { ok: false, code: "state_invalid", detail: "the audit chain state row is missing" };
  if (state.signature === null && state.keyId === null && state.legacySealedAt === null) {
    return { ok: false, code: "chain_unsealed", detail: `the audit chain has not been initialised; run \`${SEAL_COMMAND}\` once` };
  }
  if (state.signature === null || state.keyId === null || state.legacySealedAt === null) {
    return { ok: false, code: "state_invalid", detail: "the audit chain state is incomplete (signature, key or seal date missing)" };
  }
  if (!validSignature(keyring, state.keyId, stateStatement(state.legacyCutoffSeq, state.legacySealedAt, state.keyId), state.signature)) {
    return { ok: false, code: "state_invalid", detail: "the audit chain state signature does not verify" };
  }
  if (state.keyId !== expectedKeyId) return { ok: false, code: "state_invalid", detail: `the audit chain state is signed with "${state.keyId}", not the current key "${expectedKeyId}"` };
  return { ok: true };
}

/**
 * Key ranges must start at 1, be contiguous, have exactly one open (last) range, never reuse a key id,
 * and carry valid signatures: a closed range by its successor's key, the open range by its own key.
 */
function checkEpochs(epochs: EpochRow[], keyring: AuditKeyring, expectedOpenKeyId: string = keyring.currentKeyId): Check {
  if (epochs.length === 0) return { ok: false, code: "epoch_invalid", detail: "no audit key range is recorded" };
  const sorted = [...epochs].sort((a, b) => (a.fromSeq < b.fromSeq ? -1 : 1));
  let expectedFrom = 1n;
  for (const [i, epoch] of sorted.entries()) {
    const last = i === sorted.length - 1;
    if (epoch.fromSeq !== expectedFrom) return { ok: false, code: "epoch_invalid", detail: `the range of key "${epoch.keyId}" starts at ${epoch.fromSeq}, expected ${expectedFrom}` };
    if (last !== (epoch.toSeq === null)) return { ok: false, code: "epoch_invalid", detail: `only the newest key range may be open (key "${epoch.keyId}")` };
    if (epoch.toSeq !== null && epoch.toSeq < epoch.fromSeq - 1n) return { ok: false, code: "epoch_invalid", detail: `the range of key "${epoch.keyId}" ends before it starts` };
    const signer = last ? epoch.keyId : sorted[i + 1]!.keyId;
    if (epoch.signedByKeyId !== signer) return { ok: false, code: "epoch_invalid", detail: `the range of key "${epoch.keyId}" must be signed by "${signer}"` };
    if (!keyring.keys.has(epoch.keyId)) return { ok: false, code: "epoch_invalid", detail: `audit key "${epoch.keyId}" is not configured (keep retired keys in AUDIT_HMAC_PREVIOUS_KEYS)` };
    if (!validSignature(keyring, signer, epochStatement(epoch), epoch.signature)) return { ok: false, code: "epoch_invalid", detail: `the range of key "${epoch.keyId}" has an invalid signature` };
    if (epoch.toSeq !== null) expectedFrom = epoch.toSeq + 1n;
  }
  const open = sorted.at(-1)!;
  if (open.keyId !== expectedOpenKeyId) return { ok: false, code: "epoch_invalid", detail: `the open key range belongs to "${open.keyId}", not the current key "${expectedOpenKeyId}"` };
  return { ok: true };
}

function epochFor(epochs: EpochRow[], seq: bigint): EpochRow | undefined {
  return epochs.find((e) => e.fromSeq <= seq && (e.toSeq === null || seq <= e.toSeq));
}

async function loadTrust(client: AuditClient) {
  const [state, epochs] = await Promise.all([client.auditChainState.findUnique({ where: { id: 1 } }), client.auditKeyEpoch.findMany({ orderBy: { fromSeq: "asc" } })]);
  return { state, epochs };
}

type RowCheck = { ok: true } | { ok: false; reason: "unsealed" | "key_out_of_range" | "hash_mismatch" };

function checkRow(row: AuditHashFields & { hash: string | null; hashKeyId: string | null }, epochs: EpochRow[], keyring: AuditKeyring): RowCheck {
  if (row.hash === null || row.hashKeyId === null) return { ok: false, reason: "unsealed" };
  if (epochFor(epochs, row.seq)?.keyId !== row.hashKeyId) return { ok: false, reason: "key_out_of_range" };
  return validSignature(keyring, row.hashKeyId, auditHashInput(row, row.hashKeyId), row.hash) ? { ok: true } : { ok: false, reason: "hash_mismatch" };
}

/** Everything an append relies on: signed state, valid key ranges and a verifiable head. */
async function assertWritable(client: AuditClient, keyring: AuditKeyring): Promise<AuditLog | null> {
  const { state, epochs } = await loadTrust(client);
  for (const check of [checkState(state, keyring), checkEpochs(epochs, keyring)]) {
    if (!check.ok) throw new AuditChainIntegrityError(check.code, `Refusing to write audit entries: ${check.detail}`);
  }
  const head = await client.auditLog.findFirst({ orderBy: { seq: "desc" } });
  if (!head) return null;
  const check = checkRow(head, epochs, keyring);
  if (!check.ok) {
    const why = check.reason === "unsealed" ? "has no hash" : check.reason === "key_out_of_range" ? `is sealed with key "${head.hashKeyId}", which does not own that position` : "does not match its hash";
    throw new AuditChainIntegrityError("head_invalid", `Refusing to write audit entries: the newest entry (${head.seq}) ${why}`, head.seq);
  }
  const open = epochs.at(-1)!;
  if (head.seq < open.fromSeq - 1n) throw new AuditChainIntegrityError("head_invalid", `Refusing to write audit entries: entries ${head.seq + 1n}–${open.fromSeq - 1n} are missing`, head.seq);
  return head;
}

export type AuditChainHealth = "ok" | "unsealed" | "broken";

/** Cheap readiness check: could an audit entry be written right now? Never throws for integrity problems. */
export async function auditChainHealth(client: AuditClient, keyring: AuditKeyring = auditKeyring()): Promise<{ status: AuditChainHealth; detail?: string }> {
  try {
    await assertWritable(client, keyring);
    return { status: "ok" };
  } catch (error) {
    if (error instanceof AuditChainIntegrityError) return { status: error.code === "chain_unsealed" ? "unsealed" : "broken", detail: error.message };
    throw error;
  }
}

/* ----------------------------------------------------------------------------------------------
 * Appending
 * -------------------------------------------------------------------------------------------- */

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
 * Appends one row, sealed with the current key. Must be called with an interactive-transaction client:
 * the advisory lock is held until that transaction ends, so the next writer sees this row as the head.
 * Refuses (AuditChainIntegrityError) unless the signed state, the key ranges and the head all verify.
 */
export async function appendAuditEntry(client: AuditClient, entry: AuditEntryData, keyring: AuditKeyring = auditKeyring()): Promise<AuditLog> {
  await lockChain(client);
  const head = await assertWritable(client, keyring);
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

/* ----------------------------------------------------------------------------------------------
 * One-time legacy sealing (operator command) and key rotation
 * -------------------------------------------------------------------------------------------- */

export interface LegacySealPlan {
  cutoffSeq: bigint;
  rows: number;
  maxSeq: bigint;
  oldest: Date | null;
  newest: Date | null;
  sealed: boolean;
}

/** Read-only summary for the operator before sealing (`--dry-run`). */
export async function describeLegacySeal(client: AuditClient): Promise<LegacySealPlan> {
  const [state, agg] = await Promise.all([
    client.auditChainState.findUnique({ where: { id: 1 } }),
    client.auditLog.aggregate({ _count: { _all: true }, _max: { seq: true, createdAt: true }, _min: { createdAt: true } }),
  ]);
  return {
    cutoffSeq: state?.legacyCutoffSeq ?? 0n,
    rows: agg._count._all,
    maxSeq: agg._max.seq ?? 0n,
    oldest: agg._min.createdAt ?? null,
    newest: agg._max.createdAt ?? null,
    sealed: Boolean(state?.signature),
  };
}

export interface LegacySealResult {
  status: "sealed" | "already_sealed";
  cutoffSeq: bigint;
  sealed: number;
  anchor: SignedAnchor | null;
}

function refuseSeal(message: string): never {
  throw new AuditChainIntegrityError("seal_refused", `Refusing to seal legacy audit entries: ${message}`);
}

/**
 * Operator command: seals the rows that predate the chain (seq 1..legacyCutoffSeq) with the current key,
 * records the first key range, signs the state row and anchors the legacy head. It runs once. Once the
 * state is signed, later runs only verify that signature. It refuses if the state was tampered with, if any
 * row already carries a key, if anchors or successful checks exist, or if the cutoff does not match
 * the rows that exist (a raised cutoff).
 */
export async function sealLegacyAuditRows(tx: AuditClient, keyring: AuditKeyring = auditKeyring(), now: Date = new Date()): Promise<LegacySealResult> {
  await lockChain(tx);
  const state = await tx.auditChainState.findUnique({ where: { id: 1 } });
  if (!state) refuseSeal("the chain state row is missing; apply the database migrations first");

  if (state.signature !== null || state.keyId !== null || state.legacySealedAt !== null) {
    const check = checkState(state, keyring, state.keyId ?? keyring.currentKeyId);
    if (!check.ok) refuseSeal(check.detail);
    return { status: "already_sealed", cutoffSeq: state.legacyCutoffSeq, sealed: 0, anchor: null };
  }

  const [keyed, epochs, anchors, checks, agg] = await Promise.all([
    tx.auditLog.count({ where: { OR: [{ hashKeyId: { not: null } }, { hash: { not: null } }] } }),
    tx.auditKeyEpoch.count(),
    tx.auditAnchor.count(),
    tx.auditChainCheck.count({ where: { NOT: { status: "BROKEN", brokenReason: { in: ["unsealed", "chain_unsealed"] } } } }),
    tx.auditLog.aggregate({ _count: { _all: true }, _max: { seq: true } }),
  ]);
  if (keyed > 0) refuseSeal(`${keyed} entries already carry a hash or key id`);
  if (epochs > 0) refuseSeal("audit key ranges already exist");
  if (anchors > 0) refuseSeal("daily anchors already exist");
  if (checks > 0) refuseSeal("verification history shows the chain was already in use");
  const cutoff = state.legacyCutoffSeq;
  const maxSeq = agg._max.seq ?? 0n;
  if (cutoff !== maxSeq || BigInt(agg._count._all) !== cutoff) {
    refuseSeal(`the recorded cutoff (${cutoff}) does not match the entries present (${agg._count._all} entries, highest ${maxSeq})`);
  }

  const keyId = keyring.currentKeyId;
  let prevHash: string | null = null;
  let cursor = 1n;
  for (;;) {
    const rows = await tx.auditLog.findMany({ where: { seq: { gte: cursor, lte: cutoff } }, orderBy: { seq: "asc" }, take: 500 });
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.seq !== cursor) refuseSeal(`entry ${cursor} is missing`);
      const hash = computeAuditHash({ ...row, prevHash }, keyId, keyring);
      await tx.auditLog.update({ where: { id: row.id }, data: { prevHash, hash, hashKeyId: keyId } });
      prevHash = hash;
      cursor += 1n;
    }
  }

  const epoch = { keyId, fromSeq: 1n, toSeq: null, signedByKeyId: keyId };
  await tx.auditKeyEpoch.create({ data: { ...epoch, signature: signEpoch(keyring, epoch), recordedAt: now } });
  await tx.auditChainState.update({ where: { id: 1 }, data: { legacySealedAt: now, keyId, signature: signWith(keyring, keyId, stateStatement(cutoff, now, keyId)) } });
  const anchored = cutoff > 0n ? await anchorAuditHead(tx, now, keyring) : null;
  return { status: "sealed", cutoffSeq: cutoff, sealed: Number(cutoff), anchor: anchored?.anchor ?? null };
}

/** Starts a fresh, empty chain (used by the demo seed after it wipes the audit log). */
export async function initialiseEmptyAuditChain(tx: AuditClient, keyring: AuditKeyring = auditKeyring(), now: Date = new Date()): Promise<LegacySealResult> {
  await lockChain(tx);
  if ((await tx.auditLog.count()) > 0) throw new AuditChainIntegrityError("seal_refused", "Refusing to initialise the audit chain: the audit log is not empty");
  await tx.auditKeyEpoch.deleteMany();
  await tx.auditAnchor.deleteMany();
  await tx.auditChainCheck.deleteMany();
  const blank = { legacyCutoffSeq: 0n, legacySealedAt: null, keyId: null, signature: null };
  await tx.auditChainState.upsert({ where: { id: 1 }, create: { id: 1, ...blank }, update: blank });
  return sealLegacyAuditRows(tx, keyring, now);
}

export interface KeyRotationResult {
  fromKeyId: string;
  toKeyId: string;
  retiredThroughSeq: bigint;
  rotationEntrySeq: bigint;
}

function refuseRotation(message: string): never {
  throw new AuditChainIntegrityError("rotation_refused", `Refusing to rotate the audit key: ${message}`);
}

/**
 * Operator command, run with the NEW key as AUDIT_HMAC_KEY / AUDIT_HMAC_KEY_ID and the old one in
 * AUDIT_HMAC_PREVIOUS_KEYS. Closes the old key's range at the current head (signed by the new key),
 * opens the new key's range, re-signs the state and records an `audit.key_rotated` entry with the new
 * key. Key ids can only move forward: a key id that sealed earlier entries can never be used again.
 */
export async function rotateAuditKey(tx: AuditClient, keyring: AuditKeyring = auditKeyring(), now: Date = new Date()): Promise<KeyRotationResult> {
  await lockChain(tx);
  const { state, epochs } = await loadTrust(tx);
  const open = epochs.at(-1);
  if (!state || !open) refuseRotation(`the audit chain has not been initialised; run \`${SEAL_COMMAND}\` first`);
  const newKeyId = keyring.currentKeyId;
  if (open.keyId === newKeyId) refuseRotation(`"${newKeyId}" is already the current key; set the new key as AUDIT_HMAC_KEY with a new AUDIT_HMAC_KEY_ID`);
  if (epochs.some((e) => e.keyId === newKeyId)) refuseRotation(`key id "${newKeyId}" was used before; key ids may only move forward`);
  if (!keyring.keys.has(open.keyId)) refuseRotation(`the retiring key "${open.keyId}" must be listed in AUDIT_HMAC_PREVIOUS_KEYS`);
  for (const check of [checkState(state, keyring, open.keyId), checkEpochs(epochs, keyring, open.keyId)]) if (!check.ok) refuseRotation(check.detail);
  const head = await tx.auditLog.findFirst({ orderBy: { seq: "desc" } });
  if (head) {
    const check = checkRow(head, epochs, keyring);
    if (!check.ok) refuseRotation(`the newest entry (${head.seq}) does not verify (${check.reason})`);
  }
  const retiredThroughSeq = head?.seq ?? 0n;
  if (retiredThroughSeq < open.fromSeq - 1n) refuseRotation("the chain is shorter than the open key range");

  const closed = { keyId: open.keyId, fromSeq: open.fromSeq, toSeq: retiredThroughSeq, signedByKeyId: newKeyId };
  await tx.auditKeyEpoch.update({ where: { keyId: open.keyId }, data: { toSeq: closed.toSeq, signedByKeyId: newKeyId, signature: signEpoch(keyring, closed) } });
  const opened = { keyId: newKeyId, fromSeq: retiredThroughSeq + 1n, toSeq: null, signedByKeyId: newKeyId };
  await tx.auditKeyEpoch.create({ data: { ...opened, signature: signEpoch(keyring, opened), recordedAt: now } });
  await tx.auditChainState.update({
    where: { id: 1 },
    data: { keyId: newKeyId, signature: signWith(keyring, newKeyId, stateStatement(state.legacyCutoffSeq, state.legacySealedAt!, newKeyId)) },
  });
  const entry = await appendAuditEntry(
    tx,
    {
      actorUserId: null,
      actorName: "System",
      actorOrgId: null,
      actorRole: null,
      action: "audit.key_rotated",
      entityType: "AuditLog",
      entityId: newKeyId,
      summary: `Rotated the audit key from "${open.keyId}" to "${newKeyId}" after entry ${retiredThroughSeq}`,
      metadata: JSON.stringify({ fromKeyId: open.keyId, toKeyId: newKeyId, retiredThroughSeq: retiredThroughSeq.toString() }),
      createdAt: now,
    },
    keyring,
  );
  return { fromKeyId: open.keyId, toKeyId: newKeyId, retiredThroughSeq, rotationEntrySeq: entry.seq };
}

/** Convenience wrappers for scripts holding a root client. */
export async function sealLegacyAuditRowsInTransaction(client: RootClient): Promise<LegacySealResult> {
  return client.$transaction((tx) => sealLegacyAuditRows(tx), { timeout: 10 * 60_000, maxWait: 30_000 });
}

export async function rotateAuditKeyInTransaction(client: RootClient): Promise<KeyRotationResult> {
  return client.$transaction((tx) => rotateAuditKey(tx), { timeout: 10 * 60_000, maxWait: 30_000 });
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

export function verifyAnchorSignature(anchor: SignedAnchor, keyring: AuditKeyring = auditKeyring()): boolean {
  if (anchor.statement?.type !== ANCHOR_STATEMENT_TYPE || typeof anchor.signature !== "string") return false;
  return validSignature(keyring, anchor.statement.keyId, canonicalJson({ ...anchor.statement }), anchor.signature);
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
  | "chain_unsealed"
  | "state_invalid"
  | "key_epoch_invalid"
  | "sequence_gap"
  | "unsealed"
  | "key_out_of_range"
  | "prev_hash_mismatch"
  | "hash_mismatch"
  | "anchor_signature_invalid"
  | "anchor_key_out_of_range"
  | "anchor_mismatch"
  | "truncated";

export interface ChainBreak {
  /** Position of the broken link; 0 when the chain state or key ranges themselves fail. */
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
  chain_unsealed: "Audit chain not initialised",
  state_invalid: "Audit chain state does not verify",
  key_epoch_invalid: "Audit key ranges do not verify",
  sequence_gap: "Missing entry (sequence gap)",
  unsealed: "Entry without a hash",
  key_out_of_range: "Entry sealed with a key outside its range",
  prev_hash_mismatch: "Link to the previous entry does not match",
  hash_mismatch: "Entry content does not match its hash",
  anchor_signature_invalid: "Daily anchor signature is invalid",
  anchor_key_out_of_range: "Daily anchor signed with a retired key",
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

  const { state, epochs } = await loadTrust(client);
  const stateCheck = checkState(state, keyring);
  if (!stateCheck.ok) {
    return withHead(client, result({ seq: 0n, auditId: null, reason: stateCheck.code === "chain_unsealed" ? "chain_unsealed" : "state_invalid", detail: stateCheck.detail }));
  }
  const epochCheck = checkEpochs(epochs, keyring);
  if (!epochCheck.ok) return withHead(client, result({ seq: 0n, auditId: null, reason: "key_epoch_invalid", detail: epochCheck.detail }));

  for (;;) {
    const rows = await client.auditLog.findMany({ where: { seq: { gte: expectedSeq } }, orderBy: { seq: "asc" }, take: batchSize });
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.seq !== expectedSeq) {
        const missing = row.seq - expectedSeq === 1n ? `entry ${expectedSeq} is missing` : `entries ${expectedSeq}–${row.seq - 1n} are missing`;
        return withHead(client, result({ seq: expectedSeq, auditId: row.id, reason: "sequence_gap", detail: missing }));
      }
      const check = checkRow(row, epochs, keyring);
      if (!check.ok && check.reason === "unsealed") return withHead(client, result({ seq: row.seq, auditId: row.id, reason: "unsealed", detail: `entry ${row.seq} has no hash` }));
      if (!check.ok && check.reason === "key_out_of_range") {
        const owner = epochFor(epochs, row.seq)?.keyId;
        return withHead(client, result({ seq: row.seq, auditId: row.id, reason: "key_out_of_range", detail: `entry ${row.seq} is sealed with key "${row.hashKeyId}", but that position belongs to "${owner}"` }));
      }
      if (row.prevHash !== prevHash) {
        return withHead(client, result({ seq: row.seq, auditId: row.id, reason: "prev_hash_mismatch", detail: `entry ${row.seq} does not link to entry ${row.seq - 1n}` }));
      }
      if (!check.ok) return withHead(client, result({ seq: row.seq, auditId: row.id, reason: "hash_mismatch", detail: `entry ${row.seq} was modified after it was recorded` }));
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
    const signer = epochs.find((e) => e.keyId === anchor.statement.keyId);
    if (!signer || seq < signer.fromSeq - 1n || (signer.toSeq !== null && seq > signer.toSeq)) {
      return result({ seq, auditId: null, reason: "anchor_key_out_of_range", detail: `the anchor of ${anchor.statement.day} is signed with key "${anchor.statement.keyId}", which did not seal entry ${seq}` }, checked);
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
 * Records a statement of the current chain head for the given UTC day, signed with the current key
 * (once per day; existing anchors are never changed). Refuses to anchor a chain that fails
 * verification. Callers publish the result (log line `audit.anchor.published`, `audit:export-anchors`).
 */
export async function anchorAuditHead(client: AuditClient, now: Date = new Date(), keyring: AuditKeyring = auditKeyring()): Promise<AuditAnchorResult | null> {
  const verification = await verifyAuditChain(client, { keyring });
  if (verification.status === "BROKEN") throw new AuditChainIntegrityError("anchor_refused", `Audit chain is broken at entry ${verification.broken?.seq}; refusing to anchor`, verification.broken?.seq ?? null);
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
  const signature = signWith(keyring, statement.keyId, canonicalJson({ ...statement }));
  try {
    await client.auditAnchor.create({ data: { day, seq: verification.verifiedThroughSeq, hash: verification.headHash, keyId: statement.keyId, signature, anchoredAt: now } });
    return { anchor: { statement, signature }, created: true };
  } catch (error) {
    const raced = await client.auditAnchor.findUnique({ where: { day } });
    if (raced) return { anchor: anchorFromRow(raced), created: false };
    throw error;
  }
}
