import type { ZodType } from "zod";

export interface JobRecord {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  createdAt: Date;
  idempotencyKey: string | null;
}

export interface JobContext {
  job: JobRecord;
  /** 1-based attempt number of this run. */
  attempt: number;
  /** True when this run is the last one before the job is dead-lettered. */
  isFinalAttempt: boolean;
  /** Aborted on shutdown, on handler timeout and when the lease is lost to another worker. */
  signal: AbortSignal;
  now: () => Date;
}

export type JobHandler<P = unknown> = (payload: P, context: JobContext) => Promise<void>;

interface Registration {
  handler: JobHandler<unknown>;
  schema?: ZodType;
}

/** Thrown by a handler for failures that retrying cannot fix; the job is dead-lettered at once. */
export class PermanentJobError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PermanentJobError";
  }
}

const handlers = new Map<string, Registration>();

/**
 * Registers the handler for a job type. Handlers must be idempotent: a job can run more than once
 * when a worker dies after doing the work but before recording success. When `schema` is given the
 * payload is validated first and an invalid payload dead-letters the job.
 */
export function registerJobHandler<P>(type: string, handler: JobHandler<P>, options: { schema?: ZodType<P> } = {}): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(type)) throw new Error(`Invalid job type "${type}"`);
  if (handlers.has(type)) throw new Error(`A handler for job type "${type}" is already registered`);
  handlers.set(type, { handler: handler as JobHandler<unknown>, schema: options.schema });
}

export function getJobHandler(type: string): Registration | undefined {
  return handlers.get(type);
}

export function registeredJobTypes(): string[] {
  return [...handlers.keys()].sort();
}

/** Test helper: removes a registration so a suite can register its own handler. */
export function unregisterJobHandler(type: string): void {
  handlers.delete(type);
}
