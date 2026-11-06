"use client";

import { Ban, RotateCcw } from "lucide-react";
import { ActionDialog } from "@/components/common/action-dialog";
import type { JobStatus } from "@/generated/prisma/enums";
import { cancelJobAction, retryJobAction } from "@/server/actions/jobs";

/** Retry and cancel controls for one job, each behind a confirmation. */
export function JobActions({ id, type, status }: { id: string; type: string; status: JobStatus }) {
  const canRetry = status === "RETRY" || status === "DEAD" || status === "CANCELLED";
  const canCancel = status === "PENDING" || status === "RETRY" || status === "DEAD";
  if (!canRetry && !canCancel) return null;
  return (
    <div className="flex justify-end gap-1.5">
      {canRetry && (
        <ActionDialog
          trigger="Retry"
          triggerVariant="outline"
          triggerSize="sm"
          triggerIcon={<RotateCcw className="size-3.5" />}
          title={`Retry this ${type} job?`}
          description="The job is queued to run now with a fresh set of attempts. Handlers are idempotent, so work that already completed is not repeated. The retry is recorded in the audit log."
          confirmLabel="Retry job"
          action={() => retryJobAction(id)}
        />
      )}
      {canCancel && (
        <ActionDialog
          trigger="Cancel"
          triggerVariant="ghost"
          triggerSize="sm"
          triggerIcon={<Ban className="size-3.5" />}
          title={`Cancel this ${type} job?`}
          description="The job will not run again unless it is retried. Any notification it would have sent is not delivered. The cancellation is recorded in the audit log."
          confirmLabel="Cancel job"
          confirmVariant="destructive"
          action={() => cancelJobAction(id)}
        />
      )}
    </div>
  );
}
