import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { FigureValue } from "./money";
import { Trend, type TrendProps } from "./trend";

/**
 * One headline figure with its label and context, for the top of a dashboard.
 * `variant="navy"` is the deep brand panel with a champagne figure; `ivory` is a light editorial panel.
 * `aside` renders supporting figures (e.g. KeyFigure list) beside the headline on wide screens.
 */
export function HeroMetric({
  label,
  value,
  context,
  icon: Icon,
  trend,
  aside,
  footer,
  variant = "navy",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  context?: ReactNode;
  icon?: LucideIcon;
  trend?: TrendProps;
  aside?: ReactNode;
  footer?: ReactNode;
  variant?: "navy" | "ivory";
  className?: string;
}) {
  const dark = variant === "navy";
  return (
    <section
      className={cn(
        "relative isolate animate-fade-up overflow-hidden rounded-xl p-6 sm:p-8",
        dark ? "surface-navy" : "surface bg-gradient-to-br from-card via-card to-gold-50",
        className,
      )}
    >
      <HeroBackdrop dark={dark} />
      <div className={cn("relative grid gap-8", aside && "lg:grid-cols-[minmax(0,1fr)_minmax(0,auto)] lg:items-end")}>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {Icon && (
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg ring-1 ring-inset",
                  dark ? "bg-white/[0.06] text-gold ring-gold/30" : "bg-gold-50 text-gold-700 ring-gold-200",
                )}
              >
                <Icon className="size-[1.05rem]" strokeWidth={1.6} />
              </span>
            )}
            <p className={cn("eyebrow", dark ? "text-gold-300/90" : "text-gold-700")}>{label}</p>
          </div>
          <p
            className={cn(
              "figure mt-5 text-[2.5rem] leading-none font-semibold tracking-[-0.035em] sm:text-[3.25rem]",
              dark ? "text-white" : "text-navy",
            )}
          >
            <FigureValue value={value} display />
          </p>
          {(context || trend) && (
            <div className={cn("mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm", dark ? "text-white/65" : "text-muted-foreground")}>
              {trend && <Trend {...trend} onDark={dark} />}
              {context && <span className="max-w-xl leading-relaxed">{context}</span>}
            </div>
          )}
        </div>
        {aside && (
          <div className={cn("min-w-0 border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8", dark ? "border-white/10" : "hairline")}>{aside}</div>
        )}
      </div>
      {footer && (
        <div className={cn("relative mt-7 border-t pt-4 text-xs", dark ? "border-white/10 text-white/55" : "hairline text-muted-foreground")}>{footer}</div>
      )}
    </section>
  );
}

function HeroBackdrop({ dark }: { dark: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("pointer-events-none absolute right-0 bottom-0 -z-10 h-full w-[55%] max-w-[520px]", dark ? "text-gold/[0.12]" : "text-navy/[0.06]")}
      viewBox="0 0 520 260"
      preserveAspectRatio="xMaxYMax meet"
      fill="none"
    >
      <g stroke="currentColor" strokeWidth="1">
        <path d="M150 260V150h60v110M220 260V70h70v190M300 260V110h56v150M366 260V30h74v230M450 260V128h60v132" />
        <path d="M0 259.5h520" />
      </g>
      <g stroke="currentColor" strokeWidth="0.6">
        <path d="M220 92h70M220 114h70M220 136h70M220 158h70M220 180h70M220 202h70M220 224h70" />
        <path d="M366 54h74M366 78h74M366 102h74M366 126h74M366 150h74M366 174h74M366 198h74M366 222h74" />
        <path d="M243 70v190M267 70v190M390 30v230M415 30v230" />
      </g>
    </svg>
  );
}
