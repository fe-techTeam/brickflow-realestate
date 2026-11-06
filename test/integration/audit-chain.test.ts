import { createHash, createHmac, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import {
  anchorAuditHead,
  appendAuditEntry,
  AuditChainIntegrityError,
  auditHashInput,
  canonicalJson,
  computeAuditHash,
  listSignedAnchors,
  parseAnchorFile,
  sealLegacyAuditRows,
  serialiseAnchorFile,
  verifyAnchorSignature,
  verifyAuditChain,
  type ChainVerification,
} from "@/lib/audit-chain";
import { auditKeyring } from "@/lib/audit-keys";
import { recordAudit } from "@/server/audit";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import { setLogSink, type LogRecord } from "@/server/observability/logger";
import { getAuditIntegrity, publishDailyAuditAnchor, verifyAuditChainNow } from "@/server/services/audit-integrity";
import { actors, expectDomainError, type DemoUser } from "./helpers";

let as: Record<DemoUser, Actor>;

beforeAll(async () => {
  as = await actors();
});

class Rollback extends Error {}

/** Runs `fn` in a transaction that is always rolled back, so tampering never leaks into other tests. */
async function inRolledBackTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let result: T | undefined;
  await db
    .$transaction(
      async (tx) => {
        result = await fn(tx);
        throw new Rollback();
      },
      { timeout: 60_000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  return result as T;
}

async function middleRow(tx: Prisma.TransactionClient) {
  const count = await tx.auditLog.count();
  expect(count).toBeGreaterThan(5);
  return tx.auditLog.findUniqueOrThrow({ where: { seq: BigInt(Math.floor(count / 2)) } });
}

function expectBroken(result: ChainVerification, seq: bigint, reason: string) {
  expect(result.status).toBe("BROKEN");
  expect(result.broken).toMatchObject({ seq, reason });
  expect(result.verifiedThroughSeq).toBe(seq - 1n === 0n ? null : seq - 1n);
}

describe("audit chain", () => {
  it("is intact after seeding, with a gapless sequence", async () => {
    const result = await verifyAuditChain(db);
    const count = await db.auditLog.count();
    expect(result).toMatchObject({ status: "VERIFIED", checkedRows: count, broken: null });
    expect(result.verifiedThroughSeq).toBe(BigInt(count));
  });

  it("links each new entry to the previous head", async () => {
    const head = await db.auditLog.findFirstOrThrow({ orderBy: { seq: "desc" } });
    await db.$transaction((tx) => recordAudit(tx, as.admin, { action: "test.linked", entityType: "Session", entityId: "linked", summary: "Linked entry", metadata: { n: 1n } }));
    const added = await db.auditLog.findFirstOrThrow({ orderBy: { seq: "desc" } });
    expect(added.seq).toBe(head.seq + 1n);
    expect(added.prevHash).toBe(head.hash);
    expect(added.hash).toBe(computeAuditHash(added));
    expect(added.metadata).toBe('{"n":"1"}');
  });

  it("keeps a single chain when many transactions append concurrently", async () => {
    const before = await db.auditLog.count();
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_sleep(${(i % 5) / 200})`;
          await recordAudit(tx, i % 2 ? as.finance : as.godrej, { action: "test.concurrent", entityType: "Session", entityId: `c${i}`, summary: `Concurrent ${i}` });
        }),
      ),
    );
    expect(await db.auditLog.count()).toBe(before + 25);
    const result = await verifyAuditChain(db);
    expect(result.status).toBe("VERIFIED");
    expect(result.checkedRows).toBe(before + 25);
  });

  it("does not append when the surrounding transaction rolls back", async () => {
    const before = await db.auditLog.findFirstOrThrow({ orderBy: { seq: "desc" } });
    await inRolledBackTx((tx) => recordAudit(tx, as.admin, { action: "test.rolled_back", entityType: "Session", entityId: "rb", summary: "Never committed" }));
    const after = await db.auditLog.findFirstOrThrow({ orderBy: { seq: "desc" } });
    expect(after.id).toBe(before.id);
    expect((await verifyAuditChain(db)).status).toBe("VERIFIED");
  });

  const tamperings: [string, (row: Prisma.AuditLogGetPayload<object>) => Prisma.AuditLogUpdateInput][] = [
    ["actorUserId", (r) => ({ actorUserId: r.actorUserId ? null : "someone-else" })],
    ["actorName", () => ({ actorName: "Somebody Else" })],
    ["actorOrgId", (r) => ({ actorOrgId: r.actorOrgId ? null : "org-x" })],
    ["actorRole", (r) => ({ actorRole: r.actorRole === "SUPER_ADMIN" ? "CP_ADMIN" : "SUPER_ADMIN" })],
    ["action", () => ({ action: "tampered.action" })],
    ["entityType", () => ({ entityType: "Tampered" })],
    ["entityId", () => ({ entityId: "tampered-id" })],
    ["summary", (r) => ({ summary: `${r.summary}.` })],
    ["metadata", (r) => ({ metadata: r.metadata ? null : '{"approvedAmountPaise":"1"}' })],
    ["createdAt", (r) => ({ createdAt: new Date(r.createdAt.getTime() + 1) })],
  ];

  it.each(tamperings)("detects a change to %s", async (_field, change) => {
    const result = await inRolledBackTx(async (tx) => {
      const row = await middleRow(tx);
      await tx.auditLog.update({ where: { id: row.id }, data: change(row) });
      return { verification: await verifyAuditChain(tx), seq: row.seq };
    });
    expectBroken(result.verification, result.seq, "hash_mismatch");
  });

  it("detects a re-hashed entry through the broken link to the next entry, even with the key", async () => {
    const result = await inRolledBackTx(async (tx) => {
      const row = await middleRow(tx);
      const forged = { ...row, summary: "Forged summary" };
      await tx.auditLog.update({ where: { id: row.id }, data: { summary: forged.summary, hash: computeAuditHash(forged, row.hashKeyId!) } });
      return { verification: await verifyAuditChain(tx), seq: row.seq };
    });
    expectBroken(result.verification, result.seq + 1n, "prev_hash_mismatch");
  });

  it.each([
    ["plain SHA-256", (input: string) => createHash("sha256").update(input).digest("hex")],
    ["a guessed key", (input: string) => createHmac("sha256", randomBytes(32)).update(input).digest("hex")],
  ] as const)("rejects a chain recomputed without the key (%s)", async (_label, forge) => {
    const result = await inRolledBackTx(async (tx) => {
      const start = await middleRow(tx);
      const rows = await tx.auditLog.findMany({ where: { seq: { gte: start.seq } }, orderBy: { seq: "asc" } });
      let prevHash = (await tx.auditLog.findUniqueOrThrow({ where: { seq: start.seq - 1n } })).hash;
      for (const row of rows) {
        const edited = { ...row, prevHash, summary: row.seq === start.seq ? "Forged summary" : row.summary };
        const hash = forge(auditHashInput(edited, row.hashKeyId!));
        await tx.auditLog.update({ where: { id: row.id }, data: { summary: edited.summary, prevHash, hash } });
        prevHash = hash;
      }
      return { verification: await verifyAuditChain(tx), seq: start.seq };
    });
    expectBroken(result.verification, result.seq, "hash_mismatch");
  });

  it("reports an entry sealed with an unknown key", async () => {
    const result = await inRolledBackTx(async (tx) => {
      const row = await middleRow(tx);
      await tx.auditLog.update({ where: { id: row.id }, data: { hashKeyId: "retired-unknown" } });
      return { verification: await verifyAuditChain(tx), seq: row.seq };
    });
    expectBroken(result.verification, result.seq, "unknown_key");
  });

  it("detects a deleted entry in the middle", async () => {
    const result = await inRolledBackTx(async (tx) => {
      const row = await middleRow(tx);
      await tx.auditLog.delete({ where: { id: row.id } });
      return { verification: await verifyAuditChain(tx), seq: row.seq };
    });
    expectBroken(result.verification, result.seq, "sequence_gap");
  });

  it("detects deletion of the very first entry", async () => {
    const result = await inRolledBackTx(async (tx) => {
      await tx.auditLog.delete({ where: { seq: 1n } });
      return verifyAuditChain(tx);
    });
    expectBroken(result, 1n, "sequence_gap");
  });

  it("detects a deletion that is hidden by renumbering the following entries", async () => {
    const result = await inRolledBackTx(async (tx) => {
      const row = await middleRow(tx);
      await tx.auditLog.delete({ where: { id: row.id } });
      await tx.$executeRaw`UPDATE "AuditLog" SET "seq" = "seq" + 1000000 WHERE "seq" > ${row.seq}`;
      await tx.$executeRaw`UPDATE "AuditLog" SET "seq" = "seq" - 1000001 WHERE "seq" > ${row.seq + 1000000n}`;
      return { verification: await verifyAuditChain(tx), seq: row.seq };
    });
    expect(result.verification.status).toBe("BROKEN");
    expect(result.verification.broken?.seq).toBe(result.seq);
    expect(["hash_mismatch", "prev_hash_mismatch"]).toContain(result.verification.broken?.reason);
  });

  it("detects removal of the newest entries once the head has been anchored", async () => {
    const result = await inRolledBackTx(async (tx) => {
      const anchor = await anchorAuditHead(tx, new Date("2099-01-01T00:00:00Z"));
      expect(anchor?.created).toBe(true);
      expect(verifyAnchorSignature(anchor!.anchor)).toBe(true);
      expect((await verifyAuditChain(tx)).anchorsChecked).toBeGreaterThan(0);
      const head = await tx.auditLog.findFirstOrThrow({ orderBy: { seq: "desc" } });
      await tx.auditLog.delete({ where: { id: head.id } });
      return { verification: await verifyAuditChain(tx), headSeq: head.seq };
    });
    expect(result.verification.status).toBe("BROKEN");
    expect(result.verification.broken).toMatchObject({ seq: result.headSeq, reason: "truncated" });
  });

  it("detects an anchor that no longer matches its entry", async () => {
    const result = await inRolledBackTx(async (tx) => {
      const { anchor } = (await anchorAuditHead(tx, new Date("2099-01-02T00:00:00Z")))!;
      await tx.auditAnchor.update({ where: { day: anchor.statement.day }, data: { hash: "0".repeat(64) } });
      return { verification: await verifyAuditChain(tx), seq: BigInt(anchor.statement.seq) };
    });
    // The stored statement no longer matches its signature.
    expect(result.verification.broken).toMatchObject({ seq: result.seq, reason: "anchor_signature_invalid" });
  });

  it("detects a re-signed anchor that points at a different hash", async () => {
    const result = await inRolledBackTx(async (tx) => {
      const { anchor } = (await anchorAuditHead(tx, new Date("2099-01-03T00:00:00Z")))!;
      const forged = { ...anchor.statement, headHash: "0".repeat(64) };
      const signature = createHmac("sha256", auditKeyring().keys.get(forged.keyId)!).update(canonicalJson({ ...forged })).digest("hex");
      await tx.auditAnchor.update({ where: { day: forged.day }, data: { hash: forged.headHash, signature } });
      return { verification: await verifyAuditChain(tx), seq: BigInt(forged.seq) };
    });
    expect(result.verification.broken).toMatchObject({ seq: result.seq, reason: "anchor_mismatch" });
  });

  it("checks an exported anchor file even after the anchors and newest entries are deleted from the database", async () => {
    const result = await inRolledBackTx(async (tx) => {
      await anchorAuditHead(tx, new Date("2099-01-04T00:00:00Z"));
      const exported = parseAnchorFile(serialiseAnchorFile(await listSignedAnchors(tx)));
      expect((await verifyAuditChain(tx, { externalAnchors: exported })).status).toBe("VERIFIED");
      const head = await tx.auditLog.findFirstOrThrow({ orderBy: { seq: "desc" } });
      await tx.auditAnchor.deleteMany();
      await tx.auditLog.delete({ where: { id: head.id } });
      expect((await verifyAuditChain(tx)).status).toBe("VERIFIED");
      const tampered = exported.map((a) => ({ ...a, statement: { ...a.statement, seq: "1" } }));
      return {
        withFile: await verifyAuditChain(tx, { externalAnchors: exported }),
        withTamperedFile: await verifyAuditChain(tx, { externalAnchors: tampered }),
        headSeq: head.seq,
      };
    });
    expect(result.withFile.broken).toMatchObject({ seq: result.headSeq, reason: "truncated" });
    expect(result.withTamperedFile.broken?.reason).toBe("anchor_signature_invalid");
  });

  it("anchors once per day and refuses to anchor a broken chain", async () => {
    await inRolledBackTx(async (tx) => {
      const first = await anchorAuditHead(tx, new Date("2099-02-01T05:00:00Z"));
      await appendAuditEntry(tx, { actorUserId: null, actorName: "System", actorOrgId: null, actorRole: null, action: "test.after_anchor", entityType: "Session", entityId: "a", summary: "After anchor", metadata: null });
      const second = await anchorAuditHead(tx, new Date("2099-02-01T23:00:00Z"));
      expect(second).toMatchObject({ created: false, anchor: first!.anchor });
      const row = await middleRow(tx);
      await tx.auditLog.update({ where: { id: row.id }, data: { summary: "tampered" } });
      await expect(anchorAuditHead(tx, new Date("2099-02-02T00:00:00Z"))).rejects.toThrow(/refusing to anchor/);
    });
  });

  it("publishes each new anchor as a structured log line", async () => {
    const logs: LogRecord[] = [];
    const restore = setLogSink((record) => logs.push(record));
    try {
      const result = await publishDailyAuditAnchor(new Date("2098-12-31T23:00:00Z"));
      expect(result?.created).toBe(true);
    } finally {
      restore();
      await db.auditAnchor.deleteMany({ where: { day: "2098-12-31" } });
    }
    expect(logs[0]).toMatchObject({ level: "info", message: "audit.anchor.published", statement: { type: "brickflow.audit.anchor", day: "2098-12-31" } });
    expect(String(logs[0]!.signature)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports a nulled hash as broken and never re-seals it", async () => {
    await inRolledBackTx(async (tx) => {
      const row = await middleRow(tx);
      await tx.auditLog.update({ where: { id: row.id }, data: { hash: null } });
      expectBroken(await verifyAuditChain(tx), row.seq, "unsealed");
      expect(await sealLegacyAuditRows(tx)).toMatchObject({ status: "already_sealed", sealed: 0 });
      await appendAuditEntry(tx, { actorUserId: null, actorName: "System", actorOrgId: null, actorRole: null, action: "test.after_null", entityType: "Session", entityId: "n", summary: "Appended after a nulled middle hash", metadata: null });
      expect((await tx.auditLog.findUniqueOrThrow({ where: { id: row.id } })).hash).toBeNull();
      expectBroken(await verifyAuditChain(tx), row.seq, "unsealed");
    });
  });

  it.each([
    ["has no hash", { hash: null }],
    ["was edited", { summary: "Edited head" }],
    ["claims an unknown key", { hashKeyId: "retired-unknown" }],
  ] as const)("refuses to append when the head %s, logging the refusal", async (_label, damage) => {
    const logs: LogRecord[] = [];
    const restore = setLogSink((record) => logs.push(record));
    try {
      await inRolledBackTx(async (tx) => {
        const head = await tx.auditLog.findFirstOrThrow({ orderBy: { seq: "desc" } });
        await tx.auditLog.update({ where: { id: head.id }, data: damage });
        await expect(recordAudit(tx, as.admin, { action: "test.refused", entityType: "Session", entityId: "r", summary: "Must not be written" })).rejects.toBeInstanceOf(AuditChainIntegrityError);
        expect(await tx.auditLog.count({ where: { action: "test.refused" } })).toBe(0);
      });
    } finally {
      restore();
    }
    expect(logs.find((l) => l.message === "audit.chain_append_refused")).toMatchObject({ level: "error", action: "test.refused" });
  });

  it("seals rows up to the legacy cutoff exactly once and never beyond it", async () => {
    await inRolledBackTx(async (tx) => {
      const original = await tx.auditLog.findMany({ where: { seq: { lte: 6n } }, orderBy: { seq: "asc" } });
      await tx.auditChainState.update({ where: { id: 1 }, data: { legacyCutoffSeq: 5n, legacySealedAt: null } });
      await tx.auditLog.updateMany({ where: { seq: { lte: 5n } }, data: { hash: null, prevHash: null, hashKeyId: null } });
      expectBroken(await verifyAuditChain(tx), 1n, "unsealed");

      expect(await sealLegacyAuditRows(tx)).toEqual({ status: "sealed", cutoffSeq: 5n, sealed: 5 });
      const resealed = await tx.auditLog.findMany({ where: { seq: { lte: 6n } }, orderBy: { seq: "asc" } });
      expect(resealed.map((r) => r.hash)).toEqual(original.map((r) => r.hash));
      expect((await verifyAuditChain(tx)).status).toBe("VERIFIED");

      await tx.auditLog.update({ where: { seq: 2n }, data: { hash: null } });
      expect(await sealLegacyAuditRows(tx)).toMatchObject({ status: "already_sealed", sealed: 0 });
      expectBroken(await verifyAuditChain(tx), 2n, "unsealed");
    });
  });

  it("refuses to seal when a row beyond the cutoff is unsealed or the legacy range has a gap", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.auditChainState.update({ where: { id: 1 }, data: { legacyCutoffSeq: 3n, legacySealedAt: null } });
      await tx.auditLog.updateMany({ where: { seq: { lte: 4n } }, data: { hash: null, prevHash: null, hashKeyId: null } });
      await expect(sealLegacyAuditRows(tx)).rejects.toThrow(/does not link/);
    });
    await inRolledBackTx(async (tx) => {
      await tx.auditChainState.update({ where: { id: 1 }, data: { legacyCutoffSeq: 3n, legacySealedAt: null } });
      await tx.auditLog.updateMany({ where: { seq: { lte: 3n } }, data: { hash: null, prevHash: null, hashKeyId: null } });
      await tx.auditLog.delete({ where: { seq: 2n } });
      await expect(sealLegacyAuditRows(tx)).rejects.toThrow(/missing/);
    });
  });
});

describe("audit integrity service", () => {
  it("lets a super admin verify now, stores the result and records who ran it", async () => {
    const result = await verifyAuditChainNow(as.admin);
    expect(result.status).toBe("VERIFIED");
    const overview = await getAuditIntegrity(as.admin);
    expect(overview.latest).toMatchObject({ status: "VERIFIED", triggeredByName: as.admin.name, broken: null });
    expect(overview.latest?.verifiedThroughSeq).toBe(result.verifiedThroughSeq);
    expect(overview.entries).toBe(Number(result.verifiedThroughSeq) + 1);
    const audit = await db.auditLog.findFirstOrThrow({ orderBy: { seq: "desc" } });
    expect(audit).toMatchObject({ action: "audit.chain_verified", entityType: "AuditLog", actorUserId: as.admin.userId });
  });

  it("refuses everyone except platform super admins", async () => {
    for (const user of ["finance", "godrej", "prestige"] as const) {
      await expectDomainError(verifyAuditChainNow(as[user]), "FORBIDDEN");
      await expectDomainError(getAuditIntegrity(as[user]), "FORBIDDEN");
    }
  });

  it("reports the first broken link with the affected entry", async () => {
    const row = await db.auditLog.findUniqueOrThrow({ where: { seq: 3n } });
    await db.auditLog.update({ where: { id: row.id }, data: { summary: `${row.summary} (edited)` } });
    try {
      const result = await verifyAuditChainNow(as.admin);
      expect(result).toMatchObject({ status: "BROKEN", brokenSeq: "3", verifiedThroughSeq: "2" });
      const overview = await getAuditIntegrity(as.admin);
      expect(overview.latest?.broken).toMatchObject({ seq: "3", reason: "hash_mismatch", auditId: row.id, summary: `${row.summary} (edited)` });
    } finally {
      await db.auditLog.update({ where: { id: row.id }, data: { summary: row.summary } });
    }
    expect((await verifyAuditChainNow(as.admin)).status).toBe("VERIFIED");
  });
});
