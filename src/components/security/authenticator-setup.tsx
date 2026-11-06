"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Check, CircleAlert, Copy, Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/server/action-result";
import type { QrMatrix } from "@/server/auth/qr";
import { QrCode } from "./qr-code";
import { RecoveryCodesList } from "./recovery-codes";

export interface AuthenticatorSecret {
  manualKey: string;
  otpauthUri: string;
  qr: QrMatrix;
}

/**
 * Authenticator enrolment: scan (or type) the key, prove it works with a current code, then save the
 * recovery codes. `done` renders after the codes, e.g. a "Continue" button.
 */
export function AuthenticatorSetup({
  secret,
  email,
  confirm,
  done,
}: {
  secret: AuthenticatorSecret;
  email: string;
  confirm: (code: string) => Promise<ActionResult<{ recoveryCodes: string[] }>>;
  done: (codes: string[]) => ReactNode;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await confirm(code);
      if (!result.ok) {
        setError(result.fieldErrors?.code?.[0] ?? result.error);
        setCode("");
        return;
      }
      setCodes(result.data.recoveryCodes);
    });
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(secret.manualKey.replace(/\s/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (codes) {
    return (
      <div className="grid gap-5">
        <div>
          <p className="eyebrow text-[0.625rem] text-leaf">Step 3 of 3</p>
          <h3 className="mt-1.5 text-base font-semibold text-fg">Save your recovery codes</h3>
        </div>
        <RecoveryCodesList codes={codes} email={email} />
        {done(codes)}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-start">
        <div className="mx-auto w-44 overflow-hidden rounded-lg ring-1 ring-line sm:mx-0">
          <QrCode matrix={secret.qr} label="QR code to add BrickFlow to your authenticator app" className="block h-auto w-full" />
        </div>
        <div className="grid min-w-0 gap-3 text-[0.8125rem] leading-relaxed text-fg-soft">
          <p className="eyebrow text-[0.625rem] text-fg-muted">Step 1 of 3</p>
          <p>
            Scan the QR code with an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password. If you can&apos;t scan it,
            enter this key manually (time-based, 6 digits):
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded-md border border-line bg-glass-50 px-3 py-2 font-mono text-[0.8125rem] tracking-[0.08em] break-all text-fg select-all">
              {secret.manualKey}
            </code>
            <Button type="button" variant="outline" size="icon-sm" onClick={copyKey} aria-label="Copy key">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
          <a href={secret.otpauthUri} className="inline-flex items-center gap-1.5 text-xs font-medium text-fg underline-offset-4 hover:underline sm:hidden">
            <Smartphone className="size-3.5" />
            Open in authenticator app on this phone
          </a>
        </div>
      </div>

      <form onSubmit={submit} className="grid gap-3 border-t hairline pt-5">
        <p className="eyebrow text-[0.625rem] text-fg-muted">Step 2 of 3</p>
        <Label htmlFor="enrol-code">Enter the 6-digit code shown in the app</Label>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Input
            id="enrol-code"
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ""))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            placeholder="123 456"
            className="h-11 text-center font-mono text-lg tracking-[0.35em] sm:max-w-48"
            aria-invalid={Boolean(error)}
            disabled={pending}
            required
          />
          <Button type="submit" className="h-11" disabled={pending || code.replace(/\s/g, "").length !== 6}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Verify and turn on
          </Button>
        </div>
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/15 bg-danger-soft px-3 py-2 text-sm text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
