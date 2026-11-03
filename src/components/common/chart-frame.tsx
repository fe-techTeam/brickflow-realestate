import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FigureValue } from "./money";

export interface ChartLegendItem {
  label: string;
  color: string;
  value?: ReactNode;
  /** Render as a line swatch instead of a block (for line series). */
  line?: boolean;
}

export function ChartLegend({ items, className }: { items: ChartLegendItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg-soft", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn("shrink-0", item.line ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[3px]")}
            style={{ background: item.color }}
          />
          <span>{item.label}</span>
          {item.value !== undefined && (
            <span className="figure font-semibold text-fg">
              <FigureValue value={item.value} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface ChartTooltipRow {
  label: string;
  value: ReactNode;
  color?: string;
}

/** Tooltip body for Recharts `content` render props, matching the BrickFlow popover style. */
export function ChartTooltipCard({ title, rows, footer }: { title?: ReactNode; rows: ChartTooltipRow[]; footer?: ReactNode }) {
  return (
    <div className="min-w-44 rounded-lg border border-border bg-card px-3.5 py-3 text-xs shadow-raised">
      {title && <p className="mb-2 font-semibold text-fg">{title}</p>}
      <div className="space-y-1">
        {rows.map((row) => (
          <p key={row.label} className="flex items-center justify-between gap-5 text-fg-soft">
            <span className="flex items-center gap-2">
              {row.color && <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: row.color }} />}
              {row.label}
            </span>
            <span className="figure font-semibold text-fg">
              <FigureValue value={row.value} />
            </span>
          </p>
        ))}
      </div>
      {footer && <p className="mt-2 border-t hairline pt-2 text-muted-foreground">{footer}</p>}
    </div>
  );
}

/**
 * Card for a chart: title, description, legend, actions, optional headline figure,
 * empty state and a collapsible data table for accessibility.
 * `bare` drops the card chrome so the frame can sit inside an existing Section.
 */
export function ChartFrame({
  title,
  description,
  eyebrow,
  legend,
  actions,
  figure,
  height = 280,
  empty = false,
  emptyText = "No data for this period yet.",
  table,
  label,
  footer,
  bare = false,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  legend?: ChartLegendItem[];
  actions?: ReactNode;
  /** Headline figure shown under the title, e.g. the period total. */
  figure?: ReactNode;
  height?: number;
  empty?: boolean;
  emptyText?: ReactNode;
  table?: { headers: string[]; rows: ReactNode[][] };
  /** Accessible description of the chart image. */
  label?: string;
  footer?: ReactNode;
  bare?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const hasHeader = title || description || eyebrow || actions || figure;
  return (
    <figure className={cn("min-w-0", !bare && "surface animate-fade-up overflow-hidden", className)}>
      {hasHeader && (
        <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", !bare && "px-5 pt-5 sm:px-6 sm:pt-6")}>
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow mb-1.5 text-[0.625rem] text-fg-muted">{eyebrow}</p>}
            {title && <figcaption className="heading-section">{title}</figcaption>}
            {description && <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{description}</p>}
            {figure && (
              <p className="figure mt-3 text-[1.625rem] leading-none font-semibold tracking-[-0.03em] text-fg">
                <FigureValue value={figure} display />
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(!bare && "px-5 pb-5 sm:px-6 sm:pb-6", hasHeader && "pt-5")}>
        {legend && legend.length > 0 && <ChartLegend items={legend} className="mb-4" />}
        {empty ? (
          <div
            className="blueprint-grid-ink flex items-center justify-center rounded-lg border border-dashed border-border bg-glass-100/60 text-sm text-muted-foreground"
            style={{ height }}
          >
            {emptyText}
          </div>
        ) : (
          <div role={label ? "img" : undefined} aria-label={label} className="min-w-0" style={{ minHeight: height }}>
            {children}
          </div>
        )}
        {table && !empty && (
          <details className="group/table mt-4 text-xs">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-medium text-muted-foreground transition-colors select-none hover:text-fg">
              <span aria-hidden="true" className="h-px w-3 bg-haze transition-all group-open/table:w-5" />
              <span className="group-open/table:hidden">View data table</span>
              <span className="hidden group-open/table:inline">Hide data table</span>
            </summary>
            <div className="mt-3 overflow-x-auto rounded-lg border hairline">
              <table className="w-full text-left">
                <thead className="bg-glass-100">
                  <tr>
                    {table.headers.map((h, i) => (
                      <th
                        key={h}
                        scope="col"
                        className={cn("border-b border-border px-3 py-2 text-[0.625rem] font-semibold tracking-[0.1em] text-fg-muted uppercase", i > 0 && "text-right")}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, r) => (
                    <tr key={r} className="last:[&>td]:border-b-0">
                      {row.map((cell, i) => (
                        <td key={i} className={cn("border-b hairline px-3 py-2 text-fg-soft", i > 0 && "figure text-right")}>
                          <FigureValue value={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
      {footer && <div className={cn("border-t hairline text-xs text-muted-foreground", !bare ? "bg-glass-100/70 px-5 py-3 sm:px-6" : "mt-4 pt-3")}>{footer}</div>}
    </figure>
  );
}
