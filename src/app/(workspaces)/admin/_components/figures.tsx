import { formatBps, formatINR, formatINRCompact, type PaiseLike } from "@/lib/money";
import { cn } from "@/lib/utils";

type FigureSize = "sm" | "md" | "lg" | "xl" | "hero";

const SIZE: Record<FigureSize, { body: string; unit: string }> = {
  sm: { body: "text-sm font-medium", unit: "text-[0.75em]" },
  md: { body: "text-lg font-medium tracking-[-0.01em]", unit: "text-[0.62em]" },
  lg: { body: "text-[1.75rem] leading-none font-normal tracking-[-0.02em]", unit: "text-[0.5em]" },
  xl: { body: "text-[2.5rem] leading-none font-light tracking-[-0.03em]", unit: "text-[0.42em]" },
  hero: { body: "text-[2.75rem] leading-none font-light tracking-[-0.035em] sm:text-[3.5rem]", unit: "text-[0.36em]" },
};

/**
 * Money in Inter with tabular numerals. Compact mode renders the lakh/crore unit as a quiet suffix,
 * and the rupee symbol is set slightly smaller so the digits carry the weight.
 */
export function Money({
  paise,
  compact = false,
  showPaise = true,
  size = "sm",
  sign,
  className,
  unitClassName,
}: {
  paise: PaiseLike;
  compact?: boolean;
  showPaise?: boolean;
  size?: FigureSize;
  sign?: "+" | "−";
  className?: string;
  unitClassName?: string;
}) {
  const text = compact ? formatINRCompact(paise) : formatINR(paise, { showPaise });
  const match = /^(-?)₹([\d,.]+)(?:\s(L|Cr))?$/.exec(text);
  const s = SIZE[size];
  if (!match) return <span className={cn("tabular font-sans", s.body, className)}>{text}</span>;
  const [, negative, digits, unit] = match;
  return (
    <span className={cn("tabular font-sans whitespace-nowrap", s.body, className)} title={compact ? formatINR(paise) : undefined}>
      {sign ?? (negative ? "−" : "")}
      <span className={cn("mr-[0.08em] font-normal opacity-70", size === "sm" ? "" : "text-[0.72em]")}>₹</span>
      {digits}
      {unit && <span className={cn("ml-[0.22em] font-medium tracking-normal text-muted-foreground", s.unit, unitClassName)}>{unit === "L" ? "L" : "Cr"}</span>}
    </span>
  );
}

/** A discount rate in Inter tabular figures; the percent sign is set lighter in champagne gold. */
export function Rate({ bps, size = "md", className, percentClassName }: { bps: number; size?: FigureSize; className?: string; percentClassName?: string }) {
  const s = SIZE[size];
  return (
    <span className={cn("tabular font-sans whitespace-nowrap text-navy", s.body, className)}>
      {formatBps(bps, { suffix: false })}
      <span className={cn("ml-[0.06em] font-light text-gold-600", size === "sm" ? "" : "text-[0.6em]", percentClassName)}>%</span>
    </span>
  );
}

/** Plain count in Inter tabular figures. */
export function Count({ value, size = "md", className }: { value: number | string; size?: FigureSize; className?: string }) {
  return <span className={cn("tabular font-sans text-navy", SIZE[size].body, className)}>{value}</span>;
}

/** Short champagne rule used under key figures and headings. */
export function GoldRule({ className, wide = false }: { className?: string; wide?: boolean }) {
  return <span aria-hidden="true" className={cn("block h-px bg-gradient-to-r from-gold via-gold/70 to-transparent", wide ? "w-full" : "w-12", className)} />;
}
