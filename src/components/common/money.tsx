import type { ReactNode } from "react";
import { formatINR, formatINRCompact, type PaiseLike } from "@/lib/money";
import { cn } from "@/lib/utils";

const FULL_INR = /^(-?)₹([\d,]+)(?:\.(\d{2}))?$/;
const COMPACT_INR = /^(-?)₹([\d,]+(?:\.\d+)?)\s(L|Cr)$/;

type MoneyTone = "inherit" | "basalt" | "positive" | "negative" | "kota" | "muted";

const TONE: Record<MoneyTone, string> = {
  inherit: "",
  basalt: "text-fg",
  positive: "text-leaf",
  negative: "text-danger",
  kota: "text-fg-muted",
  muted: "text-muted-foreground",
};

function RupeeSign() {
  return <span className="mr-[0.06em] font-[450] opacity-70">₹</span>;
}

/**
 * Renders a pre-formatted INR string with the BrickFlow figure treatment:
 * paise and the L/Cr unit are de-emphasised. Other values render unchanged.
 * `display` scales the minor parts down for large hero figures.
 */
export function FigureValue({ value, display = false }: { value: ReactNode; display?: boolean }) {
  if (typeof value !== "string") return <>{value}</>;
  const full = FULL_INR.exec(value);
  if (full) {
    const [, sign, rupees, paise] = full;
    return (
      <>
        {sign && "−"}
        <RupeeSign />
        {rupees}
        {paise !== undefined && <span className={cn("opacity-45", display && "text-[0.62em] font-medium")}>.{paise}</span>}
      </>
    );
  }
  const compact = COMPACT_INR.exec(value);
  if (compact) {
    const [, sign, number, unit] = compact;
    return (
      <>
        {sign && "−"}
        <RupeeSign />
        {number}
        <span className={cn("ml-[0.16em] text-[0.68em] font-medium tracking-normal opacity-65", !display && "text-[0.8em]")}>{unit}</span>
      </>
    );
  }
  return <>{value}</>;
}

/**
 * Formatted INR amount from integer paise, in Inter tabular lining numerals.
 * Paise are de-emphasised; `compact` renders lakh/crore notation (₹4.85 L).
 */
export function Money({
  paise,
  compact = false,
  showPaise = true,
  tone = "inherit",
  display = false,
  className,
}: {
  paise: PaiseLike;
  compact?: boolean;
  showPaise?: boolean;
  tone?: MoneyTone;
  /** Large-figure treatment: smaller paise/unit. */
  display?: boolean;
  className?: string;
}) {
  const text = compact ? formatINRCompact(paise) : formatINR(paise, { showPaise });
  return (
    <span className={cn("figure whitespace-nowrap", TONE[tone], className)} title={compact ? formatINR(paise) : undefined}>
      <FigureValue value={text} display={display} />
    </span>
  );
}
