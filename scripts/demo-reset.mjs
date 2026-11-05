/**
 * Resets the demo: deletes every stored invoice PDF and re-seeds the dataset selected by
 * DEMO_DATASET into DATABASE_URL. All data entered since the last seed is lost.
 *
 *   npm run demo:reset                       (local, reads .env)
 *   node scripts/demo-reset.mjs --yes        (inside the production container)
 *
 * With NODE_ENV=production the reset only runs when --yes is passed.
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // Environment supplied externally.
}

const { values } = parseArgs({ options: { yes: { type: "boolean", default: false } } });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not configured");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && !values.yes) {
  console.error("This wipes all data and re-seeds the demo. Re-run with --yes to confirm.");
  process.exit(2);
}

const storageRoot = path.resolve(ROOT, process.env.STORAGE_DIR ?? "./storage");
const dataset = process.env.DEMO_DATASET ?? "standard";

console.log(`Clearing stored invoice files in ${storageRoot}`);
rmSync(path.join(storageRoot, "invoices"), { recursive: true, force: true });

console.log(`Re-seeding demo dataset "${dataset}"`);
execFileSync(process.execPath, [TSX_CLI, "prisma/seed.ts"], { cwd: ROOT, stdio: "inherit", env: process.env });
console.log("Demo reset complete.");
