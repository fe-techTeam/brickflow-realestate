"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { formatINR, formatINRCompact } from "@/lib/money";
import { cn } from "@/lib/utils";

const THEME = {
  ink: "#6b7684",
  grid: "#ebe5d8",
  navy: "#142b43",
  navySoft: "#2c4a68",
  heritage: "#174d3c",
  gold: "#c4a46a",
  goldDeep: "#a98a52",
  slate: "#9fb1c2",
  amber: "#c48a2c",
  rust: "#b5473a",
  oxblood: "#7d2a20",
  cursor: "rgba(196,164,106,0.10)",
} as const;

const axisTick = { fill: THEME.ink, fontSize: 11, fontFamily: "var(--font-inter)", fontVariantNumeric: "tabular-nums" } as const;
const compactTick = (value: number) => (value === 0 ? "₹0" : formatINRCompact(Math.round(value)));

interface TooltipRow {
  label: string;
  paise: number;
  color: string;
}

function TooltipCard({ title, rows, footer }: { title: ReactNode; rows: TooltipRow[]; footer?: ReactNode }) {
  return (
    <div className="min-w-52 rounded-lg border border-white/10 bg-navy-900 px-4 py-3 text-xs text-white/80 shadow-[0_20px_40px_-20px_rgba(13,30,48,0.7)]">
      <p className="mb-2 text-[0.625rem] font-semibold tracking-[0.18em] text-gold uppercase">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center justify-between gap-5 py-0.5">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: row.color }} />
            {row.label}
          </span>
          <span className="tabular text-[0.8125rem] font-medium text-white">{formatINR(Math.round(row.paise))}</span>
        </p>
      ))}
      {footer && <p className="mt-2 border-t border-white/10 pt-2 text-white/55">{footer}</p>}
    </div>
  );
}

export interface LegendItem {
  label: string;
  color: string;
}

/** Chart wrapper: accessible label, optional legend, empty state and a disclosure data table. */
function ChartFrame({
  label,
  empty,
  emptyText,
  height,
  legend,
  table,
  children,
}: {
  label: string;
  empty: boolean;
  emptyText: string;
  height: number;
  legend?: LegendItem[];
  table: { headers: string[]; rows: (string | number)[][] };
  children: ReactNode;
}) {
  return (
    <figure className="min-w-0">
      {legend && !empty && (
        <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1.5" aria-hidden="true">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-2 text-[0.6875rem] font-medium text-slate-ink">
              <span className="h-2 w-3.5 rounded-[2px]" style={{ background: item.color }} />
              {item.label}
            </li>
          ))}
        </ul>
      )}
      {empty ? (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-gold/35 bg-[repeating-linear-gradient(135deg,transparent,transparent_10px,rgba(196,164,106,0.06)_10px,rgba(196,164,106,0.06)_11px)] px-6 text-center"
          style={{ height }}
        >
          <span aria-hidden="true" className="flex items-end gap-1.5">
            {[14, 24, 18, 30].map((h, i) => (
              <span key={i} className="w-2.5 rounded-t-[2px] bg-gold/25" style={{ height: h }} />
            ))}
          </span>
          <p className="max-w-xs text-[0.8125rem] text-muted-foreground">{emptyText}</p>
        </div>
      ) : (
        <div role="img" aria-label={label} className="min-w-0">
          {children}
        </div>
      )}
      <details className="group mt-4 border-t border-border/60 pt-3 text-xs">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase transition-colors select-none hover:text-navy">
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
          <span className="group-open:hidden">View data table</span>
          <span className="hidden group-open:inline">Hide data table</span>
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                {table.headers.map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={cn("border-b border-navy/10 py-2 pr-3 text-[0.625rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase", i > 0 && "text-right")}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={String(row[0])}>
                  {row.map((cell, i) => (
                    <td key={i} className={cn("border-b border-border/50 py-2 pr-3 text-slate-ink", i > 0 && "tabular text-right")}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function BarGradients() {
  return (
    <defs>
      <linearGradient id="fin-navy" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={THEME.navySoft} />
        <stop offset="100%" stopColor={THEME.navy} />
      </linearGradient>
      <linearGradient id="fin-gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#d6bc8a" />
        <stop offset="100%" stopColor={THEME.goldDeep} />
      </linearGradient>
      <linearGradient id="fin-navy-h" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={THEME.navy} />
        <stop offset="100%" stopColor={THEME.navySoft} />
      </linearGradient>
      <linearGradient id="fin-heritage-h" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={THEME.heritage} />
        <stop offset="100%" stopColor="#2f7a62" />
      </linearGradient>
    </defs>
  );
}

export interface MonthlyVolumeDatum {
  label: string;
  paise: string;
  count: number;
}

/** Disbursed volume per month; the latest month is picked out in gold. */
export function MonthlyVolumeChart({ data, height = 260 }: { data: MonthlyVolumeDatum[]; height?: number }) {
  const points = data.map((d) => ({ label: d.label, value: Number(d.paise), count: d.count }));
  const lastIndex = points.length - 1;
  return (
    <ChartFrame
      label={`Disbursed volume by month: ${data.map((d) => `${d.label} ${formatINR(d.paise)}`).join(", ")}`}
      empty={points.every((p) => p.value === 0)}
      emptyText="No simulated payouts in this period yet. Volume appears here once a disbursement is confirmed."
      height={height}
      legend={[
        { label: "Disbursed, net to channel partners", color: THEME.navy },
        { label: "Current month", color: THEME.gold },
      ]}
      table={{ headers: ["Month", "Payouts", "Disbursed"], rows: data.map((d) => [d.label, d.count, formatINR(d.paise)]) }}
    >
      <BarChart responsive data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} style={{ width: "100%", height }}>
        <BarGradients />
        <CartesianGrid vertical={false} stroke={THEME.grid} strokeDasharray="2 4" />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: THEME.grid }} tick={axisTick} tickMargin={10} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={compactTick} width={72} />
        <Tooltip
          cursor={{ fill: THEME.cursor }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!active || !point) return null;
            return (
              <TooltipCard
                title={point.label}
                rows={[{ label: "Disbursed", paise: point.value, color: THEME.gold }]}
                footer={`${point.count} simulated payout${point.count === 1 ? "" : "s"}`}
              />
            );
          }}
        />
        <Bar dataKey="value" name="Disbursed" radius={[3, 3, 0, 0]} maxBarSize={30}>
          {points.map((p, i) => (
            <Cell key={p.label} fill={i === lastIndex ? "url(#fin-gold)" : "url(#fin-navy)"} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

export interface BuilderValueDatum {
  name: string;
  paise: string;
}

/** One value per builder as horizontal bars (e.g. discount earned). */
export function BuilderValueChart({ data, seriesLabel, emptyText }: { data: BuilderValueDatum[]; seriesLabel: string; emptyText: string }) {
  const points = data.map((d) => ({ name: d.name, value: Number(d.paise) }));
  const height = Math.max(180, points.length * 52 + 40);
  return (
    <ChartFrame
      label={`${seriesLabel} by builder: ${data.map((d) => `${d.name} ${formatINR(d.paise)}`).join(", ")}`}
      empty={points.every((p) => p.value === 0)}
      emptyText={emptyText}
      height={height}
      table={{ headers: ["Builder", seriesLabel], rows: data.map((d) => [d.name, formatINR(d.paise)]) }}
    >
      <BarChart responsive layout="vertical" data={points} margin={{ top: 4, right: 16, bottom: 0, left: 0 }} style={{ width: "100%", height }}>
        <BarGradients />
        <CartesianGrid horizontal={false} stroke={THEME.grid} strokeDasharray="2 4" />
        <XAxis type="number" tickLine={false} axisLine={false} tick={axisTick} tickFormatter={compactTick} />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ ...axisTick, fill: THEME.navy }} width={140} />
        <Tooltip
          cursor={{ fill: THEME.cursor }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!active || !point) return null;
            return <TooltipCard title={point.name} rows={[{ label: seriesLabel, paise: point.value, color: THEME.heritage }]} />;
          }}
        />
        <Bar dataKey="value" name={seriesLabel} fill="url(#fin-heritage-h)" radius={[0, 3, 3, 0]} maxBarSize={16} />
      </BarChart>
    </ChartFrame>
  );
}

export interface ExposureDatum {
  name: string;
  outstanding: string;
  committed: string;
}

/** Exposure by builder: disbursed-but-unsettled plus approved-not-yet-disbursed, stacked. */
export function ExposureChart({ data }: { data: ExposureDatum[] }) {
  const points = data.map((d) => ({ name: d.name, outstanding: Number(d.outstanding), committed: Number(d.committed) }));
  const height = Math.max(180, points.length * 52 + 40);
  return (
    <ChartFrame
      label={`Exposure by builder: ${data.map((d) => `${d.name} outstanding ${formatINR(d.outstanding)}, committed ${formatINR(d.committed)}`).join("; ")}`}
      empty={points.every((p) => p.outstanding === 0 && p.committed === 0)}
      emptyText="No open exposure. Every disbursed request has been settled and nothing is awaiting payout."
      height={height}
      legend={[
        { label: "Outstanding settlement", color: THEME.navy },
        { label: "Approved, not disbursed", color: THEME.gold },
      ]}
      table={{
        headers: ["Builder", "Outstanding settlement", "Approved, not disbursed"],
        rows: data.map((d) => [d.name, formatINR(d.outstanding), formatINR(d.committed)]),
      }}
    >
      <BarChart responsive layout="vertical" data={points} margin={{ top: 4, right: 16, bottom: 0, left: 0 }} style={{ width: "100%", height }}>
        <CartesianGrid horizontal={false} stroke={THEME.grid} strokeDasharray="2 4" />
        <XAxis type="number" tickLine={false} axisLine={false} tick={axisTick} tickFormatter={compactTick} />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ ...axisTick, fill: THEME.navy }} width={140} />
        <Tooltip
          cursor={{ fill: THEME.cursor }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!active || !point) return null;
            return (
              <TooltipCard
                title={point.name}
                rows={[
                  { label: "Outstanding settlement", paise: point.outstanding, color: THEME.slate },
                  { label: "Approved, not disbursed", paise: point.committed, color: THEME.gold },
                ]}
                footer={`Total ${formatINR(Math.round(point.outstanding + point.committed))}`}
              />
            );
          }}
        />
        <Bar dataKey="outstanding" name="Outstanding settlement" stackId="exposure" fill={THEME.navy} stroke="#ffffff" strokeWidth={2} maxBarSize={16} />
        <Bar dataKey="committed" name="Approved, not disbursed" stackId="exposure" fill={THEME.gold} stroke="#ffffff" strokeWidth={2} radius={[0, 3, 3, 0]} maxBarSize={16} />
      </BarChart>
    </ChartFrame>
  );
}

export interface AgeingDatum {
  key: string;
  label: string;
  short: string;
  paise: string;
  count: number;
}

const AGEING_COLORS: Record<string, string> = {
  "not-due-30": THEME.slate,
  "not-due": THEME.navy,
  "overdue-30": THEME.amber,
  "overdue-60": THEME.rust,
  "overdue-60+": THEME.oxblood,
};

/** Open settlements bucketed by days to / past due date. Ordinal risk scale, labelled on the axis. */
export function SettlementAgeingChart({ data, height = 260 }: { data: AgeingDatum[]; height?: number }) {
  const points = data.map((d) => ({ key: d.key, label: d.label, short: d.short, value: Number(d.paise), count: d.count }));
  return (
    <ChartFrame
      label={`Settlement ageing: ${data.map((d) => `${d.label} ${formatINR(d.paise)}`).join(", ")}`}
      empty={points.every((p) => p.value === 0)}
      emptyText="No open settlements. Every disbursed request has been settled by its builder."
      height={height}
      table={{ headers: ["Bucket", "Settlements", "Amount"], rows: data.map((d) => [d.label, d.count, formatINR(d.paise)]) }}
    >
      <BarChart responsive data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} style={{ width: "100%", height }}>
        <CartesianGrid vertical={false} stroke={THEME.grid} strokeDasharray="2 4" />
        <XAxis dataKey="short" tickLine={false} axisLine={{ stroke: THEME.grid }} tick={{ ...axisTick, fontSize: 10 }} tickMargin={10} interval={0} />
        <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={compactTick} width={72} />
        <Tooltip
          cursor={{ fill: THEME.cursor }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!active || !point) return null;
            return (
              <TooltipCard
                title={point.label}
                rows={[{ label: "Open settlements", paise: point.value, color: AGEING_COLORS[point.key] ?? THEME.navy }]}
                footer={`${point.count} settlement${point.count === 1 ? "" : "s"}`}
              />
            );
          }}
        />
        <Bar dataKey="value" name="Open settlements" radius={[3, 3, 0, 0]} maxBarSize={40}>
          {points.map((p) => (
            <Cell key={p.key} fill={AGEING_COLORS[p.key] ?? THEME.navy} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
