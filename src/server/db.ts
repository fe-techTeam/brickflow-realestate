import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { logger } from "./observability/logger";

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; pgPool?: Pool };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  const pool = new Pool({
    connectionString,
    max: positiveInt(process.env.DATABASE_POOL_MAX, 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Lets short-lived processes (scripts, test workers) exit without an explicit disconnect.
    allowExitOnIdle: true,
  });
  pool.on("error", (error) => logger.error("db.idle_client_error", { err: error }));
  globalForPrisma.pgPool = pool;
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** Connection pool counters for the metrics endpoint. */
export function databasePoolStats(): { total: number; idle: number; waiting: number; max: number } | null {
  const pool = globalForPrisma.pgPool;
  return pool ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: pool.options.max ?? 10 } : null;
}

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
