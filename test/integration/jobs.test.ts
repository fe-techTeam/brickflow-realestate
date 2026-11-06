import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "@/server/db";
import { readQueueConfig } from "@/server/jobs/config";
import { claimJobs, completeJob, enqueueJob, failJob, getQueueStats, purgeFinishedJobs, releaseJob, renewLease, requeueJob, cancelJob } from "@/server/jobs/queue";
import { PermanentJobError, registerJobHandler, unregisterJobHandler, type JobContext } from "@/server/jobs/registry";
import { runDueSchedules, syncSchedules } from "@/server/jobs/schedules";
import { JobWorker } from "@/server/jobs/worker";

const quiet = () => undefined;
const T = (name: string) => `test.${name}`;
const registered: string[] = [];

function handle<P>(type: string, handler: (payload: P, ctx: JobContext) => Promise<void>, schema?: z.ZodType<P>) {
  unregisterJobHandler(type);
  registerJobHandler(type, handler, { schema });
  registered.push(type);
}

function worker(types: string[], options: ConstructorParameters<typeof JobWorker>[0] = {}) {
  return new JobWorker({ types, logger: quiet, runSchedules: false, backoffBaseMs: 1000, backoffMaxMs: 60_000, ...options });
}

beforeEach(async () => {
  await db.job.deleteMany({ where: { type: { startsWith: "test." } } });
});

afterAll(async () => {
  for (const type of registered) unregisterJobHandler(type);
  await db.job.deleteMany({ where: { type: { startsWith: "test." } } });
  await db.jobSchedule.deleteMany({ where: { name: { startsWith: "test-" } } });
});

describe("enqueueJob (transactional outbox)", () => {
  it("writes the job only when the surrounding transaction commits", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await enqueueJob(tx, { type: T("outbox"), payload: { n: 1 } });
        throw new Error("business rule failed");
      }),
    ).rejects.toThrow("business rule failed");
    expect(await db.job.count({ where: { type: T("outbox") } })).toBe(0);

    await db.$transaction((tx) => enqueueJob(tx, { type: T("outbox"), payload: { n: 2, amount: 50_000_00n } }));
    const job = await db.job.findFirstOrThrow({ where: { type: T("outbox") } });
    expect(job).toMatchObject({ status: "PENDING", attempts: 0, maxAttempts: 8, payload: { n: 2, amount: "5000000" } });
  });

  it("is idempotent per key without aborting the caller's transaction", async () => {
    const key = `idem-${randomUUID()}`;
    const [first, second] = await db.$transaction(async (tx) => {
      const a = await enqueueJob(tx, { type: T("idem"), payload: {}, idempotencyKey: key });
      const b = await enqueueJob(tx, { type: T("idem"), payload: { other: true }, idempotencyKey: key });
      // The transaction is still usable after the duplicate.
      await tx.job.count();
      return [a, b];
    });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    const third = await enqueueJob(db, { type: T("idem"), payload: {}, idempotencyKey: key });
    expect(third).toEqual({ id: first.id, created: false });
    expect(await db.job.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it("validates its input", async () => {
    await expect(enqueueJob(db, { type: T("bad"), payload: [1, 2] })).rejects.toThrow(/JSON object/);
    await expect(enqueueJob(db, { type: T("bad"), payload: {}, maxAttempts: 0 })).rejects.toThrow(/maxAttempts/);
    await expect(enqueueJob(db, { type: T("bad"), payload: {}, idempotencyKey: "" })).rejects.toThrow(/Idempotency key/);
  });
});

describe("claiming", () => {
  it("never hands the same job to two concurrent claimers (FOR UPDATE SKIP LOCKED)", async () => {
    for (let i = 0; i < 20; i++) await enqueueJob(db, { type: T("race"), payload: { i } });
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => claimJobs(`w${i}`, 6, 60_000, new Date(), [T("race")])));
    const ids = results.flat().map((j) => j.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(await db.job.count({ where: { type: T("race"), status: "RUNNING", attempts: 1 } })).toBe(20);
  });

  it("respects runAt and the type filter", async () => {
    const now = new Date();
    await enqueueJob(db, { type: T("later"), payload: {}, runAt: new Date(now.getTime() + 60_000) });
    await enqueueJob(db, { type: T("other"), payload: {} });
    expect(await claimJobs("w", 10, 60_000, now, [T("later")])).toHaveLength(0);
    expect(await claimJobs("w", 10, 60_000, new Date(now.getTime() + 61_000), [T("later")])).toHaveLength(1);
    expect(await claimJobs("w", 10, 60_000, now, [])).toHaveLength(0);
  });

  it("reclaims a job whose lease expired (visibility timeout) and fences the old owner", async () => {
    const { id } = await enqueueJob(db, { type: T("lease"), payload: {} });
    const t0 = new Date();
    const [claimed] = await claimJobs("dead-worker", 1, 5_000, t0, [T("lease")]);
    expect(claimed!.id).toBe(id);
    expect(await claimJobs("other", 1, 5_000, new Date(t0.getTime() + 4_000), [T("lease")])).toHaveLength(0);
    expect(await renewLease(id, "dead-worker", 5_000, new Date(t0.getTime() + 4_000))).toBe(true);
    expect(await claimJobs("other", 1, 5_000, new Date(t0.getTime() + 8_000), [T("lease")])).toHaveLength(0);

    const [reclaimed] = await claimJobs("other", 1, 5_000, new Date(t0.getTime() + 10_000), [T("lease")]);
    expect(reclaimed).toMatchObject({ id, attempts: 2 });
    // The original worker can no longer renew, complete or fail it.
    expect(await renewLease(id, "dead-worker", 5_000)).toBe(false);
    expect(await completeJob(id, "dead-worker")).toBe(false);
    expect(await failJob(reclaimed!, "dead-worker", new Error("late"))).toBeNull();
    expect(await completeJob(id, "other")).toBe(true);
  });

  it("releases a job without consuming the attempt", async () => {
    const { id } = await enqueueJob(db, { type: T("release"), payload: {} });
    await claimJobs("w", 1, 60_000, new Date(), [T("release")]);
    expect(await releaseJob(id, "w")).toBe(true);
    expect(await db.job.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PENDING", attempts: 0, lockedBy: null });
  });
});

describe("failure handling", () => {
  it("retries with exponential backoff and jitter, then dead-letters after max attempts", async () => {
    const { id } = await enqueueJob(db, { type: T("flaky"), payload: {}, maxAttempts: 3 });
    const config = { ...readQueueConfig({}), backoffBaseMs: 1000, backoffMaxMs: 60_000 };
    let now = new Date();
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const [job] = await claimJobs("w", 1, 60_000, now, [T("flaky")]);
      expect(job!.attempts).toBe(attempt);
      const outcome = await failJob(job!, "w", new Error(`boom ${attempt}`), { now, config, random: () => 1 });
      if (attempt < 3) {
        expect(outcome?.status).toBe("RETRY");
        delays.push(outcome!.runAt!.getTime() - now.getTime());
        now = outcome!.runAt!;
      } else {
        expect(outcome).toEqual({ status: "DEAD" });
      }
    }
    expect(delays).toEqual([1000, 2000]);
    expect(await db.job.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DEAD", attempts: 3, lastError: "Error: boom 3" });
  });

  it("dead-letters immediately on a permanent error", async () => {
    const [job] = await (async () => {
      await enqueueJob(db, { type: T("perm"), payload: {} });
      return claimJobs("w", 1, 60_000, new Date(), [T("perm")]);
    })();
    expect(await failJob(job!, "w", new PermanentJobError("bad data"), { permanent: true })).toEqual({ status: "DEAD" });
  });

  it("operators can retry dead jobs with fresh attempts and cancel queued ones", async () => {
    const { id } = await enqueueJob(db, { type: T("ops"), payload: {}, maxAttempts: 1 });
    const [job] = await claimJobs("w", 1, 60_000, new Date(), [T("ops")]);
    await failJob(job!, "w", new Error("x"));
    expect(await requeueJob(db, id)).toBe(true);
    expect(await db.job.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PENDING", attempts: 0, completedAt: null });
    expect(await requeueJob(db, id)).toBe(false);
    expect(await cancelJob(db, id)).toBe(true);
    expect(await cancelJob(db, id)).toBe(false);
    expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
  });
});

describe("JobWorker", () => {
  it("runs handlers with validated payloads and records success", async () => {
    const seen: number[] = [];
    handle<{ n: number }>(T("ok"), async (payload, ctx) => {
      expect(ctx.attempt).toBe(1);
      seen.push(payload.n);
    }, z.object({ n: z.number() }));
    for (let n = 1; n <= 6; n++) await enqueueJob(db, { type: T("ok"), payload: { n } });
    await worker([T("ok")], { concurrency: 3 }).drain();
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await db.job.count({ where: { type: T("ok"), status: "SUCCEEDED" } })).toBe(6);
  });

  it("dead-letters an invalid payload without calling the handler", async () => {
    let called = false;
    handle<{ n: number }>(T("schema"), async () => {
      called = true;
    }, z.object({ n: z.number() }));
    const { id } = await enqueueJob(db, { type: T("schema"), payload: { n: "nope" } });
    await worker([T("schema")]).drain();
    expect(called).toBe(false);
    expect(await db.job.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DEAD" });
  });

  it("schedules a retry when a handler throws and when no handler is registered", async () => {
    handle(T("throws"), async () => {
      throw new Error("downstream unavailable");
    });
    const a = await enqueueJob(db, { type: T("throws"), payload: {} });
    const b = await enqueueJob(db, { type: T("unregistered"), payload: {} });
    const before = Date.now();
    await worker([T("throws"), T("unregistered")]).drain();
    const [ja, jb] = await Promise.all([db.job.findUniqueOrThrow({ where: { id: a.id } }), db.job.findUniqueOrThrow({ where: { id: b.id } })]);
    expect(ja).toMatchObject({ status: "RETRY", attempts: 1, lastError: "Error: downstream unavailable" });
    expect(ja.runAt.getTime()).toBeGreaterThanOrEqual(before + 500);
    expect(jb).toMatchObject({ status: "RETRY" });
    expect(jb.lastError).toMatch(/No handler registered/);
  });

  it("fails a handler that exceeds its timeout", async () => {
    handle(T("slow"), () => new Promise((resolve) => setTimeout(resolve, 5_000)));
    const { id } = await enqueueJob(db, { type: T("slow"), payload: {} });
    await worker([T("slow")], { handlerTimeoutMs: 1000 }).drain();
    const job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("RETRY");
    expect(job.lastError).toMatch(/HandlerTimeout/);
  });

  it("renews the lease while a long handler runs", async () => {
    let lockedUntilDuring: Date | null = null;
    handle(T("long"), async (_p, ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 2_600));
      lockedUntilDuring = (await db.job.findUniqueOrThrow({ where: { id: ctx.job.id } })).lockedUntil;
    });
    const { id } = await enqueueJob(db, { type: T("long"), payload: {} });
    const started = Date.now();
    await worker([T("long")], { leaseMs: 5_000 }).drain();
    expect(lockedUntilDuring!.getTime()).toBeGreaterThan(started + 5_000);
    expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe("SUCCEEDED");
  });

  it("shuts down gracefully: finishes quick jobs, hands back the rest without using an attempt", async () => {
    handle(T("quick"), () => new Promise((resolve) => setTimeout(resolve, 100)));
    handle(T("stuck"), (_p, ctx) => new Promise((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason))));
    const quick = await enqueueJob(db, { type: T("quick"), payload: {} });
    const stuck = await enqueueJob(db, { type: T("stuck"), payload: {} });
    const w = worker([T("quick"), T("stuck")], { shutdownTimeoutMs: 1_000, pollIntervalMs: 50 });
    void w.start();
    for (let i = 0; i < 100 && w.activeJobs < 2; i++) await new Promise((r) => setTimeout(r, 20));
    await w.stop();
    expect((await db.job.findUniqueOrThrow({ where: { id: quick.id } })).status).toBe("SUCCEEDED");
    expect(await db.job.findUniqueOrThrow({ where: { id: stuck.id } })).toMatchObject({ status: "PENDING", attempts: 0, lockedBy: null });
  });

  it("dead-letters a job reclaimed after its lease expired on the final attempt", async () => {
    let called = false;
    handle(T("final"), async () => {
      called = true;
    });
    const { id } = await enqueueJob(db, { type: T("final"), payload: {}, maxAttempts: 1, runAt: new Date(Date.now() - 120_000) });
    expect(await claimJobs("crashed", 1, 5_000, new Date(Date.now() - 60_000), [T("final")])).toHaveLength(1);
    await worker([T("final")]).drain();
    expect(called).toBe(false);
    expect(await db.job.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DEAD" });
  });
});

describe("recurring schedules", () => {
  it("runs each period exactly once across concurrent workers and catches up once after downtime", async () => {
    const name = `test-${randomUUID().slice(0, 8)}`;
    const t0 = new Date("2026-11-06T00:00:00.000Z");
    await syncSchedules([{ name, cron: "0 9 * * *", jobType: T("daily"), payload: { kind: "daily" } }], t0);
    const schedule = await db.jobSchedule.findUniqueOrThrow({ where: { name } });
    expect(schedule.nextRunAt.toISOString()).toBe("2026-11-06T03:30:00.000Z");

    expect(await runDueSchedules(new Date("2026-11-06T03:29:00.000Z"))).not.toContain(name);

    const at = new Date("2026-11-06T03:30:05.000Z");
    const results = await Promise.all(Array.from({ length: 6 }, () => runDueSchedules(at)));
    expect(results.filter((r) => r.includes(name))).toHaveLength(1);
    const jobs = await db.job.findMany({ where: { type: T("daily") } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toMatchObject({ kind: "daily", schedule: name, scheduledFor: "2026-11-06T03:30:00.000Z" });
    expect(jobs[0]!.idempotencyKey).toBe(`schedule:${name}:2026-11-06T03:30:00.000Z`);
    expect((await db.jobSchedule.findUniqueOrThrow({ where: { name } })).nextRunAt.toISOString()).toBe("2026-11-07T03:30:00.000Z");

    // Three days of downtime collapse into one catch-up run.
    await runDueSchedules(new Date("2026-11-10T05:00:00.000Z"));
    expect(await db.job.count({ where: { type: T("daily") } })).toBe(2);
    expect((await db.jobSchedule.findUniqueOrThrow({ where: { name } })).nextRunAt.toISOString()).toBe("2026-11-11T03:30:00.000Z");
  });

  it("re-syncing recomputes the next run only when the definition changes, and keeps the enabled flag", async () => {
    const name = `test-${randomUUID().slice(0, 8)}`;
    await syncSchedules([{ name, cron: "0 9 * * *", jobType: T("x") }], new Date("2026-11-06T00:00:00.000Z"));
    await db.jobSchedule.update({ where: { name }, data: { enabled: false } });
    await syncSchedules([{ name, cron: "0 9 * * *", jobType: T("x") }], new Date("2026-11-08T00:00:00.000Z"));
    expect(await db.jobSchedule.findUniqueOrThrow({ where: { name } })).toMatchObject({ enabled: false, nextRunAt: new Date("2026-11-06T03:30:00.000Z") });
    await syncSchedules([{ name, cron: "0 18 * * *", jobType: T("x") }], new Date("2026-11-08T00:00:00.000Z"));
    expect(await db.jobSchedule.findUniqueOrThrow({ where: { name } })).toMatchObject({ enabled: false, nextRunAt: new Date("2026-11-08T12:30:00.000Z") });
    expect(await runDueSchedules(new Date("2026-11-09T00:00:00.000Z"))).not.toContain(name);
  });
});

describe("metrics and maintenance", () => {
  it("reports queue statistics", async () => {
    const now = new Date();
    await enqueueJob(db, { type: T("stats"), payload: {}, runAt: new Date(now.getTime() - 90_000) });
    await enqueueJob(db, { type: T("stats"), payload: {}, runAt: new Date(now.getTime() + 90_000) });
    const stats = await getQueueStats(now);
    expect(stats.byStatus.PENDING).toBeGreaterThanOrEqual(2);
    expect(stats.ready).toBeGreaterThanOrEqual(1);
    expect(stats.oldestReadyAgeSeconds).toBeGreaterThanOrEqual(89);
    expect(stats.byType.find((t) => t.type === T("stats"))).toMatchObject({ pending: 2, running: 0 });
  });

  it("purges finished jobs past retention but keeps dead letters", async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ids = await Promise.all(["SUCCEEDED", "CANCELLED", "DEAD"].map((status) => db.job.create({ data: { type: T("purge"), payload: {}, status: status as "DEAD", completedAt: old } })));
    await purgeFinishedJobs(14);
    const left = await db.job.findMany({ where: { id: { in: ids.map((j) => j.id) } } });
    expect(left.map((j) => j.status)).toEqual(["DEAD"]);
  });
});
