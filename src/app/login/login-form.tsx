"use client";

import { useActionState, useRef, useState } from "react";
import { ArrowRight, Building2, Handshake, Landmark, Loader2, ShieldCheck, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DEMO_ACCOUNTS, WORKSPACES, type WorkspaceKey } from "@/lib/workspaces";
import { loginAction, type LoginState } from "@/server/actions/auth";

const ICONS: Record<WorkspaceKey, LucideIcon> = {
  partner: Handshake,
  builder: Building2,
  finance: Landmark,
  admin: ShieldCheck,
};

export function LoginForm({ demoPassword }: { demoPassword: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const [email, setEmail] = useState(state.email ?? "");
  const [password, setPassword] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  function selectDemo(accountEmail: string) {
    setEmail(accountEmail);
    setPassword(demoPassword);
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow mb-3 text-gold-600">Demo workspaces</p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {DEMO_ACCOUNTS.map((account) => {
            const Icon = ICONS[account.workspace];
            const selected = email === account.email;
            return (
              <button
                key={account.email}
                type="button"
                onClick={() => selectDemo(account.email)}
                aria-pressed={selected}
                className={cn(
                  "group flex items-start gap-3 rounded-lg border bg-card p-3.5 text-left transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected ? "border-gold shadow-[0_0_0_3px_rgba(196,164,106,0.18)]" : "border-border hover:border-gold/60",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-md transition-colors",
                    selected ? "bg-navy text-gold" : "bg-ivory-200 text-navy group-hover:bg-navy group-hover:text-gold",
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-navy">{WORKSPACES[account.workspace].shortLabel}</span>
                  <span className="block truncate text-xs text-muted-foreground">{account.org}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Select a workspace to fill in its demo credentials, or enter them manually. Shared demo password:{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.7rem] text-navy">{demoPassword}</code>
        </p>
      </div>

      <form ref={formRef} action={formAction} className="space-y-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            className="h-11 bg-card"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 bg-card"
          />
        </div>
        {state.error && (
          <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {state.error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Signing in…" : "Sign in"}
          {!pending && <ArrowRight className="size-4" />}
        </Button>
      </form>
    </div>
  );
}
