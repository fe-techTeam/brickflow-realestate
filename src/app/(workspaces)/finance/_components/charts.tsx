"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { formatINR, formatINRCompact } from "@/lib/money";
import { cn } from "@/lib/utils";

const INK = "#5f6b78";
const GRID = "#ece7db";
const NAVY = "#142b43";
const BLUE = "#2a5d8a";
const GOLD = "#a98a52";
const HERITAGE = "#174d3c";

const axisTick = { fill: INK, fontSize: 11 };
const compactTick = (value: number) => (value === 0 ? "₹0" : formatINRCompact(Math.round(value)));

interface TooltipRow {
  label: string;
  paise: number;
  color: string;
}

function TooltipCard({ title, rows, footer }: { title: ReactNode; rows: TooltipRow[]; footer?: ReactNode }) {
  return (
    <div className="min-w-44 rounded-md border border-border bg-card px-3 py-2.5 text-xs shadow-[0_12px_32px_-16px_rgba(20,43,67,0.35)]">
      <p className="mb-1.5 font-medium text-navy">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center justify-between gap-4 py-0.5 text-slate-ink">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: row.color }} />
            {row.label}
          </span>
          <span className="tabular font-medium text-navy">{formatINR(Math.round(row.paise))}</span>
        </p>
      ))}
      {footer && <p className="mt-1.5 border-t border-border pt-1.5 text-muted-foreground">{footer}</p>}
    </div>
  );
}

function ChartFrame({
  label,
  empty,
  emptyText,
  height,
  table,
  children,
}: {
  label: string;
  empty: boolean;
  emptyText: string;
  height: number;
  table: { headers: string[]; rows: (string | number)[][] };
  children: ReactNode;
}) {
  return (
    <figure className="min-w-0">
      {empty ? (
        <div className="flex items-center justify-center rounded-md border border-dashed border-border bg-ivory/40 text-sm text-muted-foreground" style={{ height }}>
          {emptyText}
        </div>
      ) : (
        <div role="img" aria-label={label} className="min-w-0">
          {children}
        </div>
      )}
      <details className="group mt-3 text-xs">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-muted-foreground transition-colors select-none hover:text-navy">
          <span className="group-open:hidden">View data table</span>
          <span className="hidden group-open:inline">Hide data table</span>
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                {table.headers.map((h, i) => (
                  <th key={h} scope="col" className={cn("border-b border-border py-1.5 pr-3 font-semibold text-muted-foreground", i > 0 && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={String(row[0])}>
                  {row.map((cell, i) => (
                    <td key={i} className={cn("border-b border-border/60 py-1.5 pr-3 text-slate-ink", i > 0 && "tabular text-right")}>
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

export interface MonthlyVolumeDatum {
  label: string;
  paise: string;
  count: number;
}

/** Disbursed volume per month (single series). */
export function MonthlyVolumeChart({ data, height = 260 }: { data: MonthlyVolumeDatum[]; height?: number }) {
  const points = data.map((d) => ({ label: d.label, value: Number(d.paise), count: d.count }));
  return (
    <ChartFrame
      label={`Disbursed volume by month: ${data.map((d) => `${d.label} ${formatINR(d.paise)}`).join(", ")}`}
      empty={points.every((p) => p.value === 0)}
      emptyText="No disbursements in this period yet."
      height={height}
      table={{ headers: ["Month", "Payouts", "Disbursed"], rows: data.map((d) => [d.label, d.count, formatINR(d.paise)]) }}
    >
      <BarChart responsive data={points} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} style={{ width: "100%", height }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={axisTick} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={compactTick} width={78} />
        <Tooltip
          cursor={{ fill: "rgba(20,43,67,0.04)" }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!active || !point) return null;
            return (
              <TooltipCard
                title={point.label}
                rows={[{ label: "Disbursed", paise: point.value, color: NAVY }]}
                footer={`${point.count} simulated payout${point.count === 1 ? "" : "s"}`}
              />
            );
          }}
        />
        <Bar dataKey="value" name="Disbursed" fill={NAVY} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ChartFrame>
  );
}

export interface BuilderValueDatum {
  name: string;
  paise: string;
}

/** One value per builder as horizontal bars (e.g. discount earned). */
export function BuilderValueChart({ data, seriesLabel, emptyText, color = HERITAGE }: { data: BuilderValueDatum[]; seriesLabel: string; emptyText: string; color?: string }) {
  const points = data.map((d) => ({ name: d.name, value: Number(d.paise) }));
  const height = Math.max(160, points.length * 56 + 40);
  return (
    <ChartFrame
      label={`${seriesLabel} by builder: ${data.map((d) => `${d.name} ${formatINR(d.paise)}`).join(", ")}`}
      empty={points.every((p) => p.value === 0)}
      emptyText={emptyText}
      height={height}
      table={{ headers: ["Builder", seriesLabel], rows: data.map((d) => [d.name, formatINR(d.paise)]) }}
    >
      <BarChart responsive layout="vertical" data={points} margin={{ top: 4, right: 12, bottom: 0, left: 4 }} style={{ width: "100%", height }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tickLine={false} axisLine={false} tick={axisTick} tickFormatter={compactTick} />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={axisTick} width={132} />
        <Tooltip
          cursor={{ fill: "rgba(20,43,67,0.04)" }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!active || !point) return null;
            return <TooltipCard title={point.name} rows={[{ label: seriesLabel, paise: point.value, color }]} />;
          }}
        />
        <Bar dataKey="value" name={seriesLabel} fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} />
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
  const height = Math.max(180, points.length * 56 + 72);
  return (
    <ChartFrame
      label={`Exposure by builder: ${data.map((d) => `${d.name} outstanding ${formatINR(d.outstanding)}, committed ${formatINR(d.committed)}`).join("; ")}`}
      empty={points.every((p) => p.outstanding === 0 && p.committed === 0)}
      emptyText="No open exposure."
      height={height}
      table={{
        headers: ["Builder", "Outstanding settlement", "Approved, not disbursed"],
        rows: data.map((d) => [d.name, formatINR(d.outstanding), formatINR(d.committed)]),
      }}
    >
      <BarChart responsive layout="vertical" data={points} margin={{ top: 4, right: 12, bottom: 0, left: 4 }} style={{ width: "100%", height }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tickLine={false} axisLine={false} tick={axisTick} tickFormatter={compactTick} />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={axisTick} width={132} />
        <Legend
          verticalAlign="top"
          align="left"
          iconType="square"
          iconSize={8}
          itemSorter={null}
          wrapperStyle={{ fontSize: 11, color: INK, paddingBottom: 8 }}
        />
        <Tooltip
          cursor={{ fill: "rgba(20,43,67,0.04)" }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!active || !point) return null;
            return (
              <TooltipCard
                title={point.name}
                rows={[
                  { label: "Outstanding settlement", paise: point.outstanding, color: BLUE },
                  { label: "Approved, not disbursed", paise: point.committed, color: GOLD },
                ]}
                footer={`Total ${formatINR(Math.round(point.outstanding + point.committed))}`}
              />
            );
          }}
        />
        <Bar dataKey="outstanding" name="Outstanding settlement" stackId="exposure" fill={BLUE} stroke="#ffffff" strokeWidth={2} maxBarSize={22} />
        <Bar dataKey="committed" name="Approved, not disbursed" stackId="exposure" fill={GOLD} stroke="#ffffff" strokeWidth={2} radius={[0, 4, 4, 0]} maxBarSize={22} />
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
  "not-due-30": "#8fa3b6",
  "not-due": BLUE,
  "overdue-30": "#c48a2c",
  "overdue-60": "#b5473a",
  "overdue-60+": "#7d2a20",
};

/** Open settlements bucketed by days to / past due date. Ordinal risk scale, labelled on the axis. */
export function SettlementAgeingChart({ data, height = 260 }: { data: AgeingDatum[]; height?: number }) {
  const points = data.map((d) => ({ key: d.key, label: d.label, short: d.short, value: Number(d.paise), count: d.count }));
  return (
    <ChartFrame
      label={`Settlement ageing: ${data.map((d) => `${d.label} ${formatINR(d.paise)}`).join(", ")}`}
      empty={points.every((p) => p.value === 0)}
      emptyText="No open settlements — every disbursed request has been settled."
      height={height}
      table={{ headers: ["Bucket", "Settlements", "Amount"], rows: data.map((d) => [d.label, d.count, formatINR(d.paise)]) }}
    >
      <BarChart responsive data={points} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} style={{ width: "100%", height }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="short" tickLine={false} axisLine={{ stroke: GRID }} tick={{ ...axisTick, fontSize: 10 }} interval={0} />
        <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={compactTick} width={78} />
        <Tooltip
          cursor={{ fill: "rgba(20,43,67,0.04)" }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!active || !point) return null;
            return (
              <TooltipCard
                title={point.label}
                rows={[{ label: "Open settlements", paise: point.value, color: AGEING_COLORS[point.key] ?? NAVY }]}
                footer={`${point.count} settlement${point.count === 1 ? "" : "s"}`}
              />
            );
          }}
        />
        <Bar dataKey="value" name="Open settlements" radius={[4, 4, 0, 0]} maxBarSize={44}>
          {points.map((p) => (
            <Cell key={p.key} fill={AGEING_COLORS[p.key] ?? NAVY} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
