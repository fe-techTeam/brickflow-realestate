import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { FigureValue } from "./money";
import { Trend, type TrendProps } from "./trend";

type StatTone = "basalt" | "leaf" | "kota" | "slate";

const ICON_TONE: Record<StatTone, string> = {
  basalt: "bg-basalt-50 text-basalt ring-basalt-100",
  leaf: "bg-leaf-50 text-leaf ring-leaf-100",
  kota: "bg-kota-50 text-kota-700 ring-kota-200",
  slate: "bg-paper-100 text-ink-soft ring-paper-300",
};

const MARK_TONE: Record<StatTone, string> = {
  basalt: "bg-basalt",
  leaf: "bg-leaf",
  kota: "bg-kota",
  slate: "bg-paper-400",
};

/**
 * Metric card. Values render in Inter tabular figures; INR strings get paise/unit de-emphasis.
 * `emphasis="kota"` turns the card into a basalt hero tile with a stone figure;
 * `emphasis="basalt"` is the same surface with a white figure.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "basalt",
  href,
  className,
  trend,
  emphasis = "none",
  footer,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
  href?: string;
  className?: string;
  trend?: TrendProps;
  emphasis?: "none" | "kota" | "basalt";
  footer?: ReactNode;
}) {
  const dark = emphasis !== "none";

  const body = (
    <div
      className={cn(
        "group/stat relative flex h-full flex-col overflow-hidden p-5 transition-[box-shadow,transform,border-color] duration-300 ease-out-soft sm:p-6",
        dark ? "surface-basalt" : "surface",
        href && !dark && "group-hover/statlink:-translate-y-0.5 group-hover/statlink:border-kota/45 group-hover/statlink:shadow-raised",
        href && dark && "group-hover/statlink:-translate-y-0.5 group-hover/statlink:shadow-overlay",
        className,
      )}
    >
      {dark && (
        <>
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-kota/0 via-kota/70 to-kota/0" />
          <svg aria-hidden="true" className="pointer-events-none absolute -right-6 -bottom-8 h-32 w-40 text-kota/[0.13]" viewBox="0 0 160 128" fill="none">
            <path d="M8 128V64h28v64M44 128V30h32v98M84 128V48h26v80M118 128V12h30v116" stroke="currentColor" strokeWidth="1" />
            <path d="M44 46h32M44 62h32M44 78h32M44 94h32M118 28h30M118 44h30M118 60h30M118 76h30M118 92h30" stroke="currentColor" strokeWidth="0.75" />
          </svg>
        </>
      )}
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span aria-hidden="true" className={cn("mb-3 block h-[2px] w-6 rounded-full", dark ? "bg-kota" : MARK_TONE[tone])} />
          <p className={cn("eyebrow leading-snug", dark && "text-white/60")}>{label}</p>
        </div>
        {Icon && (
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors",
              dark ? "bg-white/[0.06] text-kota ring-kota/30" : ICON_TONE[tone],
            )}
          >
            <Icon className="size-[1.05rem]" strokeWidth={1.6} />
          </span>
        )}
      </div>
      <div className="relative mt-auto pt-6">
        <p
          className={cn(
            "figure text-[1.75rem] leading-none font-semibold tracking-[-0.025em]",
            emphasis === "kota" ? "text-kota-300" : dark ? "text-white" : "text-basalt",
          )}
        >
          <FigureValue value={value} display />
        </p>
        {(hint || trend) && (
          <div className={cn("mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", dark ? "text-white/60" : "text-muted-foreground")}>
            {trend && <Trend {...trend} onDark={dark} />}
            {hint && <span className="min-w-0">{hint}</span>}
          </div>
        )}
        {footer && <div className={cn("mt-4 border-t pt-3 text-xs", dark ? "border-white/10 text-white/60" : "hairline text-muted-foreground")}>{footer}</div>}
      </div>
      {href && (
        <ArrowUpRight
          aria-hidden="true"
          className={cn(
            "absolute right-5 bottom-5 size-4 -translate-x-1 translate-y-1 opacity-0 transition-all duration-300 group-hover/statlink:translate-x-0 group-hover/statlink:translate-y-0 group-hover/statlink:opacity-100 sm:right-6 sm:bottom-6",
            dark ? "text-kota" : "text-kota-600",
          )}
        />
      )}
    </div>
  );

  return href ? (
    <Link
      href={href}
      className="group/statlink block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid animate-fade-up gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3 2xl:grid-cols-6", className)}>{children}</div>;
}
