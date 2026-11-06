/**
 * Audit chain maintenance (operator commands; nothing here runs automatically).
 *
 *   npm run audit:verify [-- --anchors <file>]   verify every link (and, optionally, an exported anchor
 *                                                file), record the result, exit 1 when the chain is broken
 *   npm run audit:seal-legacy [-- --dry-run]     ONE-TIME: seal the entries that predate the chain, sign
 *                                                the chain state and publish an anchor of the legacy head
 *   npm run audit:anchor                         verify, then sign and record today's chain head
 *   npm run audit:export-anchors [-- --out <file>]
 *                                                write every signed anchor (JSON lines) for write-once storage
 *   npm run audit:rotate-key                     close the old key's range and switch to the new key
 *                                                (new key in AUDIT_HMAC_KEY/_ID, old in AUDIT_HMAC_PREVIOUS_KEYS)
 *
 * Output is one JSON line per event so it can be shipped with the application logs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  ANCHOR_LOG_EVENT,
  anchorAuditHead,
  CHAIN_BREAK_LABELS,
  describeLegacySeal,
  listSignedAnchors,
  parseAnchorFile,
  rotateAuditKeyInTransaction,
  runAuditChainCheck,
  sealLegacyAuditRowsInTransaction,
  serialiseAnchorFile,
  verifyAnchorSignature,
} from "../src/lib/audit-chain";
import { auditKeyring } from "../src/lib/audit-keys";

try {
  process.loadEnvFile();
} catch {
  // Environment supplied externally.
}

const COMMANDS = ["verify", "seal-legacy", "anchor", "export-anchors", "rotate-key"] as const;
type Command = (typeof COMMANDS)[number];

function emit(level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) {
  const line = JSON.stringify(
    { level, time: new Date().toISOString(), message, service: "brickflow-audit", ...fields },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
  );
  (level === "info" ? process.stdout : process.stderr).write(`${line}\n`);
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { anchors: { type: "string" }, out: { type: "string" }, "dry-run": { type: "boolean" } },
  });
  const command = positionals[0] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) {
    process.stderr.write(`Usage: tsx scripts/audit-chain.ts <${COMMANDS.join("|")}> [--anchors <file>] [--out <file>] [--dry-run]\n`);
    return 2;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("DATABASE_URL is not configured\n");
    return 2;
  }
  const keyring = auditKeyring();
  if (keyring.insecure) emit("warn", "audit.key.development", { keyId: keyring.currentKeyId, note: "Using the public development key; set AUDIT_HMAC_KEY outside development." });

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    if (command === "seal-legacy") {
      if (values["dry-run"]) {
        emit("info", "audit.seal_legacy.plan", { ...(await describeLegacySeal(db)), keyId: keyring.currentKeyId });
        return 0;
      }
      const result = await sealLegacyAuditRowsInTransaction(db);
      emit("info", "audit.seal_legacy.completed", { status: result.status, cutoffSeq: result.cutoffSeq, sealed: result.sealed, keyId: keyring.currentKeyId });
      if (result.anchor) emit("info", ANCHOR_LOG_EVENT, { created: true, ...result.anchor });
      return 0;
    }
    if (command === "rotate-key") {
      const result = await rotateAuditKeyInTransaction(db);
      emit("info", "audit.key_rotated", { ...result });
      return 0;
    }
    if (command === "anchor") {
      const result = await anchorAuditHead(db);
      if (!result) {
        emit("info", "audit.anchor.skipped", { reason: "empty chain" });
        return 0;
      }
      emit("info", ANCHOR_LOG_EVENT, { created: result.created, ...result.anchor });
      return 0;
    }
    if (command === "export-anchors") {
      const anchors = await listSignedAnchors(db);
      const out = path.resolve(values.out ?? `audit-anchors-${new Date().toISOString().slice(0, 10)}.jsonl`);
      writeFileSync(out, serialiseAnchorFile(anchors), { encoding: "utf8", flag: "w" });
      emit("info", "audit.anchors.exported", { file: out, anchors: anchors.length, latest: anchors.at(-1)?.statement ?? null });
      return 0;
    }

    const externalAnchors = values.anchors ? parseAnchorFile(readFileSync(path.resolve(values.anchors), "utf8")) : undefined;
    if (externalAnchors) {
      const invalid = externalAnchors.filter((a) => !verifyAnchorSignature(a, keyring));
      if (invalid.length) emit("error", "audit.anchors.signature_invalid", { file: values.anchors, invalid: invalid.map((a) => a.statement.day) });
    }
    const { verification, check } = await runAuditChainCheck(db, { id: null, name: "Command line" }, { externalAnchors });
    const fields = {
      checkId: check.id,
      status: verification.status,
      checkedRows: verification.checkedRows,
      headSeq: verification.headSeq,
      verifiedThroughSeq: verification.verifiedThroughSeq,
      anchorsChecked: verification.anchorsChecked,
      externalAnchors: externalAnchors?.length ?? 0,
      durationMs: check.durationMs,
      ...(verification.broken ? { broken: { ...verification.broken, label: CHAIN_BREAK_LABELS[verification.broken.reason] } } : {}),
    };
    if (verification.status === "BROKEN") {
      emit("error", "audit.verify.broken", fields);
      return 1;
    }
    emit("info", "audit.verify.ok", fields);
    return 0;
  } finally {
    await db.$disconnect();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    emit("error", "audit.command.failed", { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  },
);
