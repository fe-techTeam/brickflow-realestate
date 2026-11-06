/** Worker and queue tuning, read from the environment with safe bounds. */

function intFromEnv(name: string, fallback: number, min: number, max: number, env: Readonly<Record<string, string | undefined>>): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
  }
  return value;
}

export interface QueueConfig {
  /** Jobs processed concurrently by one worker process. */
  concurrency: number;
  /** Idle wait between claim attempts when the queue is empty. */
  pollIntervalMs: number;
  /** Visibility timeout: a claimed job becomes claimable again if its lease is not renewed in time. */
  leaseMs: number;
  /** How often recurring schedules are checked. */
  schedulerIntervalMs: number;
  /** Time allowed for in-flight jobs to finish after SIGTERM before they are released. */
  shutdownTimeoutMs: number;
  /** Upper bound for a single handler run; the job is failed (and retried) after this. */
  handlerTimeoutMs: number;
  defaultMaxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** Succeeded and cancelled jobs older than this are purged by the maintenance job. */
  retentionDays: number;
}

export function readQueueConfig(env: Readonly<Record<string, string | undefined>> = process.env): QueueConfig {
  const leaseMs = intFromEnv("WORKER_LEASE_MS", 60_000, 5_000, 3_600_000, env);
  return {
    concurrency: intFromEnv("WORKER_CONCURRENCY", 4, 1, 64, env),
    pollIntervalMs: intFromEnv("WORKER_POLL_INTERVAL_MS", 1_000, 50, 60_000, env),
    leaseMs,
    schedulerIntervalMs: intFromEnv("WORKER_SCHEDULER_INTERVAL_MS", 30_000, 1_000, 3_600_000, env),
    shutdownTimeoutMs: intFromEnv("WORKER_SHUTDOWN_TIMEOUT_MS", 25_000, 0, 600_000, env),
    handlerTimeoutMs: intFromEnv("WORKER_HANDLER_TIMEOUT_MS", 300_000, 1_000, 86_400_000, env),
    defaultMaxAttempts: intFromEnv("JOB_MAX_ATTEMPTS", 8, 1, 100, env),
    backoffBaseMs: intFromEnv("JOB_BACKOFF_BASE_MS", 5_000, 100, 86_400_000, env),
    backoffMaxMs: intFromEnv("JOB_BACKOFF_MAX_MS", 3_600_000, 1_000, 7 * 86_400_000, env),
    retentionDays: intFromEnv("JOB_RETENTION_DAYS", 14, 1, 3650, env),
  };
}

/**
 * Exponential backoff with "equal jitter": half of the capped exponential delay is fixed, the other
 * half random, so retries spread out without ever collapsing to zero.
 */
export function backoffDelayMs(attempt: number, baseMs: number, maxMs: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, attempt - 1);
  const capped = Math.min(maxMs, baseMs * 2 ** Math.min(exponent, 30));
  const half = capped / 2;
  return Math.round(half + random() * half);
}
