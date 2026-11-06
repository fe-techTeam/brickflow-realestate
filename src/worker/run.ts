import { writeFileSync } from "node:fs";
import { db } from "@/server/db";
import { readQueueConfig } from "@/server/jobs/config";
import { registerAllJobHandlers } from "@/server/jobs/handlers";
import { registeredJobTypes } from "@/server/jobs/registry";
import { definedSchedules, syncSchedules } from "@/server/jobs/schedules";
import { consoleLogger, JobWorker } from "@/server/jobs/worker";
import { getEmailProvider, readEmailConfig } from "@/server/notifications/email/providers";
import { readWhatsappConfig } from "@/server/notifications/whatsapp/providers";

/** Validates configuration, registers handlers and schedules, and runs until SIGTERM/SIGINT. */
export async function runWorker(): Promise<void> {
  // Fail fast on misconfiguration instead of failing every job later.
  const queue = readQueueConfig();
  const email = readEmailConfig();
  const whatsapp = readWhatsappConfig();
  getEmailProvider();

  registerAllJobHandlers();
  await syncSchedules(definedSchedules());

  const heartbeatFile = process.env.WORKER_HEARTBEAT_FILE?.trim();
  const types = process.env.WORKER_JOB_TYPES?.split(",").map((t) => t.trim()).filter(Boolean);
  const worker = new JobWorker({
    ...queue,
    types: types?.length ? types : undefined,
    heartbeat: heartbeatFile
      ? () => {
          try {
            writeFileSync(heartbeatFile, new Date().toISOString());
          } catch {
            // A read-only or missing directory only disables the liveness signal.
          }
        }
      : undefined,
  });
  consoleLogger("info", "Worker configuration", {
    workerId: worker.id,
    handlers: registeredJobTypes(),
    schedules: definedSchedules().map((s) => `${s.name} (${s.cron})`),
    emailProvider: email.provider,
    whatsappProvider: whatsapp.provider,
  });

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    consoleLogger("info", "Shutdown requested", { signal });
    worker
      .stop()
      .then(() => {
        getEmailProvider().close();
        return db.$disconnect();
      })
      .then(
        () => process.exit(0),
        (error: unknown) => {
          consoleLogger("error", "Shutdown failed", { error: error instanceof Error ? error.message : String(error) });
          process.exit(1);
        },
      );
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await worker.start();
}
