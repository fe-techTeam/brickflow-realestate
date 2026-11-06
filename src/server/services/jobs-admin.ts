import "server-only";
import type { JobStatus, NotificationDeliveryStatus, Prisma } from "@/generated/prisma/client";
import { recordAudit } from "../audit";
import { assertOrgType, type Actor } from "../auth/session";
import { db } from "../db";
import { conflict, forbidden, notFound } from "../errors";
import { cancelJob, getQueueStats, requeueJob } from "../jobs/queue";

function requireSuperAdmin(actor: Actor) {
  assertOrgType(actor, "PLATFORM");
  if (actor.role !== "SUPER_ADMIN") throw forbidden();
}

export async function getJobsOverview(actor: Actor) {
  requireSuperAdmin(actor);
  return getQueueStats();
}

export const JOB_LIST_STATUSES = ["RETRY", "DEAD", "PENDING", "RUNNING", "CANCELLED", "SUCCEEDED"] as const satisfies JobStatus[];

export async function listJobs(actor: Actor, filters: { status?: JobStatus; type?: string; take?: number } = {}) {
  requireSuperAdmin(actor);
  const where: Prisma.JobWhereInput = {
    status: filters.status ?? { in: ["RETRY", "DEAD"] },
    ...(filters.type ? { type: filters.type } : {}),
  };
  const take = Math.min(Math.max(filters.take ?? 50, 1), 200);
  const [rows, total] = await Promise.all([
    db.job.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take }),
    db.job.count({ where }),
  ]);
  return {
    total,
    jobs: rows.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      runAt: j.runAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
      createdAt: j.createdAt.toISOString(),
      lastError: j.lastError,
      idempotencyKey: j.idempotencyKey,
      payload: JSON.stringify(j.payload),
    })),
  };
}

export type JobListItem = Awaited<ReturnType<typeof listJobs>>["jobs"][number];

async function loadJob(jobId: string) {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) throw notFound("Job not found.");
  return job;
}

/** Re-queues a failed, dead or cancelled job to run now with a fresh set of attempts. */
export async function retryJob(actor: Actor, jobId: string) {
  requireSuperAdmin(actor);
  const job = await loadJob(jobId);
  await db.$transaction(async (tx) => {
    if (!(await requeueJob(tx, job.id))) throw conflict(`This job is ${job.status.toLowerCase()} and cannot be retried.`);
    await recordAudit(tx, actor, {
      action: "job.retried",
      entityType: "Job",
      entityId: job.id,
      summary: `Re-queued ${job.type} job (was ${job.status.toLowerCase()} after ${job.attempts} attempt${job.attempts === 1 ? "" : "s"})`,
      metadata: { type: job.type, previousStatus: job.status, attempts: job.attempts, lastError: job.lastError },
    });
  });
}

export async function cancelQueuedJob(actor: Actor, jobId: string) {
  requireSuperAdmin(actor);
  const job = await loadJob(jobId);
  await db.$transaction(async (tx) => {
    if (!(await cancelJob(tx, job.id))) throw conflict(`This job is ${job.status.toLowerCase()} and cannot be cancelled.`);
    await recordAudit(tx, actor, {
      action: "job.cancelled",
      entityType: "Job",
      entityId: job.id,
      summary: `Cancelled ${job.type} job (was ${job.status.toLowerCase()})`,
      metadata: { type: job.type, previousStatus: job.status, attempts: job.attempts },
    });
  });
}

export async function listDeliveries(actor: Actor, filters: { status?: NotificationDeliveryStatus; take?: number } = {}) {
  requireSuperAdmin(actor);
  const take = Math.min(Math.max(filters.take ?? 25, 1), 200);
  const where: Prisma.NotificationDeliveryWhereInput = filters.status ? { status: filters.status } : {};
  const [rows, counts] = await Promise.all([
    db.notificationDelivery.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      select: {
        id: true,
        channel: true,
        event: true,
        recipient: true,
        status: true,
        provider: true,
        providerMessageId: true,
        error: true,
        attempts: true,
        createdAt: true,
        sentAt: true,
      },
    }),
    db.notificationDelivery.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return {
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<NotificationDeliveryStatus, number>>,
    deliveries: rows.map((d) => ({
      ...d,
      recipient: maskRecipient(d.recipient),
      createdAt: d.createdAt.toISOString(),
      sentAt: d.sentAt?.toISOString() ?? null,
    })),
  };
}

/** The delivery log is an operations view; addresses are partially masked. */
export function maskRecipient(recipient: string): string {
  const at = recipient.indexOf("@");
  if (at > 0) {
    const local = recipient.slice(0, at);
    return `${local.slice(0, Math.min(2, local.length))}${"•".repeat(Math.max(1, Math.min(local.length - 2, 6)))}${recipient.slice(at)}`;
  }
  return recipient.length > 6 ? `${recipient.slice(0, 3)}${"•".repeat(recipient.length - 6)}${recipient.slice(-3)}` : "•••";
}

export type DeliveryListItem = Awaited<ReturnType<typeof listDeliveries>>["deliveries"][number];
