import { Children, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Editorial page header: stone-ruled eyebrow, serif display title, description, actions.
 * `kicker` adds an italic accent after the eyebrow (e.g. "As of 2 November").
 * `meta` renders a row of small facts under the description; pass an array to get dividers.
 * `divider` draws the hairline with a stone lead-in under the header (on by default).
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
  className,
  kicker,
  meta,
  divider = true,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  className?: string;
  kicker?: ReactNode;
  meta?: ReactNode;
  divider?: boolean;
}) {
  const metaItems = Array.isArray(meta) ? Children.toArray(meta) : meta ? [meta] : [];
  return (
    <header className={cn("mb-8 animate-fade-up sm:mb-10", className)}>
      {back && (
        <Link
          href={back.href}
          className="group/back mb-5 inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-muted-foreground transition-colors hover:text-basalt"
        >
          <span className="flex size-5 items-center justify-center rounded-full border border-border bg-card transition-colors group-hover/back:border-kota/60">
            <ChevronLeft className="size-3" />
          </span>
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-8">
        <div className="min-w-0">
          {(eyebrow || kicker) && (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              {eyebrow && (
                <p className="eyebrow flex items-center gap-3 text-kota-700">
                  <span aria-hidden="true" className="h-px w-7 bg-kota" />
                  {eyebrow}
                </p>
              )}
              {kicker && <span className="kicker text-[0.95rem] leading-none">{kicker}</span>}
            </div>
          )}
          <h1 className="display-title">{title}</h1>
          {description && <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">{description}</p>}
          {metaItems.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-soft">
              {metaItems.map((item, i) => (
                <span key={i} className="flex items-center gap-4">
                  {i > 0 && <span aria-hidden="true" className="h-3 w-px bg-border" />}
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 md:pb-1">{actions}</div>}
      </div>
      {divider && (
        <div aria-hidden="true" className="relative mt-7 h-px bg-hairline">
          <span className="absolute top-0 left-0 h-px w-20 bg-kota" />
        </div>
      )}
    </header>
  );
}
