import type { ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TrendProps {
  /** Display value, e.g. "+12.4%" or "3 this week". */
  value: ReactNode;
  direction?: "up" | "down" | "flat";
  /** Whether the movement is good news. Defaults to up = positive, down = negative. */
  sentiment?: "positive" | "negative" | "neutral";
  label?: ReactNode;
  className?: string;
}

/** Small directional chip for metric movement. */
export function Trend({ value, direction = "up", sentiment, label, className, onDark = false }: TrendProps & { onDark?: boolean }) {
  const mood = sentiment ?? (direction === "up" ? "positive" : direction === "down" ? "negative" : "neutral");
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;
  const tone = onDark
    ? { positive: "bg-leaf-300/15 text-leaf-200", negative: "bg-danger/25 text-[#f0c4bb]", neutral: "bg-card/10 text-white/75" }[mood]
    : { positive: "bg-leaf-50 text-leaf ring-leaf-100", negative: "bg-danger-soft text-danger ring-[rgba(255,194,71,0.22)]", neutral: "bg-glass-100 text-fg-muted ring-line" }[mood];
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("figure inline-flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[0.6875rem] font-semibold tracking-normal", !onDark && "ring-1 ring-inset", tone)}>
        <Icon className="size-3" strokeWidth={2.2} aria-hidden="true" />
        {value}
      </span>
      {label && <span>{label}</span>}
    </span>
  );
}
