/**
 * Copies every stored invoice document from the local driver (STORAGE_DIR) to the S3 driver
 * (S3_* variables), keeping the same storage keys, and verifies each copy by SHA-256 against the
 * hash recorded in the database. Objects already present in the bucket with the right hash are
 * skipped, so the command can be re-run safely.
 *
 *   npm run storage:migrate -- --dry-run
 *   npm run storage:migrate -- --concurrency 8
 *
 * Exits with status 1 if any document is missing locally, does not match its recorded hash, or
 * fails verification after upload. Switch STORAGE_DRIVER to "s3" only after a clean run.
 */
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createLocalDriver, createS3Driver, StorageObjectNotFoundError } from "../src/server/storage-drivers";

try {
  process.loadEnvFile();
} catch {
  // Environment supplied externally.
}

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
  },
});
const dryRun = values["dry-run"] ?? false;
const concurrency = Math.min(32, Math.max(1, Number.parseInt(values.concurrency ?? "4", 10) || 4));

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not configured");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const local = createLocalDriver();
const remote = createS3Driver();

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type Outcome = "copied" | "would-copy" | "skipped" | "failed";

async function remoteHash(key: string): Promise<string | null> {
  try {
    return hash(await remote.get(key));
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) return null;
    throw error;
  }
}

async function migrate(document: { id: string; storageKey: string; sha256: string; mimeType: string }): Promise<Outcome> {
  const label = `${document.storageKey} (document ${document.id})`;
  let bytes: Uint8Array;
  try {
    bytes = await local.get(document.storageKey);
  } catch (error) {
    console.error(`FAIL  ${label}: not readable from local storage (${(error as Error).message})`);
    return "failed";
  }
  if (hash(bytes) !== document.sha256) {
    console.error(`FAIL  ${label}: local file does not match the recorded SHA-256`);
    return "failed";
  }

  const existing = await remoteHash(document.storageKey);
  if (existing === document.sha256) return "skipped";
  if (dryRun) {
    console.log(`PLAN  ${label}${existing ? " (bucket copy differs; would overwrite)" : ""}`);
    return "would-copy";
  }

  await remote.put(document.storageKey, bytes, document.mimeType || "application/pdf");
  const uploaded = await remoteHash(document.storageKey);
  if (uploaded !== document.sha256) {
    console.error(`FAIL  ${label}: verification after upload failed`);
    return "failed";
  }
  console.log(`COPY  ${label}`);
  return "copied";
}

async function main() {
  const documents = await db.invoiceDocument.findMany({ select: { id: true, storageKey: true, sha256: true, mimeType: true }, orderBy: { createdAt: "asc" } });
  console.log(`${dryRun ? "Dry run: " : ""}migrating ${documents.length} invoice documents to S3 with concurrency ${concurrency}`);

  const counts: Record<Outcome, number> = { copied: 0, "would-copy": 0, skipped: 0, failed: 0 };
  let next = 0;
  async function worker() {
    while (next < documents.length) {
      const document = documents[next++]!;
      try {
        counts[await migrate(document)] += 1;
      } catch (error) {
        console.error(`FAIL  ${document.storageKey}: ${(error as Error).message}`);
        counts.failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(documents.length, 1)) }, worker));

  console.log(`Done: ${counts.copied} copied, ${counts["would-copy"]} to copy, ${counts.skipped} already present, ${counts.failed} failed.`);
  if (counts.failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
