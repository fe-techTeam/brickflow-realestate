import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, ChevronLeft, Inbox } from "lucide-react";
import { formatINR, formatINRCompact, type PaiseLike } from "@/lib/money";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------------------------------------
 * Money — Inter, tabular numerals, a quieter rupee sign and paise.
 * ---------------------------------------------------------------------------------------------- */

type MoneySize = "xs" | "sm" | "md" | "lg" | "xl" | "hero";

const MONEY_SIZE: Record<MoneySize, string> = {
  xs: "text-xs font-medium",
  sm: "text-sm font-medium",
  md: "text-base font-medium",
  lg: "text-[1.625rem] leading-none font-normal tracking-[-0.015em]",
  xl: "text-[2.125rem] leading-none font-light tracking-[-0.02em]",
  hero: "text-[2.5rem] leading-none font-light tracking-[-0.025em] sm:text-[3.25rem]",
};

export function Money({
  paise,
  size = "sm",
  compact = false,
  paiseMode = "muted",
  sign,
  className,
  symbolClassName,
}: {
  paise: PaiseLike;
  size?: MoneySize;
  compact?: boolean;
  paiseMode?: "muted" | "plain" | "hide";
  sign?: "−" | "+";
  className?: string;
  symbolClassName?: string;
}) {
  const large = size === "lg" || size === "xl" || size === "hero";
  const symbol = (
    <span aria-hidden="true" className={cn("mr-[0.06em] font-normal", large ? "align-[0.32em] text-[0.48em] text-kota-600" : "opacity-70", symbolClassName)}>
      ₹
    </span>
  );

  if (compact) {
    const text = formatINRCompact(paise);
    const match = text.match(/^(-?)₹([\d,]+(?:\.\d+)?)(?:\s(L|Cr))?$/);
    const [, neg = "", body = text, unit] = match ?? [];
    return (
      <span className={cn("figure whitespace-nowrap", MONEY_SIZE[size], className)} aria-label={text.replace("₹", "Rs ")}>
        {sign ?? (neg ? "−" : "")}
        {symbol}
        {body}
        {unit && <span className={cn("ml-[0.2em] font-medium", large ? cn("text-[0.5em] tracking-[0.06em] text-kota-600", symbolClassName) : "opacity-70")}>{unit}</span>}
      </span>
    );
  }

  const text = formatINR(paise, { symbol: false });
  const negative = text.startsWith("-");
  const [rupees, fraction] = text.replace("-", "").split(".");
  return (
    <span className={cn("figure whitespace-nowrap", MONEY_SIZE[size], className)} aria-label={`Rs ${text}`}>
      {sign ?? (negative ? "−" : "")}
      {symbol}
      {rupees}
      {paiseMode !== "hide" && <span className={cn(paiseMode === "muted" && (large ? "text-[0.55em] font-normal opacity-55" : "opacity-55"))}>.{fraction}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Masthead — editorial page heading.
 * ---------------------------------------------------------------------------------------------- */

export function Masthead({
  eyebrow,
  title,
  context,
  actions,
  back,
  children,
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  context?: ReactNode[];
  actions?: ReactNode;
  back?: { href: string; label: string };
  children?: ReactNode;
  className?: string;
}) {
  const items = (context ?? []).filter(Boolean);
  return (
    <header className={cn("mb-8 animate-fade-up border-b border-basalt/10 pb-7 sm:mb-10", className)}>
      {back && (
        <Link
          href={back.href}
          className="mb-5 inline-flex items-center gap-1 text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase transition-colors hover:text-basalt"
        >
          <ChevronLeft className="size-3.5" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-3 text-[0.6875rem] font-semibold tracking-[0.2em] text-kota-600 uppercase">
            <span aria-hidden="true" className="h-px w-8 bg-kota" />
            {eyebrow}
          </p>
          <h1 className="mt-3 text-[2.25rem] leading-[1.04] font-medium tracking-[-0.01em] sm:text-[2.875rem]">{title}</h1>
          {items.length > 0 && (
            <p className="mt-3 flex flex-col items-start gap-x-2.5 gap-y-1.5 text-sm text-ink sm:flex-row sm:flex-wrap sm:items-center">
              {items.map((item, i) => (
                <span key={i} className="inline-flex items-center gap-2.5">
                  {i > 0 && <span aria-hidden="true" className="hidden size-1 rounded-full bg-kota/70 sm:inline-block" />}
                  {item}
                </span>
              ))}
            </p>
          )}
          {children}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Panel — the base surface.
 * ---------------------------------------------------------------------------------------------- */

export function Panel({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  as: Tag = "section",
  id,
}: {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: "section" | "div" | "article" | "aside";
  id?: string;
}) {
  return (
    <Tag
      id={id}
      className={cn(
        "animate-fade-up overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_0_rgba(34, 45, 43,0.03),0_18px_40px_-28px_rgba(34, 45, 43,0.28)]",
        id && "scroll-mt-24",
        className,
      )}
    >
      {(title || actions || eyebrow) && (
        <header className="flex flex-col gap-3 px-5 pt-5 pb-4 sm:flex-row sm:items-end sm:justify-between sm:px-7 sm:pt-6">
          <div className="min-w-0">
            {eyebrow && <p className="mb-1.5 text-[0.625rem] font-semibold tracking-[0.2em] text-kota-600 uppercase">{eyebrow}</p>}
            {title && <h2 className="font-display text-[1.5rem] leading-tight font-medium">{title}</h2>}
            {description && <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("px-5 pb-6 sm:px-7", !(title || actions || eyebrow) && "pt-6", bodyClassName)}>{children}</div>
    </Tag>
  );
}

/** Hairline divider with an optional small-caps caption. */
export function Rule({ label, className }: { label?: string; className?: string }) {
  if (!label) return <div aria-hidden="true" className={cn("h-px bg-border/80", className)} />;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="text-[0.625rem] font-semibold tracking-[0.2em] whitespace-nowrap text-muted-foreground uppercase">{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border/80" />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Key figures — a single strip of aligned metrics.
 * ---------------------------------------------------------------------------------------------- */

export interface KeyFigure {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: "basalt" | "leaf" | "kota" | "danger";
  href?: string;
}

const ACCENT: Record<NonNullable<KeyFigure["accent"]>, string> = {
  basalt: "bg-basalt",
  leaf: "bg-leaf",
  kota: "bg-kota",
  danger: "bg-danger",
};

export function KeyFigures({ items, className }: { items: KeyFigure[]; className?: string }) {
  const cols = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 xl:grid-cols-4", 5: "sm:grid-cols-3 xl:grid-cols-5" }[items.length] ?? "sm:grid-cols-2 xl:grid-cols-4";
  return (
    <div
      className={cn(
        "grid animate-fade-up overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_40px_-30px_rgba(34, 45, 43,0.3)]",
        "divide-y divide-border/70 sm:divide-y-0",
        cols,
        className,
      )}
    >
      {items.map((item, i) => {
        const body = (
          <>
            <p className="flex items-center gap-2 text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {item.accent && <span aria-hidden="true" className={cn("size-1.5 rounded-full", ACCENT[item.accent])} />}
              {item.label}
              {item.href && <ArrowUpRight aria-hidden="true" className="ml-auto size-3.5 text-muted-foreground/60 transition-colors group-hover:text-basalt" />}
            </p>
            <div className="mt-3 text-basalt">{item.value}</div>
            {item.hint && <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.hint}</div>}
          </>
        );
        const cell = cn(
          "group relative min-w-0 px-5 py-5 sm:px-6 sm:py-6",
          "sm:border-border/70 sm:[&:not(:first-child)]:border-l",
          items.length === 4 && "sm:max-xl:[&:nth-child(3)]:border-l-0 sm:max-xl:[&:nth-child(n+3)]:border-t",
          items.length === 5 && "sm:max-xl:[&:nth-child(4)]:border-l-0 sm:max-xl:[&:nth-child(n+4)]:border-t",
        );
        return item.href ? (
          <Link key={item.label} href={item.href} className={cn(cell, "transition-colors hover:bg-paper/50 focus-visible:bg-paper/60 focus-visible:outline-none")}>
            {body}
          </Link>
        ) : (
          <div key={item.label} className={cell} data-index={i}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Large count value in Inter for key figure strips. */
export function Count({ value, unit, className }: { value: number | string; unit?: string; className?: string }) {
  return (
    <span className={cn("figure text-[1.625rem] leading-none font-normal tracking-[-0.015em] text-basalt", className)}>
      {value}
      {unit && <span className="ml-1.5 text-xs font-medium tracking-normal text-muted-foreground">{unit}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Statement rows — label, dotted leader, value.
 * ---------------------------------------------------------------------------------------------- */

export function StatementRow({
  label,
  hint,
  value,
  tone = "default",
  index,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: ReactNode;
  tone?: "default" | "deduct" | "muted";
  index?: string;
}) {
  return (
    <div className="py-3.5">
      <div className="flex items-baseline gap-3">
        {index && <span className="tabular w-5 shrink-0 text-[0.6875rem] font-medium text-kota-600">{index}</span>}
        <span className={cn("text-sm", tone === "muted" ? "text-muted-foreground" : "text-ink")}>{label}</span>
        <span aria-hidden="true" className="min-w-6 flex-1 -translate-y-1 border-b border-dotted border-basalt/20" />
        <span className={cn("text-right text-basalt", tone === "deduct" && "text-danger")}>{value}</span>
      </div>
      {hint && <p className={cn("mt-1 text-xs leading-relaxed text-muted-foreground", index && "pl-8")}>{hint}</p>}
    </div>
  );
}

/** Compact label/value pairs for cards and dossiers. */
export function FactList({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-border/60", className)}>
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
          <dt className="shrink-0 text-xs text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 text-sm break-words text-basalt sm:text-right">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Monogram, seal, empty state.
 * ---------------------------------------------------------------------------------------------- */

export function Monogram({ name, tone = "basalt", size = "md" }: { name: string; tone?: "basalt" | "leaf" | "kota" | "paper"; size?: "sm" | "md" | "lg" }) {
  const letters = name
    .replace(/[^A-Za-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-display font-semibold ring-1",
        size === "sm" && "size-8 text-sm",
        size === "md" && "size-11 text-[1.0625rem]",
        size === "lg" && "size-14 text-xl",
        tone === "basalt" && "bg-basalt text-kota ring-basalt",
        tone === "leaf" && "bg-leaf text-white ring-leaf",
        tone === "kota" && "bg-kota-100 text-kota-600 ring-kota/40",
        tone === "paper" && "bg-paper text-basalt ring-kota/30",
      )}
    >
      {letters}
    </span>
  );
}

/** Circular stamp marking demo-only payouts. */
export function Seal({ id = "bf-seal", label = "Simulated", ring = "Demo rail · No funds moved · BrickFlow ·", className }: { id?: string; label?: string; ring?: string; className?: string }) {
  return (
    <span className={cn("inline-flex size-24 shrink-0 -rotate-12 text-kota-600", className)} role="img" aria-label={`${label}: no real funds move`}>
      <svg viewBox="0 0 120 120" className="size-full" aria-hidden="true">
        <defs>
          <path id={id} d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0" />
        </defs>
        <circle cx="60" cy="60" r="57" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.9" />
        <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.7" />
        <circle cx="60" cy="60" r="33" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.8" />
        <text fill="currentColor" style={{ fontSize: 9.5, letterSpacing: "0.22em", fontWeight: 600, textTransform: "uppercase" }}>
          <textPath href={`#${id}`} startOffset="0">
            {ring.toUpperCase()}
          </textPath>
        </text>
        <text x="60" y="58" textAnchor="middle" fill="currentColor" style={{ fontSize: 10, letterSpacing: "0.16em", fontWeight: 700 }}>
          {label.toUpperCase()}
        </text>
        <text x="60" y="72" textAnchor="middle" fill="currentColor" style={{ fontSize: 7, letterSpacing: "0.3em", fontWeight: 600 }} opacity="0.8">
          ★ DEMO ★
        </text>
      </svg>
    </span>
  );
}

/** Small inline simulated marker. */
export function SimulatedTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-kota/50 bg-kota-100/70 px-2.5 py-0.5 text-[0.625rem] font-semibold tracking-[0.16em] text-kota-600 uppercase",
        className,
      )}
    >
      <span aria-hidden="true" className="size-1 rounded-full bg-kota-600" />
      Simulated
    </span>
  );
}

export function EmptyNote({
  icon: Icon = Inbox,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-6 py-16", className)}>
      <span aria-hidden="true" className={cn("relative flex items-center justify-center", compact ? "mb-3 size-14" : "mb-5 size-20")}>
        <span className="absolute inset-0 rounded-full border border-kota/25" />
        <span className={cn("absolute rounded-full border border-dashed border-kota/35", compact ? "inset-1.5" : "inset-2.5")} />
        <span className={cn("relative flex items-center justify-center rounded-full bg-paper text-kota-600 ring-1 ring-kota/30", compact ? "size-8" : "size-11")}>
          <Icon className={compact ? "size-3.5" : "size-[1.125rem]"} strokeWidth={1.5} />
        </span>
      </span>
      <p className={cn("font-display font-medium text-basalt", compact ? "text-lg" : "text-[1.375rem]")}>{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-[0.8125rem] leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Timeline — dated, with a current marker.
 * ---------------------------------------------------------------------------------------------- */

export interface CaseEvent {
  id: string;
  title: ReactNode;
  actor?: ReactNode;
  at?: string;
  body?: ReactNode;
  tone?: "default" | "success" | "danger" | "warning" | "kota" | "pending";
}

const NODE: Record<NonNullable<CaseEvent["tone"]>, string> = {
  default: "border-basalt/60 bg-card",
  success: "border-leaf bg-leaf",
  danger: "border-danger bg-danger",
  warning: "border-[#c48a2c] bg-card",
  kota: "border-kota bg-kota",
  pending: "border-dashed border-basalt/40 bg-card",
};

export function CaseTimeline({ events, className }: { events: CaseEvent[]; className?: string }) {
  return (
    <ol className={cn("relative", className)}>
      {events.map((e, i) => {
        const last = i === events.length - 1;
        return (
          <li key={e.id} className="relative flex gap-4 pb-6 last:pb-0">
            {!last && <span aria-hidden="true" className="absolute top-4 bottom-0 left-[6.5px] w-px bg-gradient-to-b from-kota/60 via-border to-border" />}
            <span aria-hidden="true" className={cn("relative mt-1 size-3.5 shrink-0 rounded-full border-2 ring-4 ring-card", NODE[e.tone ?? "default"])} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className={cn("text-sm font-medium", e.tone === "pending" ? "text-muted-foreground" : "text-basalt")}>{e.title}</p>
                {e.at && <p className="tabular text-[0.6875rem] text-muted-foreground">{e.at}</p>}
              </div>
              {e.actor && <p className="mt-0.5 text-xs text-muted-foreground">{e.actor}</p>}
              {e.body && <div className="mt-2 border-l border-kota/50 pl-3 text-[0.8125rem] leading-relaxed text-ink italic">{e.body}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Small numbered lane heading used across queues and disbursement lanes. */
export function LaneHeading({ index, title, count, total, action }: { index: string; title: string; count: number; total?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-baseline gap-3">
        <span className="tabular font-display text-lg font-medium text-kota-600">{index}</span>
        <h3 className="font-display text-xl leading-tight font-medium">{title}</h3>
        <span className="tabular rounded-full bg-basalt/[0.06] px-2 py-0.5 text-[0.6875rem] font-semibold text-basalt">{count}</span>
      </div>
      <div className="flex items-center gap-4">
        {total && <span className="text-xs text-muted-foreground">{total}</span>}
        {action}
      </div>
    </div>
  );
}
