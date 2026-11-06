import "server-only";
import { isDeepStrictEqual } from "node:util";
import { db } from "../db";
import { IST_OFFSET_MINUTES, nextCronTime, parseCron } from "./cron";
import { enqueueJob, toJsonPayload } from "./queue";

export interface ScheduleDefinition {
  name: string;
  /** Five-field cron expression, evaluated at `utcOffsetMinutes` (IST by default). */
  cron: string;
  utcOffsetMinutes?: number;
  jobType: string;
  payload?: Record<string, unknown>;
}

const definitions = new Map<string, ScheduleDefinition>();

/** Declares a recurring job. Takes effect when a worker calls `syncSchedules()` on start. */
export function defineSchedule(definition: ScheduleDefinition): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(definition.name)) throw new Error(`Invalid schedule name "${definition.name}"`);
  parseCron(definition.cron);
  definitions.set(definition.name, definition);
}

export function definedSchedules(): ScheduleDefinition[] {
  return [...definitions.values()];
}

/**
 * Upserts schedule rows from their definitions. A changed expression, offset, job type or payload
 * recomputes the next run; the operator-controlled `enabled` flag is left untouched.
 */
export async function syncSchedules(schedules: ScheduleDefinition[] = definedSchedules(), now: Date = new Date()): Promise<void> {
  for (const def of schedules) {
    const offset = def.utcOffsetMinutes ?? IST_OFFSET_MINUTES;
    const payload = toJsonPayload(def.payload ?? {});
    const existing = await db.jobSchedule.findUnique({ where: { name: def.name } });
    if (!existing) {
      await db.jobSchedule.createMany({
        data: [{ name: def.name, cron: def.cron, utcOffsetMinutes: offset, jobType: def.jobType, payload, nextRunAt: nextCronTime(def.cron, now, offset) }],
        skipDuplicates: true,
      });
      continue;
    }
    const changed =
      existing.cron !== def.cron || existing.utcOffsetMinutes !== offset || existing.jobType !== def.jobType || !isDeepStrictEqual(existing.payload, payload);
    if (changed) {
      await db.jobSchedule.update({
        where: { name: def.name },
        data: { cron: def.cron, utcOffsetMinutes: offset, jobType: def.jobType, payload, nextRunAt: nextCronTime(def.cron, now, offset) },
      });
    }
  }
}

interface DueSchedule {
  name: string;
  cron: string;
  utcOffsetMinutes: number;
  jobType: string;
  payload: Record<string, unknown>;
  nextRunAt: Date;
}

/**
 * Enqueues one job for every schedule whose period has arrived and advances it past `now`.
 * The row lock serialises workers, and the period-named idempotency key makes a second enqueue for
 * the same period a no-op even if two workers ever raced. Missed periods (worker down) collapse
 * into a single catch-up run.
 */
export async function runDueSchedules(now: Date = new Date()): Promise<string[]> {
  return db.$transaction(async (tx) => {
    const due = await tx.$queryRaw<DueSchedule[]>`
      SELECT "name", "cron", "utcOffsetMinutes", "jobType", "payload", "nextRunAt"
        FROM "JobSchedule"
       WHERE "enabled" = true AND "nextRunAt" <= ${now}
       ORDER BY "nextRunAt" ASC
       FOR UPDATE SKIP LOCKED`;
    const enqueued: string[] = [];
    for (const schedule of due) {
      const period = new Date(schedule.nextRunAt).toISOString();
      const job = await enqueueJob(tx, {
        type: schedule.jobType,
        payload: { ...(schedule.payload ?? {}), schedule: schedule.name, scheduledFor: period },
        idempotencyKey: `schedule:${schedule.name}:${period}`,
      });
      await tx.jobSchedule.update({
        where: { name: schedule.name },
        data: { nextRunAt: nextCronTime(schedule.cron, now, Number(schedule.utcOffsetMinutes)), lastRunAt: now, lastJobId: job.id },
      });
      enqueued.push(schedule.name);
    }
    return enqueued;
  });
}
