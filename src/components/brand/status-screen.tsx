import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ArchitecturalScene } from "./architectural-scene";
import { Logo } from "./logo";

/**
 * Full-page brand composition for states outside a workspace shell: not found, unexpected errors.
 * `code` is set as a large editorial numeral; `reference` shows an error digest for support.
 */
export function StatusScreen({
  code,
  eyebrow,
  title,
  description,
  actions,
  note,
  reference,
  tone = "neutral",
  className,
}: {
  code: string;
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  note?: ReactNode;
  reference?: string;
  tone?: "neutral" | "danger";
  className?: string;
}) {
  return (
    <div className={cn("relative isolate flex min-h-dvh flex-col bg-background", className)}>
      <div
        aria-hidden="true"
        className="blueprint-grid-ink pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(90%_70%_at_30%_20%,#000_20%,transparent_75%)]"
      />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 pt-7 sm:px-10 sm:pt-9">
        <Logo showTagline />
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 items-center px-5 py-10 sm:px-10 sm:py-14">
        <div className="surface-raised grid w-full animate-fade-up overflow-hidden lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="relative isolate order-first h-44 overflow-hidden bg-night sm:h-56 lg:order-last lg:h-auto lg:min-h-[30rem]">
            <div aria-hidden="true" className="absolute inset-0 -z-20 bg-[rgb(12_19_30/0.42)]" />
            <div aria-hidden="true" className="blueprint-grid absolute inset-0 -z-20 opacity-70" />
            <ArchitecturalScene className="absolute inset-x-[6%] -bottom-[8%] -z-10 h-[118%] lg:inset-x-[4%] lg:bottom-[2%] lg:h-[92%]" />
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-1/3 bg-gradient-to-t from-night-deep/80 to-transparent" />
            <p
              aria-hidden="true"
              className="absolute top-5 left-6 font-accent text-[0.8125rem] font-medium tracking-[0.04em] text-fg-muted/80 italic sm:top-6 sm:left-7"
            >
              Ref. {code}
            </p>
          </div>

          <div className="flex flex-col justify-center px-6 py-10 sm:px-12 sm:py-14 lg:px-14">
            <p
              className={cn(
                "font-accent text-[4.5rem] leading-[0.85] font-medium tracking-[-0.04em] italic sm:text-[6rem]",
                tone === "danger" ? "text-danger/80" : "text-fg-muted",
              )}
            >
              {code}
            </p>
            <span aria-hidden="true" className="kota-rule mt-6 block w-24" />
            <p className="eyebrow mt-6 text-fg-muted">{eyebrow}</p>
            <h1 className="display-title mt-3 max-w-[22ch]">{title}</h1>
            {description && <p className="mt-4 max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground">{description}</p>}
            {actions && <div className="mt-8 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">{actions}</div>}
            {(note || reference) && (
              <div className="mt-9 space-y-1.5 border-t hairline pt-5 text-xs leading-relaxed text-muted-foreground">
                {note && <p>{note}</p>}
                {reference && (
                  <p>
                    Reference <span className="figure ml-1 rounded bg-glass-100 px-1.5 py-0.5 text-[0.6875rem] text-fg ring-1 ring-line">{reference}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-5 pb-7 text-[0.6875rem] text-muted-foreground sm:px-10">
        <span>BrickFlow · Real Estate Receivables, Made Liquid</span>
        <span className="font-accent text-[0.8125rem] text-fg-muted italic">Real Estate Receivables, Made Liquid</span>
      </footer>
    </div>
  );
}
