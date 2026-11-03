import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FigureValue } from "./money";

type KeyFigureTone = "basalt" | "leaf" | "kota" | "danger" | "light";

const VALUE_TONE: Record<KeyFigureTone, string> = {
  basalt: "text-basalt",
  leaf: "text-leaf",
  kota: "text-kota-600",
  danger: "text-danger",
  light: "text-white",
};

const SIZE: Record<"sm" | "md" | "lg", string> = {
  sm: "text-base",
  md: "text-[1.375rem]",
  lg: "text-[1.875rem]",
};

/** A labelled figure for summaries and panels: small caps label, Inter tabular value, optional hint. */
export function KeyFigure({
  label,
  value,
  hint,
  tone = "basalt",
  size = "md",
  align = "left",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: KeyFigureTone;
  size?: "sm" | "md" | "lg";
  align?: "left" | "right";
  className?: string;
}) {
  const onDark = tone === "light";
  return (
    <div className={cn("min-w-0", align === "right" && "text-right", className)}>
      <p className={cn("eyebrow text-[0.625rem]", onDark && "text-white/55")}>{label}</p>
      <p className={cn("figure mt-1.5 leading-tight font-semibold", SIZE[size], VALUE_TONE[tone])}>
        <FigureValue value={value} display={size === "lg"} />
      </p>
      {hint && <p className={cn("mt-1 text-xs", onDark ? "text-white/55" : "text-muted-foreground")}>{hint}</p>}
    </div>
  );
}

/** Lays KeyFigures out in a row separated by hairlines (stacks on mobile). */
export function KeyFigureRow({ children, className, onDark = false }: { children: ReactNode; className?: string; onDark?: boolean }) {
  return (
    <div
      className={cn(
        "grid gap-5 sm:auto-cols-fr sm:grid-flow-col sm:gap-0 sm:divide-x sm:[&>*]:px-6 sm:[&>*:first-child]:pl-0 sm:[&>*:last-child]:pr-0",
        onDark ? "sm:divide-white/10" : "sm:divide-hairline",
        className,
      )}
    >
      {children}
    </div>
  );
}
