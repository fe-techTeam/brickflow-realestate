"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Building2, Check, CircleAlert, Handshake, Landmark, Loader2, ShieldCheck, type LucideIcon } from "lucide-react";
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

/** The demo password is only ever written into the masked password field; it is never rendered as text. */
export function LoginForm({ demoPassword }: { demoPassword?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const [email, setEmail] = useState(state.email ?? "");
  const [password, setPassword] = useState("");
  const showDemo = Boolean(demoPassword);

  function selectDemo(accountEmail: string) {
    setEmail(accountEmail);
    if (demoPassword) setPassword(demoPassword);
  }

  return (
    <div className="space-y-8">
      {showDemo && (
        <div>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <p className="eyebrow text-[0.625rem]">Demo workspaces</p>
            <p className="text-[0.6875rem] text-muted-foreground">Select one to fill its credentials</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="Demo workspaces">
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
                    "group relative flex min-w-0 flex-col items-start gap-3 rounded-xl border bg-card p-3.5 text-left transition-[border-color,box-shadow,transform] duration-200 focus-visible:ring-3 focus-visible:ring-gold/30 focus-visible:outline-none sm:flex-row sm:items-center",
                    selected
                      ? "border-navy shadow-[0_0_0_3px_rgb(196_164_106/0.22),var(--shadow-card)]"
                      : "border-border shadow-xs hover:-translate-y-px hover:border-gold/60 hover:shadow-card",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors duration-200",
                      selected
                        ? "bg-gradient-to-b from-navy-700 to-navy-900 text-gold-300 ring-gold/40"
                        : "bg-ivory-100 text-navy ring-ivory-300 group-hover:bg-navy group-hover:text-gold-300 group-hover:ring-navy",
                    )}
                  >
                    <Icon className="size-[1.05rem]" strokeWidth={1.6} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.8125rem] leading-tight font-semibold text-navy">{WORKSPACES[account.workspace].shortLabel}</span>
                    <span className="mt-0.5 block truncate text-[0.6875rem] text-muted-foreground">{account.org}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-2 right-2 flex size-4 items-center justify-center rounded-full bg-gold text-navy-900 transition-all duration-200",
                      selected ? "scale-100 opacity-100" : "scale-50 opacity-0",
                    )}
                  >
                    <Check className="size-2.5" strokeWidth={3} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showDemo && (
        <div className="flex items-center gap-4" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <span className="text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Credentials</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}

      <form action={formAction} className="space-y-5" noValidate>
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
            className="h-11"
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
            className="h-11"
          />
        </div>
        {state.error && (
          <p role="alert" className="flex items-start gap-2.5 rounded-lg border border-danger/15 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            {state.error}
          </p>
        )}
        <Button type="submit" size="lg" className="group/submit h-12 w-full text-[0.9375rem]" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Signing in…" : "Sign in"}
          {!pending && <ArrowRight className="size-4 text-gold-300 transition-transform duration-200 group-hover/submit:translate-x-0.5" />}
        </Button>
      </form>

    </div>
  );
}
