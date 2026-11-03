import { FigureValue } from "@/components/common/money";
import { formatBps, formatINR, formatINRCompact, type PaiseLike } from "@/lib/money";
import { cn } from "@/lib/utils";

type FigureSize = "sm" | "md" | "lg" | "xl" | "hero";

const SIZE: Record<FigureSize, string> = {
  sm: "text-sm font-medium",
  md: "text-lg font-medium",
  lg: "text-[1.75rem] leading-none font-normal tracking-[-0.025em]",
  xl: "text-[2.5rem] leading-none font-light tracking-[-0.035em]",
  hero: "text-[2.75rem] leading-none font-light tracking-[-0.04em] sm:text-[3.5rem]",
};

/** Money in Inter tabular figures at the admin type scale; digits are rendered by the shared figure treatment. */
export function Money({
  paise,
  compact = false,
  showPaise = true,
  size = "sm",
  sign,
  className,
}: {
  paise: PaiseLike;
  compact?: boolean;
  showPaise?: boolean;
  size?: FigureSize;
  sign?: "−";
  className?: string;
}) {
  const text = compact ? formatINRCompact(paise) : formatINR(paise, { showPaise });
  return (
    <span className={cn("figure whitespace-nowrap", SIZE[size], className)} title={compact ? formatINR(paise) : undefined}>
      {sign}
      <FigureValue value={text} display={size === "lg" || size === "xl" || size === "hero"} />
    </span>
  );
}

/** A discount rate in Inter tabular figures; the percent sign is set lighter in Kota stone. */
export function Rate({ bps, size = "md", className }: { bps: number; size?: FigureSize; className?: string }) {
  return (
    <span className={cn("figure whitespace-nowrap text-fg", SIZE[size], className)}>
      {formatBps(bps, { suffix: false })}
      <span className={cn("ml-[0.06em] font-light text-fg-muted", size !== "sm" && "text-[0.6em]")}>%</span>
    </span>
  );
}

/** Plain count in Inter tabular figures. */
export function Count({ value, size = "md", className }: { value: number | string; size?: FigureSize; className?: string }) {
  return <span className={cn("figure text-fg", SIZE[size], className)}>{value}</span>;
}

/** Short stone rule used under key figures and headings. */
export function GoldRule({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("kota-rule block w-12", className)} />;
}
