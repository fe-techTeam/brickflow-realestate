import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { FigureValue } from "./money";

/**
 * Card section with an editorial header. Body keeps px-5/sm:px-6 so DataTable can bleed to the edges.
 * `variant="quiet"` is an ivory panel without elevation; `footer` renders a tinted strip at the bottom.
 */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  eyebrow,
  footer,
  variant = "default",
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  eyebrow?: ReactNode;
  footer?: ReactNode;
  variant?: "default" | "quiet";
  id?: string;
}) {
  return (
    <section id={id} className={cn(variant === "quiet" ? "surface-quiet" : "surface", "animate-fade-up overflow-hidden", className)}>
      {(title || actions || eyebrow) && (
        <header className="flex flex-col gap-3 border-b hairline px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-[1.125rem]">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow mb-1.5 text-[0.625rem] text-gold-700">{eyebrow}</p>}
            {title && <h2 className="heading-section">{title}</h2>}
            {description && <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("px-5 py-5 sm:px-6", bodyClassName)}>{children}</div>
      {footer && <footer className="border-t hairline bg-ivory-100/70 px-5 py-3 text-xs text-muted-foreground sm:px-6">{footer}</footer>}
    </section>
  );
}

export function EmptyState({
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
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <span className="relative mb-5 flex size-14 items-center justify-center">
        <span aria-hidden="true" className="absolute -inset-3 rounded-full border border-dashed border-gold/30" />
        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-gradient-to-b from-ivory-50 to-ivory-200 ring-1 ring-gold/30" />
        <Icon className="relative size-5 text-gold-700" strokeWidth={1.5} />
      </span>
      <p className="font-display text-[1.1875rem] font-medium text-navy">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export interface DetailItem {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
  hint?: ReactNode;
}

/** Label/value grid. `emphasis` items render as Inter figures; `ruled` separates items with hairlines. */
export function DetailList({
  items,
  columns = 2,
  className,
  variant = "default",
}: {
  items: DetailItem[];
  columns?: 1 | 2 | 3;
  className?: string;
  variant?: "default" | "ruled";
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-8",
        variant === "ruled" ? "gap-y-0" : "gap-y-5",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className={cn("min-w-0", variant === "ruled" && "border-b hairline py-3.5")}>
          <dt className="eyebrow mb-1.5 text-[0.625rem]">{item.label}</dt>
          <dd
            className={cn(
              "text-sm leading-relaxed break-words text-slate-ink",
              item.emphasis && "figure text-[1.25rem] leading-tight font-semibold text-navy",
            )}
          >
            {item.value === null || item.value === undefined ? "—" : item.emphasis ? <FigureValue value={item.value} /> : item.value}
          </dd>
          {item.hint && <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

export interface TimelineEntry {
  id: string;
  title: ReactNode;
  meta: ReactNode;
  body?: ReactNode;
  tone?: "default" | "success" | "danger" | "warning" | "gold";
  icon?: LucideIcon;
}

const TIMELINE_NODE: Record<NonNullable<TimelineEntry["tone"]>, { ring: string; dot: string; icon: string }> = {
  default: { ring: "bg-card ring-navy-200", dot: "bg-navy-400", icon: "text-navy" },
  success: { ring: "bg-heritage-50 ring-heritage-200", dot: "bg-heritage", icon: "text-heritage" },
  danger: { ring: "bg-danger-soft ring-[#e9c7bf]", dot: "bg-danger", icon: "text-danger" },
  warning: { ring: "bg-warning-soft ring-[#ecd6a8]", dot: "bg-warning", icon: "text-warning" },
  gold: { ring: "bg-gold-50 ring-gold-300", dot: "bg-gold", icon: "text-gold-700" },
};

export function Timeline({ entries, className }: { entries: TimelineEntry[]; className?: string }) {
  return (
    <ol className={cn("relative", className)}>
      {entries.map((entry, index) => {
        const tone = TIMELINE_NODE[entry.tone ?? "default"];
        const Icon = entry.icon;
        const last = index === entries.length - 1;
        return (
          <li key={entry.id} className={cn("relative grid grid-cols-[1.375rem_minmax(0,1fr)] gap-x-4", !last && "pb-6")}>
            {!last && <span aria-hidden="true" className="absolute top-6 bottom-0 left-[0.6875rem] w-px -translate-x-1/2 bg-gradient-to-b from-border to-hairline" />}
            <span aria-hidden="true" className={cn("relative mt-px flex size-[1.375rem] items-center justify-center rounded-full ring-1", tone.ring)}>
              {Icon ? <Icon className={cn("size-3", tone.icon)} strokeWidth={2} /> : <span className={cn("size-[7px] rounded-full", tone.dot)} />}
            </span>
            <div className="min-w-0 pt-px">
              <p className="text-sm leading-snug font-medium text-navy">{entry.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{entry.meta}</p>
              {entry.body && (
                <div className="mt-2.5 rounded-lg border border-hairline border-l-2 border-l-gold/50 bg-ivory-100/80 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-slate-ink">
                  {entry.body}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Highlighted figure block used for financial breakdowns (offer, request, settlement). */
export function AmountRow({
  label,
  value,
  tone = "default",
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: "default" | "deduct" | "total";
  hint?: ReactNode;
  className?: string;
}) {
  const total = tone === "total";
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-3", total && "mt-1 border-t border-navy/15 pt-4", className)}>
      <div className="min-w-0">
        <p className={cn("text-sm", total ? "font-semibold text-navy" : "text-slate-ink")}>{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <p
        className={cn(
          "figure shrink-0 text-right",
          total ? "text-[1.75rem] leading-none font-semibold tracking-[-0.03em] text-heritage" : "text-sm font-medium text-navy",
          tone === "deduct" && "text-danger",
        )}
      >
        <FigureValue value={value} display={total} />
      </p>
    </div>
  );
}
