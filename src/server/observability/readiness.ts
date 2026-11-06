import "server-only";
import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import { storage } from "../storage";
import { logger } from "./logger";

export type CheckStatus = "ok" | "fail";
export type MigrationStatus = "ok" | "pending" | "failed" | "unknown" | "fail";

export interface ReadinessReport {
  ready: boolean;
  checks: { database: CheckStatus; migrations: MigrationStatus; storage: CheckStatus };
}

const CHECK_TIMEOUT_MS = 3_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} check timed out after ${CHECK_TIMEOUT_MS} ms`)), CHECK_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Migration folders shipped with this build (the image copies prisma/migrations next to the server). */
export function defaultMigrationsDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.MIGRATIONS_DIR ?? "prisma/migrations");
}

export async function listBundledMigrations(dir: string): Promise<string[] | null> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      if ((await stat(path.join(dir, entry.name, "migration.sql"))).isFile()) names.push(entry.name);
    } catch {
      // A folder without migration.sql is not a migration.
    }
  }
  return names.sort();
}

/**
 * Compares the migrations bundled with this build against `_prisma_migrations`. Pending means the
 * database is behind the code; a failed (unfinished, not rolled back) migration blocks readiness. A
 * database that is ahead of the build (newer migrations applied) stays ready so a rollback can serve.
 */
export async function checkMigrations(dir: string = defaultMigrationsDir()): Promise<MigrationStatus> {
  const bundled = await listBundledMigrations(dir);
  if (!bundled) return "unknown";
  const rows = await db.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
    SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
  if (rows.some((r) => r.finished_at === null && r.rolled_back_at === null)) return "failed";
  const applied = new Set(rows.filter((r) => r.finished_at !== null && r.rolled_back_at === null).map((r) => r.migration_name));
  return bundled.every((name) => applied.has(name)) ? "ok" : "pending";
}

async function checkDatabase(): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}

async function checkStorage(): Promise<void> {
  const key = `_readiness/${randomUUID()}.probe`;
  const payload = new TextEncoder().encode(`ready ${new Date().toISOString()}`);
  const driver = storage();
  await driver.put(key, payload, "text/plain");
  try {
    const read = await driver.get(key);
    if (read.byteLength !== payload.byteLength) throw new Error("Storage read-back mismatch");
  } finally {
    await driver.delete(key);
  }
}

async function settle<T>(label: string, run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await withTimeout(run(), label) };
  } catch (error) {
    logger.warn("readiness.check_failed", { check: label, err: error });
    return { ok: false };
  }
}

export async function evaluateReadiness(options: { migrationsDir?: string } = {}): Promise<ReadinessReport> {
  const [database, storageResult] = await Promise.all([settle("database", checkDatabase), settle("storage", checkStorage)]);
  const migrations = database.ok ? await settle("migrations", () => checkMigrations(options.migrationsDir)) : { ok: false as const };
  const checks: ReadinessReport["checks"] = {
    database: database.ok ? "ok" : "fail",
    migrations: migrations.ok ? migrations.value : "fail",
    storage: storageResult.ok ? "ok" : "fail",
  };
  const ready = checks.database === "ok" && (checks.migrations === "ok" || checks.migrations === "unknown") && checks.storage === "ok";
  if (checks.migrations === "unknown" && !warnedUnverifiable) {
    warnedUnverifiable = true;
    logger.warn("readiness.migrations_unverifiable", { migrationsDir: options.migrationsDir ?? defaultMigrationsDir() });
  }
  return { ready, checks };
}

let warnedUnverifiable = false;

const CACHE_MS = 2_000;
let cached: { at: number; report: Promise<ReadinessReport> } | undefined;

/** Readiness with a short cache so a burst of probes cannot turn into a burst of storage writes. */
export function readiness(now: number = Date.now()): Promise<ReadinessReport> {
  if (cached && now - cached.at < CACHE_MS) return cached.report;
  const report = evaluateReadiness();
  cached = { at: now, report };
  return report;
}

export function resetReadinessCache(): void {
  cached = undefined;
}
