import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft, type LucideIcon } from "lucide-react";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export const CARD =
  "rounded-xl border border-[#e7e1d3] bg-card shadow-[0_1px_0_rgba(20,43,67,0.03),0_22px_44px_-32px_rgba(20,43,67,0.28)]";

/** Gold rule + small caps label used above titles throughout the workspace. */
export function Eyebrow({ children, className, rule = true }: { children: ReactNode; className?: string; rule?: boolean }) {
  return (
    <p className={cn("flex items-center gap-2.5 text-[0.6875rem] font-semibold tracking-[0.18em] text-gold-600 uppercase", className)}>
      {rule && <span aria-hidden="true" className="h-px w-6 bg-gold/70" />}
      {children}
    </p>
  );
}

/** Editorial page heading: eyebrow, serif title, lede and actions over a hairline. */
export function Masthead({
  eyebrow,
  title,
  lede,
  actions,
  back,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <header className={cn("mb-8 animate-fade-up border-b border-[#e3dccb] pb-7 sm:mb-10 sm:pb-8", className)}>
      {back && (
        <Link
          href={back.href}
          className="mb-5 inline-flex items-center gap-1 text-[0.75rem] font-medium tracking-wide text-muted-foreground transition-colors hover:text-navy"
        >
          <ChevronLeft className="size-3.5" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.01em] text-navy sm:text-[2.875rem]">{title}</h1>
          {lede && <div className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-slate-ink/75">{lede}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
      </div>
    </header>
  );
}

/** Content card with a serif title. `flush` removes body padding for tables and lists. */
export function Panel({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  flush = false,
  divided = true,
  id,
}: {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
  divided?: boolean;
  id?: string;
}) {
  const hasHeader = Boolean(title || actions || eyebrow);
  return (
    <section id={id} className={cn(CARD, "animate-fade-up overflow-hidden", className)}>
      {hasHeader && (
        <header
          className={cn(
            "flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-end sm:justify-between sm:px-7 sm:pt-6",
            divided ? "border-b border-[#efe9dc] pb-4 sm:pb-5" : "pb-1",
          )}
        >
          <div className="min-w-0">
            {eyebrow && <p className="mb-1.5 text-[0.625rem] font-semibold tracking-[0.18em] text-gold-600 uppercase">{eyebrow}</p>}
            {title && <h2 className="text-[1.375rem] leading-tight font-semibold text-navy sm:text-[1.5rem]">{title}</h2>}
            {description && <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && "px-5 py-5 sm:px-7 sm:py-6", bodyClassName)}>{children}</div>
    </section>
  );
}

export type Accent = "navy" | "heritage" | "gold" | "slate" | "amber" | "rose";

const ACCENT_BAR: Record<Accent, string> = {
  navy: "bg-navy",
  heritage: "bg-heritage",
  gold: "bg-gold",
  slate: "bg-[#8a97a6]",
  amber: "bg-[#c48a2c]",
  rose: "bg-[#b5473a]",
};

/** A row of figures sharing one card, separated by hairlines (the private-banking "statement strip"). */
export function MetricStrip({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(CARD, "grid animate-fade-up gap-px overflow-hidden bg-[#ebe5d8]", className)}>{children}</div>;
}

export function Metric({
  label,
  value,
  caption,
  accent = "navy",
  href,
  className,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  accent?: Accent;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          <span aria-hidden="true" className={cn("h-3 w-[3px] rounded-full", ACCENT_BAR[accent])} />
          {label}
        </p>
        {href && <ArrowUpRight aria-hidden="true" className="size-3.5 text-muted-foreground/60 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-navy" />}
      </div>
      <div className="mt-5 text-navy">{value}</div>
      {caption && <p className="mt-2 text-[0.75rem] leading-relaxed text-muted-foreground">{caption}</p>}
    </>
  );
  const cell = "group flex min-w-0 flex-col bg-card px-5 py-5 sm:px-6 sm:py-6";
  return href ? (
    <Link href={href} className={cn(cell, "transition-colors hover:bg-[#fcfbf7] focus-visible:bg-[#fcfbf7] focus-visible:outline-none", className)}>
      {body}
    </Link>
  ) : (
    <div className={cn(cell, className)}>{body}</div>
  );
}

/** Plain large figure (counts, days, percentages) set to match Money. */
export function Figure({ children, unit, className }: { children: ReactNode; unit?: ReactNode; className?: string }) {
  return (
    <span className={cn("tabular inline-flex items-baseline font-sans text-[1.75rem] leading-none font-medium tracking-[-0.02em]", className)}>
      {children}
      {unit && <span className="ml-1.5 text-[0.45em] font-medium tracking-[0.08em] text-muted-foreground uppercase">{unit}</span>}
    </span>
  );
}

/** Initials in a serif roundel, used for partners and projects. */
export function Monogram({ name, className, tone = "ivory" }: { name: string; className?: string; tone?: "ivory" | "navy" | "sage" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full font-display text-[0.95rem] font-semibold tracking-wide ring-1",
        tone === "ivory" && "bg-ivory text-navy ring-gold/35",
        tone === "navy" && "bg-navy text-gold ring-navy",
        tone === "sage" && "bg-sage text-heritage ring-heritage/20",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

const CALLOUT_TONE = {
  heritage: "border-heritage/15 bg-sage/45 text-heritage [&_.callout-icon]:bg-heritage [&_.callout-icon]:text-white",
  gold: "border-gold/30 bg-gold-100/55 text-[#6e5627] [&_.callout-icon]:bg-gold [&_.callout-icon]:text-navy",
  navy: "border-navy/10 bg-[#eef1f4] text-navy [&_.callout-icon]:bg-navy [&_.callout-icon]:text-gold",
  amber: "border-[#efd9ae] bg-[#fbf3e3] text-[#73490c] [&_.callout-icon]:bg-[#c48a2c] [&_.callout-icon]:text-white",
  rose: "border-[#ecc6bf] bg-[#fbefec] text-[#7d2c23] [&_.callout-icon]:bg-[#b5473a] [&_.callout-icon]:text-white",
} as const;

export function Callout({
  icon: Icon,
  title,
  children,
  tone = "heritage",
  className,
}: {
  icon: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  tone?: keyof typeof CALLOUT_TONE;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-3.5 rounded-lg border px-4 py-3.5 text-[0.8125rem] leading-relaxed", CALLOUT_TONE[tone], className)}>
      <span className="callout-icon mt-px flex size-6 shrink-0 items-center justify-center rounded-full">
        <Icon className="size-3.5" strokeWidth={2} />
      </span>
      <div className="min-w-0 space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="opacity-90">{children}</div>}
      </div>
    </div>
  );
}

/** Empty state with a double-ring emblem, framed for use inside a Panel. */
export function Empty({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center sm:py-16", className)}>
      <span className="mb-5 flex size-16 items-center justify-center rounded-full border border-gold/25 p-1.5">
        <span className="flex size-full items-center justify-center rounded-full bg-ivory text-gold-600 ring-1 ring-gold/30">
          <Icon className="size-5" strokeWidth={1.5} />
        </span>
      </span>
      <p className="font-display text-[1.375rem] leading-tight font-semibold text-navy">{title}</p>
      {description && <p className="mt-2 max-w-md text-[0.8125rem] leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Label / value pair laid out as a statement line. */
export function LedgerLine({
  label,
  hint,
  value,
  tone = "default",
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: ReactNode;
  tone?: "default" | "deduct" | "total" | "muted";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-6 py-3.5",
        tone === "total" && "mt-1 border-t-2 border-double border-navy/20 pt-5",
        className,
      )}
    >
      <div className="min-w-0">
        <p className={cn("text-[0.875rem]", tone === "total" ? "font-semibold text-navy" : "text-slate-ink")}>{label}</p>
        {hint && <p className="mt-0.5 text-[0.75rem] text-muted-foreground">{hint}</p>}
      </div>
      <div
        className={cn(
          "shrink-0 text-right",
          tone === "deduct" && "text-[#93342a]",
          tone === "total" && "text-heritage",
          tone === "default" && "font-medium text-navy",
          tone === "muted" && "text-slate-ink",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** Small key/value used in definition grids. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1.5 text-[0.875rem] break-words text-navy">{children}</dd>
    </div>
  );
}

/** Thin proportion bar with a percentage, e.g. financed share of approved value. */
export function ShareBar({ part, whole, className }: { part: bigint; whole: bigint; className?: string }) {
  const share = whole > 0n ? Number((part * 1000n) / whole) / 10 : 0;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden="true" className="h-1.5 w-14 overflow-hidden rounded-full bg-[#efeadf]">
        <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.min(100, share)}%` }} />
      </span>
      <span className="tabular text-[0.6875rem] text-muted-foreground">{share.toFixed(0)}%</span>
    </span>
  );
}
