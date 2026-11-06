"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { CircleAlert, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/server/action-result";
import { confirmStepUpAction, stepUpMethodAction } from "@/server/actions/security";
import type { StepUpPurpose } from "@/server/auth/step-up";

interface PendingRequest {
  id: number;
  purpose: StepUpPurpose;
  message: string;
  resolve: (confirmed: boolean) => void;
}

/**
 * Runs a server action that may require step-up confirmation. When the action answers
 * `code: "STEP_UP_REQUIRED"`, the dialog asks for an authenticator code (or the password for accounts
 * without two-step verification), confirms it on the server and retries the action once.
 *
 *   const stepUp = useStepUp();
 *   const result = await stepUp.run("payout.release", () => releasePayoutAction(id));
 *   return <>{button}{stepUp.dialog}</>;
 */
export function useStepUp() {
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const nextId = useRef(0);

  const run = useCallback(async <T,>(purpose: StepUpPurpose, action: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> => {
    const first = await action();
    if (first.ok || first.code !== "STEP_UP_REQUIRED") return first;
    nextId.current += 1;
    const id = nextId.current;
    const confirmed = await new Promise<boolean>((resolve) => setRequest({ id, purpose, message: first.error, resolve }));
    if (!confirmed) return { ok: false, error: "Confirmation cancelled.", code: "STEP_UP_REQUIRED" };
    return action();
  }, []);

  const dialog = (
    <StepUpDialog
      key={request?.id ?? 0}
      request={request}
      onDone={(confirmed) => {
        request?.resolve(confirmed);
        setRequest(null);
      }}
    />
  );
  return { run, dialog };
}

export function StepUpDialog({ request, onDone }: { request: PendingRequest | null; onDone: (confirmed: boolean) => void }) {
  const [method, setMethod] = useState<"totp" | "password" | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const open = request !== null;

  useEffect(() => {
    if (!open) return;
    let active = true;
    void stepUpMethodAction().then((result) => {
      if (active) setMethod(result.ok ? result.data.method : "totp");
    });
    return () => {
      active = false;
    };
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!request) return;
    setError(null);
    startTransition(async () => {
      const result = await confirmStepUpAction(request.purpose, { code });
      if (!result.ok) {
        setError(result.fieldErrors?.code?.[0] ?? result.error);
        setCode("");
        return;
      }
      onDone(true);
    });
  }

  const totp = method !== "password";
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onDone(false);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader className="gap-0">
            <span aria-hidden="true" className="mb-4 flex size-11 items-center justify-center rounded-full bg-glass-50 text-fg ring-1 ring-line ring-inset">
              <ShieldCheck className="size-5" strokeWidth={1.6} />
            </span>
            <p className="eyebrow mb-1.5 text-[0.625rem] text-fg-muted">Security check</p>
            <DialogTitle>Confirm it&apos;s you</DialogTitle>
            <DialogDescription className="mt-2">
              {request?.message}{" "}
              {totp ? "Enter the 6-digit code from your authenticator app." : "Enter your account password."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="step-up-code">{totp ? "Authenticator code" : "Password"}</Label>
            <Input
              id="step-up-code"
              name="code"
              value={code}
              onChange={(e) => setCode(totp ? e.target.value.replace(/[^\d\s]/g, "") : e.target.value)}
              type={totp ? "text" : "password"}
              inputMode={totp ? "numeric" : undefined}
              autoComplete={totp ? "one-time-code" : "current-password"}
              maxLength={totp ? 7 : 200}
              placeholder={totp ? "123 456" : undefined}
              className={totp ? "h-11 text-center font-mono text-lg tracking-[0.35em]" : "h-11"}
              aria-invalid={Boolean(error)}
              disabled={pending || method === null}
              autoFocus
              required
            />
          </div>
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/15 bg-danger-soft px-3 py-2 text-sm text-danger">
              <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onDone(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || method === null || code.trim().length === 0}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
