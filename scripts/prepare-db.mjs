/**
 * Recreates an isolated SQLite database for automated tests: deletes the file, applies all
 * migrations and runs the real demo seed with the "standard" dataset the tests are written
 * against. Used by the Vitest global setup and the Playwright web server.
 *
 *   node scripts/prepare-db.mjs --database-url file:./prisma/e2e.db --storage-dir ./storage/e2e
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PRISMA_CLI = path.join(ROOT, "node_modules", "prisma", "build", "index.js");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const PROTECTED_FILES = new Set(["dev.db"]);

/**
 * @param {{ databaseUrl: string; storageDir: string; demoPassword?: string; quiet?: boolean }} options
 */
export function prepareDatabase({ databaseUrl, storageDir, demoPassword = "BrickFlow@2026", quiet = false }) {
  if (!databaseUrl.startsWith("file:")) throw new Error(`Only SQLite file URLs are supported, got "${databaseUrl}"`);
  const dbFile = path.resolve(ROOT, databaseUrl.slice("file:".length));
  if (PROTECTED_FILES.has(path.basename(dbFile))) throw new Error(`Refusing to recreate the development database (${dbFile})`);

  for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(`${dbFile}${suffix}`, { force: true });
  rmSync(path.resolve(ROOT, storageDir), { recursive: true, force: true });

  const env = { ...process.env, DATABASE_URL: databaseUrl, STORAGE_DIR: storageDir, DEMO_PASSWORD: demoPassword, DEMO_DATASET: "standard" };
  const stdio = quiet ? "pipe" : "inherit";
  execFileSync(process.execPath, [PRISMA_CLI, "migrate", "deploy"], { cwd: ROOT, env, stdio });
  execFileSync(process.execPath, [TSX_CLI, "prisma/seed.ts"], { cwd: ROOT, env, stdio });
  return dbFile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      "database-url": { type: "string" },
      "storage-dir": { type: "string" },
      "demo-password": { type: "string" },
    },
  });
  if (!values["database-url"] || !values["storage-dir"]) {
    console.error("Usage: node scripts/prepare-db.mjs --database-url file:./prisma/<name>.db --storage-dir <dir> [--demo-password <password>]");
    process.exit(2);
  }
  const file = prepareDatabase({
    databaseUrl: values["database-url"],
    storageDir: values["storage-dir"],
    demoPassword: values["demo-password"] ?? process.env.DEMO_PASSWORD,
  });
  console.log(`Prepared ${path.relative(ROOT, file)}`);
}
