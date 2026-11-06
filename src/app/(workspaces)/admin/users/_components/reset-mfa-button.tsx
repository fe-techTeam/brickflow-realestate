"use client";

import { ShieldOff } from "lucide-react";
import { ActionDialog } from "@/components/common/action-dialog";
import { resetUserMfaAction } from "@/server/actions/security";

/** Clears a user's authenticator and recovery codes after their identity has been verified out of band. */
export function ResetMfaButton({ userId, name }: { userId: string; name: string }) {
  return (
    <ActionDialog
      trigger="Reset 2-step"
      triggerVariant="ghost"
      triggerSize="sm"
      triggerIcon={<ShieldOff className="size-3.5" />}
      title={`Reset two-step verification for ${name}?`}
      description="Their authenticator and recovery codes stop working and every session they have ends now. If their role requires two-step verification they will set it up again at next sign-in. Only do this after confirming their identity."
      confirmLabel="Reset two-step verification"
      confirmVariant="destructive"
      action={() => resetUserMfaAction(userId)}
    />
  );
}
