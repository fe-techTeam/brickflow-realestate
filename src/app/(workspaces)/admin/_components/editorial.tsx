import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, Inbox } from "lucide-react";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GoldRule } from "./figures";

/** Editorial page heading: stone eyebrow, serif title, a contextual lede and an optional meta line. */
export function AdminHeader({
  eyebrow,
  title,
  lede,
  meta,
  actions,
  back,
  leading,
  className,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-10 animate-fade-up", className)}>
      {back && (
        <Link
          href={back.href}
          className="group mb-6 inline-flex items-center gap-2 text-[0.75rem] font-medium tracking-wide text-muted-foreground transition-colors hover:text-basalt"
        >
          <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-start gap-5">
          {leading}
          <div className="min-w-0">
            <p className="flex items-center gap-3 text-[0.6875rem] font-semibold tracking-[0.22em] text-kota-600 uppercase">
              <span aria-hidden="true" className="h-px w-6 bg-kota" />
              {eyebrow}
            </p>
            <h1 className="mt-3 text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.01em] text-balance sm:text-[2.875rem]">{title}</h1>
            {lede && <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-ink/80">{lede}</p>}
            {meta && <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">{meta}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
      </div>
      <div aria-hidden="true" className="mt-8 h-px bg-gradient-to-r from-kota/60 via-border to-transparent" />
    </header>
  );
}

/** White surface with a serif heading; the house container for every admin section. */
export function Panel({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "animate-fade-up overflow-hidden rounded-xl border border-border/90 bg-card shadow-[0_1px_0_rgba(34, 45, 43,0.03),0_18px_40px_-28px_rgba(34, 45, 43,0.22)]",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex flex-col gap-3 px-5 pt-6 pb-4 sm:flex-row sm:items-end sm:justify-between sm:px-7">
          <div className="min-w-0">
            {eyebrow && <p className="mb-1.5 text-[0.625rem] font-semibold tracking-[0.2em] text-kota-600 uppercase">{eyebrow}</p>}
            {title && <h2 className="font-display text-[1.5rem] leading-tight font-semibold">{title}</h2>}
            {description && <p className="mt-1 max-w-2xl text-[0.8125rem] leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("px-5 pb-6 sm:px-7", !(title || actions) && "pt-6", bodyClassName)}>{children}</div>
    </section>
  );
}

export interface StripItem {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  accent?: "kota" | "leaf" | "basalt";
}

/** Aligned ledger of headline figures separated by hairlines; replaces rows of stat cards on list pages. */
export function SummaryStrip({ items, className }: { items: StripItem[]; className?: string }) {
  const cols = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" }[Math.min(Math.max(items.length, 2), 5) as 2 | 3 | 4 | 5];
  return (
    <dl
      className={cn(
        "mb-8 grid animate-fade-up grid-cols-2 overflow-hidden rounded-xl border border-border/90 bg-card shadow-[0_18px_40px_-30px_rgba(34, 45, 43,0.25)]",
        cols,
        className,
      )}
    >
      {items.map((item, i) => {
        const body = (
          <>
            <dt className="flex items-center gap-2 text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {item.accent && (
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 rounded-full", item.accent === "kota" ? "bg-kota" : item.accent === "leaf" ? "bg-leaf" : "bg-basalt")}
                />
              )}
              {item.label}
            </dt>
            <dd className="mt-3 text-basalt">{item.value}</dd>
            {item.hint && <dd className="mt-1.5 text-xs text-muted-foreground">{item.hint}</dd>}
          </>
        );
        const cell = cn(
          "relative block px-5 py-5 sm:px-6",
          "border-border/80 [&:not(:nth-child(2n+1))]:border-l lg:[&:not(:first-child)]:border-l",
          i >= 2 && "border-t lg:border-t-0",
        );
        return item.href ? (
          <Link key={item.label} href={item.href} className={cn(cell, "transition-colors hover:bg-paper/60 focus-visible:bg-paper/60 focus-visible:outline-none")}>
            {body}
          </Link>
        ) : (
          <div key={item.label} className={cell}>
            {body}
          </div>
        );
      })}
    </dl>
  );
}

const MONOGRAM_TONE = {
  basalt: "bg-basalt text-kota ring-basalt/10",
  paper: "bg-paper-200 text-basalt ring-kota/30",
  leaf: "bg-leaf text-paper ring-leaf/10",
  kota: "bg-kota-100 text-kota-600 ring-kota/30",
  muted: "bg-muted text-muted-foreground ring-border",
};

/** Serif initials in a soft square, used to give organisations and people a quiet identity. */
export function Monogram({
  name,
  tone = "paper",
  size = "md",
  className,
}: {
  name: string;
  tone?: keyof typeof MONOGRAM_TONE;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-display font-semibold ring-1 ring-inset",
        size === "sm" && "size-8 rounded-md text-[0.8125rem]",
        size === "md" && "size-10 rounded-lg text-[0.9375rem]",
        size === "lg" && "size-16 rounded-xl text-[1.5rem]",
        MONOGRAM_TONE[tone],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Quiet, centred empty state with a stone-ringed emblem. */
export function Empty({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-16 text-center", className)}>
      <span className="relative mb-6 flex size-16 items-center justify-center">
        <span aria-hidden="true" className="absolute inset-0 rounded-full border border-kota/40" />
        <span aria-hidden="true" className="absolute inset-2 rounded-full bg-paper" />
        <Icon className="relative size-5 text-kota-600" strokeWidth={1.4} />
      </span>
      <p className="font-display text-[1.375rem] font-semibold text-basalt">{title}</p>
      <GoldRule className="mx-auto my-3 w-8" />
      {description && <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Calm advisory line with a hairline accent; for rules the admin should keep in mind. */
export function Note({
  icon: Icon,
  tone = "kota",
  title,
  children,
  className,
}: {
  icon?: LucideIcon;
  tone?: "kota" | "warning" | "leaf";
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex animate-fade-up gap-3.5 rounded-lg border-l-2 px-4 py-3.5 text-[0.8125rem] leading-relaxed",
        tone === "kota" && "border-kota bg-kota-100/45 text-ink",
        tone === "warning" && "border-warning/70 bg-warning-soft text-warning",
        tone === "leaf" && "border-leaf bg-leaf-100/50 text-leaf",
        className,
      )}
    >
      {Icon && <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "kota" && "text-kota-600")} strokeWidth={1.6} aria-hidden="true" />}
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div className={cn(title && "mt-0.5")}>{children}</div>
      </div>
    </div>
  );
}

export interface ChipOption {
  value: string;
  label: string;
  count?: number;
}

/** Server-rendered segment filter bound to a single search param; preserves the other params. */
export function FilterChips({
  param,
  options,
  pathname,
  searchParams,
  allLabel = "All",
  allCount,
  label,
}: {
  param: string;
  options: ChipOption[];
  pathname: string;
  searchParams: Record<string, string | string[] | undefined>;
  allLabel?: string;
  allCount?: number;
  label: string;
}) {
  const current = typeof searchParams[param] === "string" ? (searchParams[param] as string) : "";
  const hrefFor = (value: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && k !== param && k !== "take") params.set(k, v);
    if (value) params.set(param, value);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const all: ChipOption = { value: "", label: allLabel, count: allCount };
  return (
    <nav aria-label={label} className="-mx-1 flex flex-wrap gap-1.5 px-1">
      {[all, ...options].map((o) => {
        const active = current === o.value;
        return (
          <Link
            key={o.value || "all"}
            href={hrefFor(o.value)}
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-full border px-3.5 text-[0.8125rem] font-medium transition-colors",
              active ? "border-basalt bg-basalt text-white" : "border-border bg-card text-ink hover:border-basalt/30 hover:text-basalt",
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={cn("tabular text-[0.6875rem]", active ? "text-kota" : "text-muted-foreground")}>{o.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export interface Fact {
  label: string;
  value: ReactNode;
}

/** Dossier-style facts: quiet uppercase labels beside values, separated by hairlines. */
export function FactList({ facts, className }: { facts: Fact[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-border/70 border-t border-border/70", className)}>
      {facts.map((f) => (
        <div key={f.label} className="grid gap-1 py-3.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
          <dt className="pt-0.5 text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">{f.label}</dt>
          <dd className="text-sm break-words text-ink">{f.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
