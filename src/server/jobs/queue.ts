import "server-only";
import { Prisma, type JobStatus } from "@/generated/prisma/client";
import { db, type Tx } from "../db";
import { backoffDelayMs, readQueueConfig, type QueueConfig } from "./config";
import type { JobRecord } from "./registry";

export type JobClient = Tx | typeof db;

export interface EnqueueJobInput {
  type: string;
  payload: unknown;
  /** Earliest time the job may run; defaults to now. */
  runAt?: Date;
  /** Enqueuing twice with the same key creates one job (the first one wins). */
  idempotencyKey?: string;
  maxAttempts?: number;
}

export interface EnqueuedJob {
  id: string;
  created: boolean;
}

/** Converts a payload to plain JSON (bigint becomes a decimal string) and rejects non-objects. */
export function toJsonPayload(payload: unknown): Prisma.InputJsonObject {
  const json = JSON.parse(JSON.stringify(payload ?? {}, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))) as unknown;
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new Error("Job payload must be a JSON object");
  return json as Prisma.InputJsonObject;
}

/**
 * Transactional outbox: inserts the job with the caller's transaction, so it exists only if the
 * business change commits. Uses ON CONFLICT DO NOTHING for the idempotency key, which (unlike a
 * caught unique violation) never aborts the surrounding PostgreSQL transaction.
 */
export async function enqueueJob(client: JobClient, input: EnqueueJobInput): Promise<EnqueuedJob> {
  if (!input.type) throw new Error("Job type is required");
  if (input.idempotencyKey !== undefined && (input.idempotencyKey.length === 0 || input.idempotencyKey.length > 200)) {
    throw new Error("Idempotency key must be 1-200 characters");
  }
  const maxAttempts = input.maxAttempts ?? readQueueConfig().defaultMaxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) throw new Error("maxAttempts must be between 1 and 100");

  const created = await client.job.createManyAndReturn({
    data: [
      {
        type: input.type,
        payload: toJsonPayload(input.payload),
        runAt: input.runAt ?? new Date(),
        idempotencyKey: input.idempotencyKey ?? null,
        maxAttempts,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  if (created[0]) return { id: created[0].id, created: true };
  const existing = await client.job.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey! }, select: { id: true } });
  return { id: existing.id, created: false };
}

interface ClaimedRow {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  createdAt: Date;
  idempotencyKey: string | null;
}

/**
 * Atomically leases up to `limit` runnable jobs: ready PENDING/RETRY jobs, plus RUNNING jobs whose
 * lease expired (their worker died). SKIP LOCKED lets any number of workers poll concurrently
 * without blocking each other or claiming the same row.
 */
export async function claimJobs(workerId: string, limit: number, leaseMs: number, now: Date = new Date(), types?: readonly string[]): Promise<JobRecord[]> {
  if (limit < 1 || (types && types.length === 0)) return [];
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const typeFilter = types ? Prisma.sql`AND "type" IN (${Prisma.join([...types])})` : Prisma.empty;
  const rows = await db.$queryRaw<ClaimedRow[]>`
    UPDATE "Job" AS j
       SET "status" = 'RUNNING', "lockedBy" = ${workerId}, "lockedUntil" = ${leaseUntil},
           "attempts" = j."attempts" + 1, "startedAt" = ${now}, "updatedAt" = ${now}
      FROM (
        SELECT "id" FROM "Job"
         WHERE (("status" IN ('PENDING', 'RETRY') AND "runAt" <= ${now})
            OR ("status" = 'RUNNING' AND "lockedUntil" < ${now}))
           ${typeFilter}
         ORDER BY "runAt" ASC, "createdAt" ASC
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      ) AS c
     WHERE j."id" = c."id"
    RETURNING j."id", j."type", j."payload", j."attempts", j."maxAttempts", j."runAt", j."createdAt", j."idempotencyKey"`;
  return rows.map((r) => ({ ...r, attempts: Number(r.attempts), maxAttempts: Number(r.maxAttempts) }));
}

/** Extends the lease of a job this worker still owns. Returns false when the lease was lost. */
export async function renewLease(jobId: string, workerId: string, leaseMs: number, now: Date = new Date()): Promise<boolean> {
  const updated = await db.job.updateMany({
    where: { id: jobId, lockedBy: workerId, status: "RUNNING" },
    data: { lockedUntil: new Date(now.getTime() + leaseMs) },
  });
  return updated.count === 1;
}

export async function completeJob(jobId: string, workerId: string, now: Date = new Date()): Promise<boolean> {
  const updated = await db.job.updateMany({
    where: { id: jobId, lockedBy: workerId, status: "RUNNING" },
    data: { status: "SUCCEEDED", completedAt: now, lockedBy: null, lockedUntil: null },
  });
  return updated.count === 1;
}

export interface FailOutcome {
  status: Extract<JobStatus, "RETRY" | "DEAD">;
  runAt?: Date;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.slice(0, 2000);
}

/** Schedules a retry with backoff, or dead-letters the job when it is permanent or out of attempts. */
export async function failJob(
  job: Pick<JobRecord, "id" | "attempts" | "maxAttempts">,
  workerId: string,
  error: unknown,
  options: { permanent?: boolean; now?: Date; config?: QueueConfig; random?: () => number } = {},
): Promise<FailOutcome | null> {
  const now = options.now ?? new Date();
  const config = options.config ?? readQueueConfig();
  const dead = options.permanent === true || job.attempts >= job.maxAttempts;
  const outcome: FailOutcome = dead
    ? { status: "DEAD" }
    : { status: "RETRY", runAt: new Date(now.getTime() + backoffDelayMs(job.attempts, config.backoffBaseMs, config.backoffMaxMs, options.random)) };
  const updated = await db.job.updateMany({
    where: { id: job.id, lockedBy: workerId, status: "RUNNING" },
    data: {
      status: outcome.status,
      lastError: describeError(error),
      lockedBy: null,
      lockedUntil: null,
      ...(dead ? { completedAt: now } : { runAt: outcome.runAt }),
    },
  });
  return updated.count === 1 ? outcome : null;
}

/** Hands an unfinished job back on shutdown without counting the interrupted attempt. */
export async function releaseJob(jobId: string, workerId: string, now: Date = new Date()): Promise<boolean> {
  const updated = await db.$executeRaw`
    UPDATE "Job"
       SET "status" = 'PENDING', "lockedBy" = NULL, "lockedUntil" = NULL, "runAt" = ${now},
           "attempts" = GREATEST("attempts" - 1, 0), "updatedAt" = ${now}
     WHERE "id" = ${jobId} AND "lockedBy" = ${workerId} AND "status" = 'RUNNING'`;
  return updated === 1;
}

/* ----------------------------------------------------------------------------------------------
 * Operator actions and metrics
 * -------------------------------------------------------------------------------------------- */

const RETRYABLE: JobStatus[] = ["RETRY", "DEAD", "CANCELLED"];
const CANCELLABLE: JobStatus[] = ["PENDING", "RETRY", "DEAD"];

/** Makes a failed, dead or cancelled job runnable now with a fresh set of attempts. */
export async function requeueJob(client: JobClient, jobId: string, now: Date = new Date()) {
  const updated = await client.job.updateMany({
    where: { id: jobId, status: { in: RETRYABLE } },
    data: { status: "PENDING", runAt: now, attempts: 0, completedAt: null, lockedBy: null, lockedUntil: null },
  });
  return updated.count === 1;
}

export async function cancelJob(client: JobClient, jobId: string, now: Date = new Date()) {
  const updated = await client.job.updateMany({
    where: { id: jobId, status: { in: CANCELLABLE } },
    data: { status: "CANCELLED", completedAt: now, lockedBy: null, lockedUntil: null },
  });
  return updated.count === 1;
}

export interface QueueStats {
  generatedAt: string;
  byStatus: Record<JobStatus, number>;
  byType: { type: string; pending: number; running: number; retry: number; dead: number }[];
  /** Ready jobs waiting to be claimed. */
  ready: number;
  /** Seconds the oldest ready job has been waiting; 0 when none. */
  oldestReadyAgeSeconds: number;
  /** RUNNING jobs whose lease has expired (their worker probably died). */
  expiredLeases: number;
  succeededLast24h: number;
  deadLast24h: number;
  schedules: { name: string; cron: string; jobType: string; enabled: boolean; nextRunAt: string; lastRunAt: string | null }[];
}

const EMPTY_STATUS: Record<JobStatus, number> = { PENDING: 0, RUNNING: 0, RETRY: 0, SUCCEEDED: 0, DEAD: 0, CANCELLED: 0 };

/** Queue health for dashboards and alerting. Cheap: grouped counts on indexed columns. */
export async function getQueueStats(now: Date = new Date()): Promise<QueueStats> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const readyWhere: Prisma.JobWhereInput = { status: { in: ["PENDING", "RETRY"] }, runAt: { lte: now } };
  const [byStatus, byType, ready, oldest, expiredLeases, succeededLast24h, deadLast24h, schedules] = await Promise.all([
    db.job.groupBy({ by: ["status"], _count: { _all: true } }),
    db.job.groupBy({ by: ["type", "status"], where: { status: { in: ["PENDING", "RUNNING", "RETRY", "DEAD"] } }, _count: { _all: true } }),
    db.job.count({ where: readyWhere }),
    db.job.findFirst({ where: readyWhere, orderBy: { runAt: "asc" }, select: { runAt: true } }),
    db.job.count({ where: { status: "RUNNING", lockedUntil: { lt: now } } }),
    db.job.count({ where: { status: "SUCCEEDED", completedAt: { gte: dayAgo } } }),
    db.job.count({ where: { status: "DEAD", completedAt: { gte: dayAgo } } }),
    db.jobSchedule.findMany({ orderBy: { name: "asc" } }),
  ]);

  const statusCounts = { ...EMPTY_STATUS };
  for (const row of byStatus) statusCounts[row.status] = row._count._all;

  const types = new Map<string, QueueStats["byType"][number]>();
  for (const row of byType) {
    const entry = types.get(row.type) ?? { type: row.type, pending: 0, running: 0, retry: 0, dead: 0 };
    if (row.status === "PENDING") entry.pending = row._count._all;
    if (row.status === "RUNNING") entry.running = row._count._all;
    if (row.status === "RETRY") entry.retry = row._count._all;
    if (row.status === "DEAD") entry.dead = row._count._all;
    types.set(row.type, entry);
  }

  return {
    generatedAt: now.toISOString(),
    byStatus: statusCounts,
    byType: [...types.values()].sort((a, b) => a.type.localeCompare(b.type)),
    ready,
    oldestReadyAgeSeconds: oldest ? Math.max(0, Math.floor((now.getTime() - oldest.runAt.getTime()) / 1000)) : 0,
    expiredLeases,
    succeededLast24h,
    deadLast24h,
    schedules: schedules.map((s) => ({
      name: s.name,
      cron: s.cron,
      jobType: s.jobType,
      enabled: s.enabled,
      nextRunAt: s.nextRunAt.toISOString(),
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
    })),
  };
}

/** Deletes finished jobs past the retention window. Dead jobs are kept for operators. */
export async function purgeFinishedJobs(retentionDays: number, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db.job.deleteMany({ where: { status: { in: ["SUCCEEDED", "CANCELLED"] }, completedAt: { lt: cutoff } } });
  return deleted.count;
}
