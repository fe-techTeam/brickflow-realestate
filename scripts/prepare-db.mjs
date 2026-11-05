/**
 * Recreates an isolated PostgreSQL database for automated tests: drops and recreates the database,
 * applies all migrations and runs the real demo seed with the "standard" dataset the tests are
 * written against. Used by the Vitest global setup and the Playwright web server.
 *
 *   node scripts/prepare-db.mjs --target e2e --storage-dir ./storage/e2e
 *   node scripts/prepare-db.mjs --database-url postgresql://user:pass@host:5432/brickflow_e2e --storage-dir ./storage/e2e
 *
 * Only databases whose name ends in "_test" or "_e2e" can be recreated, so the development or a
 * production database is never wiped by accident.
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { TEST_DATABASE_URLS } from "./test-databases.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PRISMA_CLI = path.join(ROOT, "node_modules", "prisma", "build", "index.js");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const DISPOSABLE_NAME = /^[a-z0-9_]+_(test|e2e)$/;

/** Validates the URL and returns the database name it points at. */
export function disposableDatabaseName(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("Expected a postgresql:// database URL");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error(`Expected a postgresql:// database URL, got "${url.protocol}"`);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!DISPOSABLE_NAME.test(name)) {
    throw new Error(`Refusing to recreate database "${name}": only databases named *_test or *_e2e are recreated by this script`);
  }
  return name;
}

async function recreateDatabase(databaseUrl, name) {
  const admin = new URL(databaseUrl);
  admin.pathname = "/postgres";
  admin.search = "";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

/**
 * @param {{ databaseUrl: string; storageDir: string; demoPassword?: string; quiet?: boolean }} options
 */
export async function prepareDatabase({ databaseUrl, storageDir, demoPassword = "BrickFlow@2026", quiet = false }) {
  const name = disposableDatabaseName(databaseUrl);
  await recreateDatabase(databaseUrl, name);
  rmSync(path.resolve(ROOT, storageDir), { recursive: true, force: true });

  const env = { ...process.env, DATABASE_URL: databaseUrl, STORAGE_DIR: storageDir, DEMO_PASSWORD: demoPassword, DEMO_DATASET: "standard" };
  const stdio = quiet ? "pipe" : "inherit";
  execFileSync(process.execPath, [PRISMA_CLI, "migrate", "deploy"], { cwd: ROOT, env, stdio });
  execFileSync(process.execPath, [TSX_CLI, "prisma/seed.ts"], { cwd: ROOT, env, stdio });
  return name;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      target: { type: "string" },
      "database-url": { type: "string" },
      "storage-dir": { type: "string" },
      "demo-password": { type: "string" },
    },
  });
  const target = values.target;
  if (target !== undefined && !Object.hasOwn(TEST_DATABASE_URLS, target)) {
    console.error(`Unknown --target "${target}". Expected one of: ${Object.keys(TEST_DATABASE_URLS).join(", ")}`);
    process.exit(2);
  }
  const databaseUrl = values["database-url"] ?? (target ? TEST_DATABASE_URLS[target] : undefined);
  if (!databaseUrl || !values["storage-dir"]) {
    console.error("Usage: node scripts/prepare-db.mjs (--target test|e2e | --database-url <postgresql-url>) --storage-dir <dir> [--demo-password <password>]");
    process.exit(2);
  }
  const name = await prepareDatabase({
    databaseUrl,
    storageDir: values["storage-dir"],
    demoPassword: values["demo-password"] ?? process.env.DEMO_PASSWORD,
  });
  console.log(`Prepared database ${name}`);
}
