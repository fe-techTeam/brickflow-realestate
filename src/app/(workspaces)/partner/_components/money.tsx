import { formatINR, formatINRCompact, toPaise, type PaiseLike } from "@/lib/money";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-[1.375rem] leading-none tracking-[-0.01em]",
  xl: "text-[1.875rem] leading-none tracking-[-0.02em]",
  hero: "text-[2.5rem] leading-none tracking-[-0.025em] sm:text-[3rem]",
  display: "text-[2.75rem] leading-none tracking-[-0.03em] sm:text-[3.5rem]",
} as const;

/**
 * Exact rupee amount set in Inter with tabular numerals. The paise are optionally
 * de-emphasised so the rupee figure carries the visual weight.
 */
export function Money({
  paise,
  size = "sm",
  sign,
  dimPaise = size !== "sm" && size !== "md",
  showPaise = true,
  className,
}: {
  paise: PaiseLike;
  size?: keyof typeof SIZES;
  sign?: "minus" | "plus";
  dimPaise?: boolean;
  showPaise?: boolean;
  className?: string;
}) {
  const value = toPaise(paise);
  const abs = value < 0n ? -value : value;
  const rupees = formatINR(abs, { showPaise: false, symbol: false });
  const fraction = (abs % 100n).toString().padStart(2, "0");
  const prefix = sign === "minus" || value < 0n ? "− " : sign === "plus" ? "+ " : "";
  const large = size === "xl" || size === "hero" || size === "display";

  return (
    <span className={cn("figure whitespace-nowrap", SIZES[size], className)}>
      {prefix}
      <span className={cn(large && "mr-[0.06em] align-[0.04em] text-[0.62em] font-medium opacity-70")}>₹</span>
      {rupees}
      {showPaise && <span className={cn(dimPaise && "text-[0.58em] font-medium opacity-45")}>.{fraction}</span>}
    </span>
  );
}

/** Lakh/crore shorthand for headline metrics, with the unit set smaller. */
export function CompactMoney({ paise, size = "lg", className }: { paise: PaiseLike; size?: keyof typeof SIZES; className?: string }) {
  const text = formatINRCompact(paise);
  const match = /^(-?)₹([\d,.]+)(?:\s(L|Cr))?$/.exec(text);
  if (!match) return <span className={cn("figure", SIZES[size], className)}>{text}</span>;
  const [, minus, figure, unit] = match;
  return (
    <span className={cn("figure whitespace-nowrap", SIZES[size], className)}>
      {minus ? "− " : ""}
      <span className="mr-[0.06em] align-[0.04em] text-[0.62em] font-medium opacity-70">₹</span>
      {figure}
      {unit && <span className="ml-[0.18em] text-[0.55em] font-medium tracking-normal opacity-60">{unit === "L" ? "L" : "Cr"}</span>}
    </span>
  );
}
