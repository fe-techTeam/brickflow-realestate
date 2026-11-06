import { beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { anchorAuditHead, appendAuditEntry, computeAuditHash, sealAuditChain, verifyAuditChain, type ChainVerification } from "@/lib/audit-chain";
import { recordAudit } from "@/server/audit";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import { getAuditIntegrity, verifyAuditChainNow } from "@/server/services/audit-integrity";
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

  it("detects a recomputed hash through the broken link to the next entry", async () => {
    const result = await inRolledBackTx(async (tx) => {
      const row = await middleRow(tx);
      const forged = { ...row, summary: "Forged summary" };
      await tx.auditLog.update({ where: { id: row.id }, data: { summary: forged.summary, hash: computeAuditHash(forged) } });
      return { verification: await verifyAuditChain(tx), seq: row.seq };
    });
    expectBroken(result.verification, result.seq + 1n, "prev_hash_mismatch");
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
      const anchor = await anchorAuditHead(tx, new Date("2099-01-02T00:00:00Z"));
      await tx.auditAnchor.update({ where: { day: anchor!.day }, data: { hash: "0".repeat(64) } });
      return { verification: await verifyAuditChain(tx), seq: anchor!.seq };
    });
    expect(result.verification.broken).toMatchObject({ seq: result.seq, reason: "anchor_mismatch" });
  });

  it("anchors once per day and refuses to anchor a broken chain", async () => {
    await inRolledBackTx(async (tx) => {
      const day = new Date("2099-02-01T05:00:00Z");
      const first = await anchorAuditHead(tx, day);
      await appendAuditEntry(tx, { actorUserId: null, actorName: "System", actorOrgId: null, actorRole: null, action: "test.after_anchor", entityType: "Session", entityId: "a", summary: "After anchor", metadata: null });
      const second = await anchorAuditHead(tx, new Date("2099-02-01T23:00:00Z"));
      expect(second).toMatchObject({ created: false, seq: first!.seq, hash: first!.hash });
      const row = await middleRow(tx);
      await tx.auditLog.update({ where: { id: row.id }, data: { summary: "tampered" } });
      await expect(anchorAuditHead(tx, new Date("2099-02-02T00:00:00Z"))).rejects.toThrow(/refusing to anchor/);
    });
  });

  it("reports rows without a hash and seals them before the next append", async () => {
    await inRolledBackTx(async (tx) => {
      const head = await tx.auditLog.findFirstOrThrow({ orderBy: { seq: "desc" } });
      await tx.auditLog.updateMany({ where: { seq: { gt: head.seq - 3n } }, data: { hash: null, prevHash: null } });
      const unsealed = await verifyAuditChain(tx);
      expect(unsealed.broken).toMatchObject({ seq: head.seq - 2n, reason: "unsealed" });
      await appendAuditEntry(tx, { actorUserId: null, actorName: "System", actorOrgId: null, actorRole: null, action: "test.after_legacy", entityType: "Session", entityId: "l", summary: "After legacy rows", metadata: null });
      const sealed = await verifyAuditChain(tx);
      expect(sealed.status).toBe("VERIFIED");
      const restored = await tx.auditLog.findUniqueOrThrow({ where: { seq: head.seq } });
      expect(restored.hash).toBe(head.hash);
    });
  });

  it("backfills legacy rows in insertion order and never rewrites sealed rows", async () => {
    const head = await db.auditLog.findFirstOrThrow({ orderBy: { seq: "desc" } });
    await db.auditLog.updateMany({ where: { seq: { gt: head.seq - 4n } }, data: { hash: null, prevHash: null } });
    expect((await verifyAuditChain(db)).broken?.reason).toBe("unsealed");
    expect(await sealAuditChain(db, { batchSize: 2 })).toBe(4);
    expect(await sealAuditChain(db)).toBe(0);
    expect((await db.auditLog.findUniqueOrThrow({ where: { seq: head.seq } })).hash).toBe(head.hash);
    expect((await verifyAuditChain(db)).status).toBe("VERIFIED");
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
