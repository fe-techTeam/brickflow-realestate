"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

export interface TooltipRow {
  name?: string | number;
  value?: unknown;
  color?: string;
  dataKey?: unknown;
}

/** Tooltip body used by every builder chart: series swatch, label in ink, value right-aligned. */
export function ChartTooltip({
  active,
  label,
  rows,
  format,
  footer,
}: {
  active?: boolean;
  label?: ReactNode;
  rows: TooltipRow[];
  format: (value: number) => string;
  footer?: ReactNode;
}) {
  if (!active || rows.length === 0) return null;
  return (
    <div className="min-w-44 rounded-md border border-border bg-card px-3 py-2.5 text-xs shadow-[0_12px_32px_-16px_rgba(20,43,67,0.35)]">
      {label !== undefined && label !== "" && <p className="mb-1.5 font-semibold text-navy">{label}</p>}
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={String(row.dataKey ?? row.name)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ backgroundColor: row.color }} />
              {row.name}
            </span>
            <span className="tabular font-medium text-slate-ink">{format(Number(row.value ?? 0))}</span>
          </li>
        ))}
      </ul>
      {footer && <p className="mt-1.5 border-t border-border/70 pt-1.5 text-muted-foreground">{footer}</p>}
    </div>
  );
}

export function ChartLegend({ series, className }: { series: SeriesDef[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground", className)}>
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ backgroundColor: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Collapsible table view of a chart's data for screen readers, print and exact figures. */
export function ChartDataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: ReactNode[][] }) {
  return (
    <details className="group mt-4 text-xs">
      <summary className="cursor-pointer text-muted-foreground transition-colors select-none hover:text-navy">View data table</summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={c} scope="col" className={cn("border-b border-border px-2 py-1.5 font-semibold text-muted-foreground", i === 0 ? "text-left" : "text-right")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => (
                  <td key={i} className={cn("border-b border-border/60 px-2 py-1.5 text-slate-ink", i === 0 ? "text-left" : "tabular text-right")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
