"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../action-result";
import { requireActor } from "../auth/session";
import { cancelQueuedJob, retryJob } from "../services/jobs-admin";

export async function retryJobAction(jobId: string): Promise<ActionResult> {
  return runAction(async () => {
    await retryJob(await requireActor(), jobId);
    revalidatePath("/admin/jobs");
    return undefined;
  }, "Job re-queued. A worker will pick it up shortly.");
}

export async function cancelJobAction(jobId: string): Promise<ActionResult> {
  return runAction(async () => {
    await cancelQueuedJob(await requireActor(), jobId);
    revalidatePath("/admin/jobs");
    return undefined;
  }, "Job cancelled.");
}
