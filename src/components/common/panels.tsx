import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function Section({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("surface animate-fade-up overflow-hidden", className)}>
      {(title || actions) && (
        <header className="flex flex-col gap-3 border-b border-border/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            {title && <h2 className="font-display text-xl leading-tight font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("px-5 py-5 sm:px-6", bodyClassName)}>{children}</div>
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
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-ivory-200 text-gold-600 ring-1 ring-gold/20">
        <Icon className="size-5" strokeWidth={1.6} />
      </span>
      <p className="font-display text-lg font-semibold text-navy">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export interface DetailItem {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
}

export function DetailList({ items, columns = 2, className }: { items: DetailItem[]; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <dl className={cn("grid gap-x-8 gap-y-5", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-2 lg:grid-cols-3", className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="eyebrow mb-1">{item.label}</dt>
          <dd className={cn("text-sm break-words text-slate-ink", item.emphasis && "tabular font-display text-xl font-semibold text-navy")}>{item.value ?? "—"}</dd>
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
}

export function Timeline({ entries, className }: { entries: TimelineEntry[]; className?: string }) {
  const dot = {
    default: "bg-navy/70",
    success: "bg-heritage",
    danger: "bg-[#b5473a]",
    warning: "bg-[#c48a2c]",
    gold: "bg-gold",
  };
  return (
    <ol className={cn("relative space-y-6 before:absolute before:top-1.5 before:bottom-1.5 before:left-[5px] before:w-px before:bg-border", className)}>
      {entries.map((entry) => (
        <li key={entry.id} className="relative pl-7">
          <span aria-hidden="true" className={cn("absolute top-1.5 left-0 size-[11px] rounded-full ring-4 ring-card", dot[entry.tone ?? "default"])} />
          <p className="text-sm font-medium text-navy">{entry.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{entry.meta}</p>
          {entry.body && <div className="mt-2 rounded-md bg-muted/70 px-3 py-2 text-sm text-slate-ink">{entry.body}</div>}
        </li>
      ))}
    </ol>
  );
}

/** Highlighted figure block used for financial breakdowns (offer, request, settlement). */
export function AmountRow({ label, value, tone = "default", hint }: { label: ReactNode; value: ReactNode; tone?: "default" | "deduct" | "total"; hint?: ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-3", tone === "total" && "border-t border-navy/15 pt-4")}>
      <div>
        <p className={cn("text-sm", tone === "total" ? "font-semibold text-navy" : "text-slate-ink")}>{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <p
        className={cn(
          "tabular text-right",
          tone === "total" ? "font-display text-[1.75rem] font-semibold text-heritage" : "text-sm font-medium text-navy",
          tone === "deduct" && "text-[#93342a]",
        )}
      >
        {value}
      </p>
    </div>
  );
}
