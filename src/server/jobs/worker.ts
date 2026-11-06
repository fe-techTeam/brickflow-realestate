import "server-only";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { readQueueConfig, type QueueConfig } from "./config";
import { claimJobs, completeJob, failJob, releaseJob, renewLease } from "./queue";
import { getJobHandler, PermanentJobError, type JobRecord } from "./registry";
import { runDueSchedules } from "./schedules";

type Level = "info" | "warn" | "error";
export type WorkerLogger = (level: Level, message: string, fields?: Record<string, unknown>) => void;

export const consoleLogger: WorkerLogger = (level, message, fields) => {
  const line = JSON.stringify({ time: new Date().toISOString(), level, component: "worker", message, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

export interface WorkerOptions extends Partial<QueueConfig> {
  id?: string;
  now?: () => Date;
  logger?: WorkerLogger;
  /** Run recurring schedules from this worker's loop (on by default). */
  runSchedules?: boolean;
  /** Called on every loop iteration; used for a liveness file the container healthcheck reads. */
  heartbeat?: () => void;
  /** Only claim these job types (a dedicated worker); all types when omitted. */
  types?: readonly string[];
}

class ShutdownSignal extends Error {
  constructor() {
    super("Worker is shutting down");
    this.name = "ShutdownSignal";
  }
}

class LeaseLost extends Error {
  constructor() {
    super("Job lease was lost to another worker");
    this.name = "LeaseLost";
  }
}

class HandlerTimeout extends Error {
  constructor(ms: number) {
    super(`Handler exceeded ${ms} ms`);
    this.name = "HandlerTimeout";
  }
}

interface InFlight {
  promise: Promise<void>;
  controller: AbortController;
}

/** Polls the job table, runs handlers with bounded concurrency, and keeps leases alive while they run. */
export class JobWorker {
  readonly id: string;
  private readonly config: QueueConfig;
  private readonly now: () => Date;
  private readonly log: WorkerLogger;
  private readonly runSchedules: boolean;
  private readonly heartbeat?: () => void;
  private readonly types?: readonly string[];
  private readonly inFlight = new Map<string, InFlight>();
  private stopping = false;
  private wake: (() => void) | null = null;
  private loop: Promise<void> | null = null;
  private lastScheduleCheck = 0;

  constructor(options: WorkerOptions = {}) {
    const { id, now, logger, runSchedules, heartbeat, types, ...overrides } = options;
    this.config = { ...readQueueConfig(), ...overrides };
    this.id = id ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.now = now ?? (() => new Date());
    this.log = logger ?? consoleLogger;
    this.runSchedules = runSchedules ?? true;
    this.heartbeat = heartbeat;
    this.types = types;
  }

  get activeJobs(): number {
    return this.inFlight.size;
  }

  start(): Promise<void> {
    if (this.loop) return this.loop;
    this.log("info", "Worker started", { workerId: this.id, concurrency: this.config.concurrency, leaseMs: this.config.leaseMs });
    this.loop = this.run();
    return this.loop;
  }

  private async run(): Promise<void> {
    let consecutiveErrors = 0;
    while (!this.stopping) {
      try {
        this.heartbeat?.();
        await this.maybeRunSchedules();
        const claimed = await this.tick();
        consecutiveErrors = 0;
        if (claimed === 0 || this.inFlight.size >= this.config.concurrency) await this.sleep(this.config.pollIntervalMs);
      } catch (error) {
        consecutiveErrors += 1;
        this.log("error", "Worker loop error", { workerId: this.id, error: error instanceof Error ? error.message : String(error) });
        await this.sleep(Math.min(this.config.pollIntervalMs * 2 ** Math.min(consecutiveErrors, 6), 60_000));
      }
    }
  }

  private async maybeRunSchedules(): Promise<void> {
    if (!this.runSchedules) return;
    const now = this.now();
    if (now.getTime() - this.lastScheduleCheck < this.config.schedulerIntervalMs) return;
    this.lastScheduleCheck = now.getTime();
    const enqueued = await runDueSchedules(now);
    for (const name of enqueued) this.log("info", "Scheduled job enqueued", { workerId: this.id, schedule: name });
  }

  /** Claims as many jobs as there are free slots and starts them. Returns the number claimed. */
  async tick(): Promise<number> {
    const free = this.config.concurrency - this.inFlight.size;
    if (free <= 0 || this.stopping) return 0;
    const jobs = await claimJobs(this.id, free, this.config.leaseMs, this.now(), this.types);
    for (const job of jobs) {
      const controller = new AbortController();
      const promise = this.execute(job, controller).finally(() => {
        this.inFlight.delete(job.id);
        this.wake?.();
      });
      this.inFlight.set(job.id, { promise, controller });
    }
    return jobs.length;
  }

  /** Processes runnable jobs until none are left. Intended for tests and one-off scripts. */
  async drain(maxRounds = 1000): Promise<void> {
    for (let round = 0; round < maxRounds; round++) {
      const claimed = await this.tick();
      if (claimed === 0 && this.inFlight.size === 0) return;
      await Promise.allSettled([...this.inFlight.values()].map((f) => f.promise));
    }
    throw new Error("drain() did not settle");
  }

  private async execute(job: JobRecord, controller: AbortController): Promise<void> {
    const started = Date.now();
    const fields = { workerId: this.id, jobId: job.id, type: job.type, attempt: job.attempts };

    if (job.attempts > job.maxAttempts) {
      await failJob(job, this.id, new Error("Lease expired during the final attempt"), { permanent: true, now: this.now(), config: this.config });
      this.log("error", "Job dead-lettered after its lease expired on the final attempt", fields);
      return;
    }

    const registration = getJobHandler(job.type);
    if (!registration) {
      const outcome = await failJob(job, this.id, new Error(`No handler registered for job type "${job.type}"`), { now: this.now(), config: this.config });
      this.log("error", "No handler for job type", { ...fields, outcome: outcome?.status });
      return;
    }

    let payload: unknown = job.payload;
    if (registration.schema) {
      const parsed = registration.schema.safeParse(job.payload);
      if (!parsed.success) {
        await failJob(job, this.id, new PermanentJobError(`Invalid payload: ${parsed.error.message}`), { permanent: true, now: this.now(), config: this.config });
        this.log("error", "Job payload failed validation", fields);
        return;
      }
      payload = parsed.data;
    }

    const renewEvery = Math.max(1_000, Math.floor(this.config.leaseMs / 3));
    const renewal = setInterval(() => {
      renewLease(job.id, this.id, this.config.leaseMs, this.now())
        .then((owned) => {
          if (!owned) controller.abort(new LeaseLost());
        })
        .catch((error: unknown) => this.log("warn", "Lease renewal failed", { ...fields, error: error instanceof Error ? error.message : String(error) }));
    }, renewEvery);
    const timeout = setTimeout(() => controller.abort(new HandlerTimeout(this.config.handlerTimeoutMs)), this.config.handlerTimeoutMs);

    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    });
    aborted.catch(() => undefined);

    try {
      await Promise.race([
        registration.handler(payload, {
          job,
          attempt: job.attempts,
          isFinalAttempt: job.attempts >= job.maxAttempts,
          signal: controller.signal,
          now: this.now,
        }),
        aborted,
      ]);
      clearInterval(renewal);
      clearTimeout(timeout);
      const owned = await completeJob(job.id, this.id, this.now());
      if (owned) this.log("info", "Job succeeded", { ...fields, durationMs: Date.now() - started });
      else this.log("warn", "Job finished after its lease was lost; result not recorded", fields);
    } catch (error) {
      clearInterval(renewal);
      clearTimeout(timeout);
      if (error instanceof ShutdownSignal) {
        await releaseJob(job.id, this.id, this.now());
        this.log("warn", "Job released on shutdown", fields);
        return;
      }
      if (error instanceof LeaseLost) {
        this.log("warn", "Job abandoned: lease lost", fields);
        return;
      }
      const outcome = await failJob(job, this.id, error, { permanent: error instanceof PermanentJobError, now: this.now(), config: this.config });
      this.log(outcome?.status === "DEAD" ? "error" : "warn", outcome?.status === "DEAD" ? "Job dead-lettered" : "Job failed; retry scheduled", {
        ...fields,
        error: error instanceof Error ? error.message : String(error),
        retryAt: outcome?.runAt?.toISOString(),
        durationMs: Date.now() - started,
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (this.wake === done) this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }

  /**
   * Graceful shutdown: stop claiming, let in-flight jobs finish within the shutdown timeout, then
   * abort the rest and hand them back to the queue without consuming an attempt.
   */
  async stop(): Promise<void> {
    if (this.stopping) return this.loop ?? undefined;
    this.stopping = true;
    this.wake?.();
    this.log("info", "Worker stopping", { workerId: this.id, inFlight: this.inFlight.size });
    const pending = [...this.inFlight.values()].map((f) => f.promise);
    if (pending.length > 0) {
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), this.config.shutdownTimeoutMs);
      });
      const result = await Promise.race([Promise.allSettled(pending).then(() => "done" as const), timedOut]);
      clearTimeout(timer);
      if (result === "timeout") {
        for (const flight of this.inFlight.values()) flight.controller.abort(new ShutdownSignal());
        await Promise.allSettled([...this.inFlight.values()].map((f) => f.promise));
      }
    }
    await this.loop;
    this.log("info", "Worker stopped", { workerId: this.id });
  }
}
