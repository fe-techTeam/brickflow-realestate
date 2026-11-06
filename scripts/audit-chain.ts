/**
 * Audit chain maintenance.
 *
 *   npm run audit:verify     verify every link, record the result, exit 1 when the chain is broken
 *   npm run audit:backfill   compute hashes for rows written before the chain existed (idempotent)
 *   npm run audit:anchor     verify, then record today's chain head as the daily anchor
 *
 * Output is one JSON line so it can be shipped with the application logs.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { anchorAuditHead, CHAIN_BREAK_LABELS, runAuditChainCheck, sealAuditChain } from "../src/lib/audit-chain";

try {
  process.loadEnvFile();
} catch {
  // Environment supplied externally.
}

const COMMANDS = ["verify", "backfill", "anchor"] as const;
type Command = (typeof COMMANDS)[number];

function emit(level: "info" | "error", message: string, fields: Record<string, unknown>) {
  const line = JSON.stringify(
    { level, time: new Date().toISOString(), message, service: "brickflow-audit", ...fields },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
  );
  (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
}

async function main(): Promise<number> {
  const command = process.argv[2] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) {
    process.stderr.write(`Usage: tsx scripts/audit-chain.ts <${COMMANDS.join("|")}>\n`);
    return 2;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("DATABASE_URL is not configured\n");
    return 2;
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    if (command === "backfill") {
      const sealed = await sealAuditChain(db);
      emit("info", "audit.backfill.completed", { sealed });
      return 0;
    }
    if (command === "anchor") {
      const anchor = await anchorAuditHead(db);
      emit("info", anchor ? "audit.anchor.recorded" : "audit.anchor.skipped", anchor ? { ...anchor } : { reason: "empty chain" });
      return 0;
    }
    const { verification, check } = await runAuditChainCheck(db, { id: null, name: "Command line" });
    const fields = {
      checkId: check.id,
      status: verification.status,
      checkedRows: verification.checkedRows,
      headSeq: verification.headSeq,
      verifiedThroughSeq: verification.verifiedThroughSeq,
      anchorsChecked: verification.anchorsChecked,
      durationMs: check.durationMs,
      ...(verification.broken
        ? { broken: { ...verification.broken, label: CHAIN_BREAK_LABELS[verification.broken.reason] } }
        : {}),
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
