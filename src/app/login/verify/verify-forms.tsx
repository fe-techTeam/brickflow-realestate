"use client";

import { useActionState, useState, useTransition } from "react";
import { ArrowRight, CircleAlert, Loader2 } from "lucide-react";
import { AuthenticatorSetup, type AuthenticatorSecret } from "@/components/security/authenticator-setup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cancelMfaLoginAction, confirmLoginEnrolmentAction, finishLoginEnrolmentAction, verifyMfaLoginAction, type MfaChallengeState } from "@/server/actions/auth";

export function MfaChallengeForm() {
  const [state, formAction, pending] = useActionState<MfaChallengeState, FormData>(verifyMfaLoginAction, {});
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="code">{useRecovery ? "Recovery code" : "Authenticator code"}</Label>
        <Input
          key={useRecovery ? "recovery" : "totp"}
          id="code"
          name="code"
          value={code}
          onChange={(e) => setCode(useRecovery ? e.target.value.toUpperCase() : e.target.value.replace(/[^\d\s]/g, ""))}
          inputMode={useRecovery ? "text" : "numeric"}
          autoComplete={useRecovery ? "off" : "one-time-code"}
          autoCapitalize="characters"
          maxLength={useRecovery ? 24 : 7}
          placeholder={useRecovery ? "XXXX-XXXX-XXXX-XXXX" : "123 456"}
          className="h-12 text-center font-mono text-lg tracking-[0.3em]"
          aria-invalid={Boolean(state.error)}
          autoFocus
          required
        />
      </div>
      {state.error && (
        <p role="alert" className="flex items-start gap-2.5 rounded-lg border border-danger/15 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="h-12 w-full" disabled={pending || code.trim().length === 0}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {pending ? "Verifying…" : "Verify and sign in"}
      </Button>
      <button
        type="button"
        className="justify-self-center text-[0.8125rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        onClick={() => {
          setUseRecovery((v) => !v);
          setCode("");
        }}
      >
        {useRecovery ? "Use your authenticator app instead" : "Lost your phone? Use a recovery code"}
      </button>
    </form>
  );
}

export function LoginEnrolment({ secret, email }: { secret: AuthenticatorSecret; email: string }) {
  const [completionToken, setCompletionToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <AuthenticatorSetup
      secret={secret}
      email={email}
      confirm={async (code) => {
        const result = await confirmLoginEnrolmentAction({ code });
        if (result.ok) setCompletionToken(result.data.completionToken);
        return result;
      }}
      done={() => (
        <div className="grid gap-3">
          {error && (
            <p role="alert" className="flex items-start gap-2.5 rounded-lg border border-danger/15 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
              <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
              {error}
            </p>
          )}
          <Button
            size="lg"
            className="h-12 w-full"
            disabled={pending || !completionToken}
            onClick={() =>
              startTransition(async () => {
                const result = await finishLoginEnrolmentAction(completionToken ?? "");
                if (result?.error) setError(result.error);
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            I have saved my codes — continue
            <ArrowRight className="size-4" />
          </Button>
        </div>
      )}
    />
  );
}

export function CancelSignIn() {
  return (
    <form action={cancelMfaLoginAction} className="mt-6 text-center">
      <button type="submit" className="text-[0.8125rem] text-muted-foreground underline-offset-4 hover:text-fg hover:underline">
        Cancel and sign in with a different account
      </button>
    </form>
  );
}
