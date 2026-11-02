import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, FlaskConical, type LucideIcon } from "lucide-react";
import { DISBURSEMENT_STATUS, FINANCING_STATUS, INVOICE_STATUS, OFFER_STATUS, RECORD_STATUS, SETTLEMENT_STATUS, type StatusMeta, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

/** Editorial page heading: gold eyebrow with rule, serif title, Inter context line. */
export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
  back,
  aside,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-9 animate-fade-up", className)}>
      {back && (
        <Link
          href={back.href}
          className="mb-5 inline-flex items-center gap-1.5 text-[0.75rem] font-medium tracking-wide text-muted-foreground transition-colors hover:text-navy"
        >
          <ChevronLeft className="size-3.5" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-3 flex items-center gap-3 text-[0.6875rem] font-semibold tracking-[0.2em] text-[#8b6f3e] uppercase">
              <span aria-hidden="true" className="h-px w-7 bg-gold" />
              {eyebrow}
            </p>
          )}
          <h1 className="text-[2.25rem] leading-[1.04] font-semibold tracking-[-0.01em] text-balance sm:text-[2.875rem]">{title}</h1>
          {description && <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">{description}</p>}
        </div>
        {aside}
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
      </div>
    </header>
  );
}

/** White surface with an optional serif header. The partner workspace's primary container. */
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
        "animate-fade-up overflow-hidden rounded-[12px] border border-[#e6e0d2] bg-card shadow-[0_1px_0_rgba(20,43,67,0.03),0_18px_40px_-28px_rgba(20,43,67,0.22)]",
        className,
      )}
    >
      {(title || actions || eyebrow) && (
        <div className="flex flex-col gap-3 px-5 pt-5 pb-4 sm:flex-row sm:items-end sm:justify-between sm:px-7 sm:pt-6">
          <div className="min-w-0">
            {eyebrow && <p className="mb-1.5 text-[0.625rem] font-semibold tracking-[0.2em] text-[#8b6f3e] uppercase">{eyebrow}</p>}
            {title && <h2 className="font-display text-[1.5rem] leading-tight font-semibold">{title}</h2>}
            {description && <p className="mt-1 text-[0.8125rem] text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("px-5 pb-6 sm:px-7", !(title || actions || eyebrow) && "pt-6", bodyClassName)}>{children}</div>
    </section>
  );
}

export interface Metric {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  accent?: "navy" | "gold" | "heritage" | "slate";
}

const ACCENT_BAR: Record<NonNullable<Metric["accent"]>, string> = {
  navy: "bg-navy",
  gold: "bg-gold",
  heritage: "bg-heritage",
  slate: "bg-slate-ink/30",
};

/** Aligned row of headline figures in one surface, separated by hairlines. */
export function MetricStrip({ items, className }: { items: Metric[]; className?: string }) {
  const cols = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" }[items.length] ?? "lg:grid-cols-4";
  return (
    <div
      className={cn(
        "grid animate-fade-up grid-cols-2 overflow-hidden rounded-[12px] border border-[#e6e0d2] bg-card shadow-[0_18px_40px_-30px_rgba(20,43,67,0.25)]",
        cols,
        className,
      )}
    >
      {items.map((item, i) => {
        const body = (
          <>
            <p className="flex items-center gap-2 text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              <span aria-hidden="true" className={cn("h-3 w-[3px] rounded-full", ACCENT_BAR[item.accent ?? "navy"])} />
              {item.label}
            </p>
            <div className="mt-4 text-navy">{item.value}</div>
            {item.hint && <p className="mt-2 text-xs text-muted-foreground">{item.hint}</p>}
          </>
        );
        const cell = cn(
          "block min-w-0 border-[#ece6d8] px-5 py-5 sm:px-6 sm:py-6",
          i % 2 === 1 && "border-l",
          i >= 2 && "border-t lg:border-t-0",
          i > 0 && "lg:border-l",
        );
        return item.href ? (
          <Link key={item.label} href={item.href} className={cn(cell, "transition-colors hover:bg-ivory/50 focus-visible:bg-ivory/60 focus-visible:outline-none")}>
            {body}
          </Link>
        ) : (
          <div key={item.label} className={cell}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Statement-style line: label, dotted leader, right-aligned figure. */
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
  tone?: "default" | "muted" | "deduct" | "strong";
  className?: string;
}) {
  return (
    <div className={cn("py-3", className)}>
      <div className="flex items-baseline gap-3">
        <span className={cn("text-sm", tone === "strong" ? "font-semibold text-navy" : tone === "muted" ? "text-muted-foreground" : "text-slate-ink")}>{label}</span>
        <span aria-hidden="true" className="min-w-6 flex-1 translate-y-[-3px] border-b border-dotted border-[#cfc6b2]" />
        <span
          className={cn(
            "text-right text-sm font-medium tabular",
            tone === "deduct" ? "text-[#93342a]" : tone === "muted" ? "text-muted-foreground" : "text-navy",
            tone === "strong" && "font-semibold",
          )}
        >
          {value}
        </span>
      </div>
      {hint && <p className="mt-0.5 text-[0.75rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}

const STATUS_REGISTRY = {
  invoice: INVOICE_STATUS,
  financing: FINANCING_STATUS,
  offer: OFFER_STATUS,
  disbursement: DISBURSEMENT_STATUS,
  settlement: SETTLEMENT_STATUS,
  record: RECORD_STATUS,
} as const;

type StatusRegistry = typeof STATUS_REGISTRY;

const MARK_DOT: Record<StatusTone, string> = {
  neutral: "bg-[#b9b2a3]",
  info: "bg-[#3b6ea0]",
  navy: "bg-navy",
  warning: "bg-[#c48a2c]",
  success: "bg-heritage",
  danger: "bg-[#b5473a]",
  gold: "bg-gold",
};

const MARK_TEXT: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  info: "text-[#25507a]",
  navy: "text-navy",
  warning: "text-[#8a5a12]",
  success: "text-heritage",
  danger: "text-[#93342a]",
  gold: "text-[#8b6f3e]",
};

export function statusMeta<K extends keyof StatusRegistry>(kind: K, status: keyof StatusRegistry[K]): StatusMeta {
  return (STATUS_REGISTRY[kind] as Record<string, StatusMeta>)[status as string] ?? { label: String(status), tone: "neutral" };
}

/** Quiet status indicator for dense tables: a toned dot and label, no pill. */
export function StatusMark<K extends keyof StatusRegistry>({ kind, status, className }: { kind: K; status: keyof StatusRegistry[K]; className?: string }) {
  const meta = statusMeta(kind, status);
  return (
    <span className={cn("inline-flex items-center gap-2 text-[0.8125rem] font-medium whitespace-nowrap", MARK_TEXT[meta.tone], className)}>
      <span aria-hidden="true" className={cn("size-[7px] rounded-full ring-[3px] ring-current/10", MARK_DOT[meta.tone])} />
      {meta.label}
    </span>
  );
}

const PILL: Record<StatusTone, string> = {
  neutral: "border-[#ddd6c7] bg-[#f6f3ec] text-slate-ink/80",
  info: "border-[#c9d9ea] bg-[#eef3f8] text-[#25507a]",
  navy: "border-navy/15 bg-navy/[0.05] text-navy",
  warning: "border-[#efd9ae] bg-[#fbf3e3] text-[#8a5a12]",
  success: "border-heritage/20 bg-[#e8f0eb] text-heritage",
  danger: "border-[#ecc6bf] bg-[#f9ebe8] text-[#93342a]",
  gold: "border-gold/35 bg-gold-100/70 text-[#7d6235]",
};

/** Labelled status pill for page headers, e.g. "Invoice · Accepted". */
export function StatusPill<K extends keyof StatusRegistry>({ kind, status, label, className }: { kind: K; status: keyof StatusRegistry[K]; label?: string; className?: string }) {
  const meta = statusMeta(kind, status);
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap", PILL[meta.tone], className)}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", MARK_DOT[meta.tone])} />
      {label && <span className="font-normal opacity-70">{label}</span>}
      {meta.label}
    </span>
  );
}

export function SimulatedTag({ className, label = "Simulated payment" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold-100/50 px-2.5 py-0.5 text-[0.625rem] font-semibold tracking-[0.12em] whitespace-nowrap text-[#7d6235] uppercase",
        className,
      )}
    >
      <FlaskConical className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Thin architectural line drawing: a colonnade beneath an arch. Decorative only. */
export function ArchMotif({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" aria-hidden="true" className={className}>
      <path d="M20 108V52a40 40 0 0 1 80 0v56" stroke="currentColor" strokeWidth="1" />
      <path d="M30 108V54a30 30 0 0 1 60 0v54" stroke="currentColor" strokeWidth="0.75" opacity="0.6" />
      {[40, 52, 64, 76].map((x) => (
        <path key={x} d={`M${x + 2} 108V70`} stroke="currentColor" strokeWidth="0.75" opacity="0.55" />
      ))}
      <path d="M8 108h104" stroke="currentColor" strokeWidth="1" />
      <path d="M14 113h92" stroke="currentColor" strokeWidth="0.75" opacity="0.5" />
      <circle cx="60" cy="38" r="3" stroke="currentColor" strokeWidth="0.75" />
    </svg>
  );
}

/** Repeating facade lines used behind dark hero surfaces. Decorative only. */
export function FacadePattern({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={cn("pointer-events-none absolute", className)} viewBox="0 0 480 320" preserveAspectRatio="xMaxYMid slice" fill="none">
      {Array.from({ length: 13 }, (_, i) => (
        <path key={i} d={`M${120 + i * 28} 320V${150 - Math.sin((i / 12) * Math.PI) * 90}`} stroke="currentColor" strokeWidth="0.75" />
      ))}
      <path d="M100 320V150a190 150 0 0 1 380 0" stroke="currentColor" strokeWidth="1" />
      <path d="M140 320V170a150 120 0 0 1 300 0" stroke="currentColor" strokeWidth="0.75" />
    </svg>
  );
}

export function EmptyNote({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 text-center", compact ? "py-10" : "py-14", className)}>
      <div className="relative mb-5 flex size-20 items-center justify-center">
        <ArchMotif className="absolute inset-0 size-20 text-gold/55" />
        {Icon && (
          <span className="relative mt-5 flex size-8 items-center justify-center rounded-full bg-card text-navy ring-1 ring-gold/40">
            <Icon className="size-4" strokeWidth={1.6} />
          </span>
        )}
      </div>
      <p className="font-display text-[1.375rem] leading-tight font-semibold text-navy">{title}</p>
      {description && <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Small uppercase label used inside cards and definition lists. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase", className)}>{children}</p>;
}

/** Definition grid for document-style detail blocks. */
export function Facts({ items, columns = 2, className }: { items: { label: string; value: ReactNode; wide?: boolean }[]; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <dl className={cn("grid gap-x-10 gap-y-6", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-2 lg:grid-cols-3", className)}>
      {items.map((item) => (
        <div key={item.label} className={cn("min-w-0", item.wide && "sm:col-span-full")}>
          <dt className="text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">{item.label}</dt>
          <dd className="mt-1.5 text-sm break-words text-slate-ink">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface ChronicleEntry {
  id: string;
  title: ReactNode;
  actor?: ReactNode;
  at: ReactNode;
  note?: ReactNode;
  tone?: "default" | "success" | "danger" | "warning" | "gold";
  icon?: LucideIcon;
}

const CHRONICLE_TONE: Record<NonNullable<ChronicleEntry["tone"]>, string> = {
  default: "border-[#d9d2c2] bg-card text-navy",
  success: "border-heritage bg-heritage text-white",
  danger: "border-[#b5473a] bg-[#b5473a] text-white",
  warning: "border-[#c48a2c] bg-[#fbf3e3] text-[#8a5a12]",
  gold: "border-gold bg-gold-100 text-[#7d6235]",
};

/** Vertical event history with toned markers and quoted notes. */
export function Chronicle({ entries, className }: { entries: ChronicleEntry[]; className?: string }) {
  return (
    <ol className={cn("relative", className)}>
      {entries.map((entry, i) => {
        const Icon = entry.icon;
        return (
          <li key={entry.id} className="relative flex gap-4 pb-6 last:pb-0">
            {i < entries.length - 1 && <span aria-hidden="true" className="absolute top-8 bottom-1 left-[13px] w-px bg-linear-to-b from-[#d9d2c2] to-[#ece6d8]" />}
            <span className={cn("relative mt-0.5 flex size-[27px] shrink-0 items-center justify-center rounded-full border", CHRONICLE_TONE[entry.tone ?? "default"])}>
              {Icon ? <Icon className="size-3.5" strokeWidth={2} /> : <span className="size-1.5 rounded-full bg-current" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-navy">{entry.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {entry.actor && <span className="text-slate-ink">{entry.actor}</span>}
                {entry.actor && " · "}
                {entry.at}
              </p>
              {entry.note && (
                <blockquote className="mt-2.5 border-l-2 border-gold/50 bg-[#faf8f3] py-2 pr-3 pl-3.5 text-[0.8125rem] leading-relaxed text-slate-ink italic">{entry.note}</blockquote>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
