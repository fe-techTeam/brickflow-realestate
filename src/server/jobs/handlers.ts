import "server-only";
import { JOBS_MAINTENANCE_JOB } from "../notifications/constants";
import { registerNotificationJobs } from "../notifications/jobs";
import { readQueueConfig } from "./config";
import { purgeFinishedJobs } from "./queue";
import { registerJobHandler } from "./registry";
import { defineSchedule } from "./schedules";

let registered = false;

/**
 * The single place where job handlers and recurring schedules are registered for the worker.
 * Feature modules expose a `register…Jobs()` function and add one call here.
 */
export function registerAllJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerNotificationJobs();

  registerJobHandler(JOBS_MAINTENANCE_JOB, async (_payload, ctx) => {
    await purgeFinishedJobs(readQueueConfig().retentionDays, ctx.now());
  });
  defineSchedule({ name: "jobs-maintenance", cron: "30 3 * * *", jobType: JOBS_MAINTENANCE_JOB });
}
