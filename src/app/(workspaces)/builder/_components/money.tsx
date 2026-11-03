import { formatINR, formatINRCompact, type PaiseLike } from "@/lib/money";
import { cn } from "@/lib/utils";

type MoneySize = "sm" | "md" | "lg" | "xl" | "hero";

const SIZE: Record<MoneySize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
  xl: "text-[1.75rem] leading-none tracking-[-0.02em]",
  hero: "text-[2.25rem] leading-none tracking-[-0.025em] sm:text-[2.625rem]",
};

/**
 * Money is always set in Inter with tabular lining numerals. The rupee sign and paise are
 * de-emphasised so the rupee figure carries the weight, as on a printed statement.
 */
export function Money({
  paise,
  size = "sm",
  compact = false,
  showPaise = true,
  sign,
  className,
}: {
  paise: PaiseLike;
  size?: MoneySize;
  compact?: boolean;
  showPaise?: boolean;
  sign?: "minus" | "plus";
  className?: string;
}) {
  const large = size === "xl" || size === "hero" || size === "lg";
  const text = compact ? formatINRCompact(paise) : formatINR(paise, { showPaise });
  const match = /^(-?)₹([\d,]+)(\.\d+)?(?: (L|Cr))?$/.exec(text);
  const prefix = sign === "minus" ? "− " : sign === "plus" ? "+ " : "";

  if (!match) {
    return <span className={cn("tabular font-sans whitespace-nowrap", SIZE[size], className)}>{prefix + text}</span>;
  }
  const [, negative, rupees, fraction, unit] = match;
  return (
    <span className={cn("tabular inline-flex items-baseline font-sans whitespace-nowrap", SIZE[size], className)}>
      <span className="sr-only">{prefix + text}</span>
      <span aria-hidden="true" className="contents">
        {prefix || negative ? <span>{prefix || "−"}</span> : null}
        <span className={cn("mr-[0.08em] font-normal", large ? "text-[0.62em] opacity-55" : "opacity-70")}>₹</span>
        <span>{rupees}</span>
        {fraction && (compact ? <span>{fraction}</span> : <span className={cn(large ? "text-[0.55em] opacity-55" : "opacity-60")}>{fraction}</span>)}
        {unit && <span className={cn("ml-[0.22em] font-medium tracking-[0.06em]", large ? "text-[0.42em] opacity-60" : "text-[0.75em] opacity-70")}>{unit === "L" ? "LAKH" : "CRORE"}</span>}
      </span>
    </span>
  );
}
