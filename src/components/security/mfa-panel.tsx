"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { ToneBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import { beginMfaEnrolmentAction, confirmMfaEnrolmentAction, disableMfaAction, regenerateRecoveryCodesAction } from "@/server/actions/security";
import { AuthenticatorSetup, type AuthenticatorSecret } from "./authenticator-setup";
import { RecoveryCodesList } from "./recovery-codes";
import { useStepUp } from "./step-up-dialog";

export interface MfaPanelProps {
  enabled: boolean;
  enabledAt: string | null;
  required: boolean;
  recoveryCodesLeft: number;
  email: string;
}

export function MfaPanel({ enabled, enabledAt, required, recoveryCodesLeft, email }: MfaPanelProps) {
  const router = useRouter();
  const stepUp = useStepUp();
  const [secret, setSecret] = useState<AuthenticatorSecret | null>(null);
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();

  function startEnrolment() {
    startTransition(async () => {
      const result = await beginMfaEnrolmentAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSecret(result.data);
      setEnrolOpen(true);
    });
  }

  function regenerate() {
    startTransition(async () => {
      const result = await stepUp.run("mfa.recovery_codes", () => regenerateRecoveryCodesAction());
      if (!result.ok) {
        if (result.code !== "STEP_UP_REQUIRED") toast.error(result.error);
        return;
      }
      setNewCodes(result.data.recoveryCodes);
      toast.success(result.message ?? "New recovery codes generated.");
    });
  }

  function turnOff() {
    startTransition(async () => {
      const result = await stepUp.run("mfa.disable", () => disableMfaAction());
      if (!result.ok) {
        if (result.code !== "STEP_UP_REQUIRED") toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Two-step verification is off.");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3.5">
          <span
            aria-hidden="true"
            className={
              enabled
                ? "flex size-10 shrink-0 items-center justify-center rounded-full bg-leaf-50 text-leaf ring-1 ring-leaf-200 ring-inset"
                : "flex size-10 shrink-0 items-center justify-center rounded-full bg-glass-50 text-fg-muted ring-1 ring-line ring-inset"
            }
          >
            {enabled ? <ShieldCheck className="size-5" strokeWidth={1.6} /> : <Smartphone className="size-5" strokeWidth={1.6} />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-fg">Authenticator app</p>
              {enabled ? <ToneBadge meta={{ label: "On", tone: "success" }} /> : <ToneBadge meta={{ label: "Off", tone: "neutral" }} />}
              {required && <ToneBadge meta={{ label: "Required for your role", tone: "kota" }} />}
            </div>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
              {enabled
                ? `Active since ${formatDate(enabledAt)}. Sign-in and sensitive actions ask for a 6-digit code from your app.`
                : "Add a second step to sign-in: after your password, enter a 6-digit code from an authenticator app on your phone."}
            </p>
          </div>
        </div>
        {!enabled && (
          <Button onClick={startEnrolment} disabled={pending} className="shrink-0">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Set up
          </Button>
        )}
      </div>

      {enabled && (
        <div className="grid gap-4 border-t hairline pt-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="flex items-start gap-3.5">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-glass-50 text-fg-muted ring-1 ring-line ring-inset">
              <KeyRound className="size-[1.1rem]" strokeWidth={1.6} />
            </span>
            <div>
              <p className="font-medium text-fg">Recovery codes</p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
                <span className="figure text-fg">{recoveryCodesLeft}</span> of 10 unused. Use one to sign in if you lose your phone.
                {recoveryCodesLeft <= 3 && " Generate a new set soon."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button variant="outline" size="sm" onClick={regenerate} disabled={pending}>
              <KeyRound className="size-3.5" />
              New codes
            </Button>
            {!required && (
              <Button variant="ghost" size="sm" onClick={turnOff} disabled={pending} className="text-danger hover:text-danger">
                <ShieldOff className="size-3.5" />
                Turn off
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={enrolOpen}
        onOpenChange={(open) => {
          setEnrolOpen(open);
          if (!open) router.refresh();
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Set up two-step verification</DialogTitle>
            <DialogDescription>Link an authenticator app to your BrickFlow account.</DialogDescription>
          </DialogHeader>
          {secret && (
            <AuthenticatorSetup
              secret={secret}
              email={email}
              confirm={(code) => confirmMfaEnrolmentAction({ code })}
              done={() => (
                <div className="flex justify-end">
                  <Button
                    onClick={() => {
                      setEnrolOpen(false);
                      router.refresh();
                    }}
                  >
                    I have saved my codes
                  </Button>
                </div>
              )}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={newCodes !== null} onOpenChange={(open) => !open && setNewCodes(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Your new recovery codes</DialogTitle>
            <DialogDescription>Your previous codes no longer work.</DialogDescription>
          </DialogHeader>
          {newCodes && <RecoveryCodesList codes={newCodes} email={email} />}
          <div className="flex justify-end">
            <Button onClick={() => setNewCodes(null)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      {stepUp.dialog}
    </div>
  );
}
