import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BadgePercent, FileCheck2, Wallet } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { WORKSPACES } from "@/lib/workspaces";
import { getActor } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const STEPS = [
  { icon: FileCheck2, title: "Invoice, verified", body: "Channel partners raise brokerage invoices; builders approve them in one inbox." },
  { icon: BadgePercent, title: "Pre-agreed pricing", body: "A fixed discount agreed between builder and financier — transparent to every party." },
  { icon: Wallet, title: "Paid early", body: "Partners accept the offer and receive the net amount, without changing builder credit terms." },
];

export default async function LoginPage() {
  const actor = await getActor();
  if (actor) redirect(WORKSPACES[actor.workspace].basePath);

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-navy px-14 py-12 text-white lg:flex lg:flex-col">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "linear-gradient(#c4a46a 1px, transparent 1px), linear-gradient(90deg, #c4a46a 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -bottom-40 size-[520px] rounded-full border border-gold/20" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -bottom-20 size-[360px] rounded-full border border-gold/15" />

        <Logo tone="light" showTagline className="relative" />

        <div className="relative mt-auto max-w-lg">
          <p className="eyebrow mb-5 text-gold">Channel partner receivables</p>
          <h1 className="font-display text-[3.25rem] leading-[1.02] font-semibold text-white">
            Brokerage earned.
            <br />
            <span className="text-gold">Liquidity delivered.</span>
          </h1>
          <p className="mt-5 max-w-md text-[0.9375rem] leading-relaxed text-white/65">
            BrickFlow connects channel partners, real estate builders and their financing partner on a single, auditable workflow — from invoice
            approval to early payment.
          </p>

          <ol className="mt-12 grid gap-6">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-gold/30 bg-white/[0.04] text-gold">
                  <step.icon className="size-4.5" strokeWidth={1.6} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">
                    <span className="mr-2 font-display text-gold">0{i + 1}</span>
                    {step.title}
                  </p>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-white/55">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="relative mt-14 text-[0.6875rem] text-white/35">
          Demonstration environment. All organisations are fictional and every payment is simulated.
        </p>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-md animate-fade-up">
          <Logo className="mb-10 lg:hidden" showTagline />
          <h2 className="font-display text-[2.25rem] leading-tight font-semibold">Welcome back</h2>
          <p className="mt-2 mb-8 text-sm text-muted-foreground">Sign in to your BrickFlow workspace.</p>
          <LoginForm demoPassword={process.env.DEMO_PASSWORD ?? "BrickFlow@2026"} />
        </div>
      </main>
    </div>
  );
}
