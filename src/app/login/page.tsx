import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { ArchitecturalScene } from "@/components/brand/architectural-scene";
import { Logo } from "@/components/brand/logo";
import { resolveDemoDataset } from "@/lib/demo/catalogue";
import { demoAccountsFor, WORKSPACES } from "@/lib/workspaces";
import { getActor } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const STEPS = [
  { title: "Invoice, verified", body: "Channel partners raise brokerage invoices; builders approve them in one inbox." },
  { title: "Pre-agreed pricing", body: "A fixed discount agreed between builder and financier, transparent to every party." },
  { title: "Paid early", body: "Partners accept the offer and receive the net amount. Builder credit terms stay unchanged." },
];

function demoAccounts() {
  const dataset = resolveDemoDataset();
  return demoAccountsFor(dataset.users, (key) => dataset.organisations[key]?.name ?? key);
}

export default async function LoginPage() {
  const actor = await getActor();
  if (actor) redirect(WORKSPACES[actor.workspace].basePath);

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]">
      <aside className="relative isolate hidden overflow-hidden bg-night text-white lg:flex lg:flex-col">
        <div aria-hidden="true" className="absolute inset-0 -z-20 bg-[rgb(12_19_30/0.42)]" />
        <div aria-hidden="true" className="blueprint-grid absolute inset-0 -z-20 [mask-image:radial-gradient(120%_80%_at_70%_60%,#000_30%,transparent_80%)]" />
        <ArchitecturalScene className="absolute right-[-16%] bottom-[20%] -z-10 h-[70%] w-[66%] max-w-[700px] xl:right-[-10%]" />
        <div aria-hidden="true" className="absolute inset-y-0 left-0 -z-10 w-[72%] bg-gradient-to-r from-night-deep via-night-deep/85 to-transparent" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-[38%] bg-gradient-to-t from-night-deep via-night-deep/85 to-transparent" />

        <div className="flex flex-1 flex-col px-12 py-11 xl:px-16 xl:py-14">
          <Logo tone="light" size="lg" showTagline className="animate-fade-in" />

          <div className="mt-auto max-w-[31rem] animate-fade-up pt-16">
            <p className="eyebrow flex items-center gap-3 text-fg-muted">
              <span aria-hidden="true" className="h-px w-8 bg-haze" />
              Channel partner receivables
            </p>
            <h1 className="display-hero mt-6 text-white">
              Brokerage earned.
              <br />
              <span className="font-accent font-medium text-fg-muted italic">Liquidity, delivered.</span>
            </h1>
            <p className="mt-6 max-w-[25rem] text-[0.9375rem] leading-relaxed text-white/70">
              BrickFlow brings channel partners, real estate builders and their financing partner onto one auditable workflow, from invoice
              approval to early payment.
            </p>
          </div>

          <ol className="mt-14 grid max-w-[40rem] grid-cols-3 gap-8 border-t border-white/10 pt-7">
            {STEPS.map((step, i) => (
              <li key={step.title} className="animate-fade-up" style={{ animationDelay: `${300 + i * 120}ms` }}>
                <p className="font-accent text-[1.75rem] leading-none font-medium text-fg-muted italic">0{i + 1}</p>
                <p className="mt-3 text-[0.8125rem] font-semibold tracking-[0.01em] text-white">{step.title}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-white/50">{step.body}</p>
              </li>
            ))}
          </ol>

          <p className="mt-10 flex items-center gap-2 text-[0.6875rem] tracking-[0.02em] text-white/40">
            <ShieldCheck className="size-3.5 text-fg-muted/70" strokeWidth={1.75} />
            Demonstration environment. All organisations are fictional and every payment is simulated.
          </p>
        </div>
      </aside>

      <main className="relative flex flex-col">
        <div className="relative isolate overflow-hidden bg-night px-5 pt-7 pb-6 text-white sm:px-10 lg:hidden">
          <div aria-hidden="true" className="absolute inset-0 -z-20 bg-transparent" />
          <ArchitecturalScene interactive={false} className="absolute -right-10 -bottom-16 -z-10 h-[150%] w-[85%] opacity-80" />
          <div aria-hidden="true" className="absolute inset-y-0 left-0 -z-10 w-3/4 bg-gradient-to-r from-night-deep/90 to-transparent" />
          <Logo tone="light" showTagline />
          <p className="mt-10 max-w-[15rem] font-display text-[1.65rem] leading-[1.1] font-normal tracking-[-0.02em]">
            Brokerage earned. <span className="font-accent text-fg-muted italic">Liquidity, delivered.</span>
          </p>
        </div>

        <div aria-hidden="true" className="blueprint-grid-ink pointer-events-none absolute inset-0 -z-0 hidden [mask-image:linear-gradient(180deg,#000,transparent_45%)] lg:block" />

        <div className="relative flex flex-1 items-center justify-center px-5 py-10 sm:px-10 lg:py-14">
          <div className="w-full max-w-[27rem] animate-fade-up">
            <p className="eyebrow flex items-center gap-3 text-fg-muted">
              <span aria-hidden="true" className="h-px w-7 bg-haze" />
              Secure sign in
            </p>
            <h2 className="display-title mt-4">Welcome back</h2>
            <p className="mt-2.5 mb-9 text-[0.9375rem] leading-relaxed text-muted-foreground">Sign in to your BrickFlow workspace.</p>
            <LoginForm demoPassword={process.env.DEMO_PASSWORD ?? "BrickFlow@2026"} accounts={demoAccounts()} />
          </div>
        </div>

        <footer className="relative flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t hairline px-5 py-5 text-[0.6875rem] text-muted-foreground">
          <span>© BrickFlow demonstration build</span>
          <span aria-hidden="true" className="h-3 w-px bg-border" />
          <span>Real Estate Receivables, Made Liquid</span>
        </footer>
      </main>
    </div>
  );
}
