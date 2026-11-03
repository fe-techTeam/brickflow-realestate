"use client";

import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, ChartTooltipCard } from "@/components/common/chart-frame";
import {
  CHART_COLORS,
  chartAxisTick,
  chartBarProps,
  chartGridProps,
  chartTooltipProps,
  chartXAxisProps,
  chartYAxisProps,
} from "@/components/common/chart-theme";
import { formatINR, formatINRCompact } from "@/lib/money";

const compactTick = (value: number) => (value === 0 ? "₹0" : formatINRCompact(Math.round(value)));
const inr = (paise: number) => formatINR(Math.round(paise));
const tooltipCursor = chartTooltipProps.cursor;
const categoryTick = { ...chartAxisTick, fill: CHART_COLORS.inkStrong };

function BarGradients() {
  return (
    <defs>
      <linearGradient id="fin-basalt" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor={CHART_COLORS.primary} />
      </linearGradient>
      <linearGradient id="fin-kota" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffd57c" />
        <stop offset="100%" stopColor={CHART_COLORS.accent} />
      </linearGradient>
      <linearGradient id="fin-leaf-h" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={CHART_COLORS.positive} />
        <stop offset="100%" stopColor="#45c99d" />
      </linearGradient>
    </defs>
  );
}

export interface MonthlyVolumeDatum {
  label: string;
  paise: string;
  count: number;
}

/** Disbursed volume per month; the latest month is picked out in stone. */
export function MonthlyVolumeChart({ data, height = 260 }: { data: MonthlyVolumeDatum[]; height?: number }) {
  const points = data.map((d) => ({ label: d.label, value: Number(d.paise), count: d.count }));
  const lastIndex = points.length - 1;
  return (
    <ChartFrame
      bare
      height={height}
      label={`Disbursed volume by month: ${data.map((d) => `${d.label} ${formatINR(d.paise)}`).join(", ")}`}
      empty={points.every((p) => p.value === 0)}
      emptyText="No simulated payouts in this period yet. Volume appears here once a disbursement is confirmed."
      legend={[
        { label: "Disbursed, net to channel partners", color: CHART_COLORS.primary },
        { label: "Current month", color: CHART_COLORS.kota },
      ]}
      table={{ headers: ["Month", "Payouts", "Disbursed"], rows: data.map((d) => [d.label, d.count, formatINR(d.paise)]) }}
    >
      <BarChart responsive data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} style={{ width: "100%", height }}>
        <BarGradients />
        <CartesianGrid {...chartGridProps} />
        <XAxis dataKey="label" {...chartXAxisProps} interval="preserveStartEnd" />
        <YAxis {...chartYAxisProps} tickFormatter={compactTick} />
        <Tooltip
          cursor={tooltipCursor}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!active || !point) return null;
            return (
              <ChartTooltipCard
                title={point.label}
                rows={[{ label: "Disbursed", value: inr(point.value), color: CHART_COLORS.kota }]}
                footer={`${point.count} simulated payout${point.count === 1 ? "" : "s"}`}
              />
            );
          }}
        />
        <Bar dataKey="value" name="Disbursed" {...chartBarProps} maxBarSize={30}>
          {points.map((p, i) => (
            <Cell key={p.label} fill={i === lastIndex ? "url(#fin-kota)" : "url(#fin-basalt)"} />
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
      bare
      height={height}
      label={`${seriesLabel} by builder: ${data.map((d) => `${d.name} ${formatINR(d.paise)}`).join(", ")}`}
      empty={points.every((p) => p.value === 0)}
      emptyText={emptyText}
      table={{ headers: ["Builder", seriesLabel], rows: data.map((d) => [d.name, formatINR(d.paise)]) }}
    >
      <BarChart responsive layout="vertical" data={points} margin={{ top: 4, right: 16, bottom: 0, left: 0 }} style={{ width: "100%", height }}>
        <BarGradients />
        <CartesianGrid {...chartGridProps} vertical horizontal={false} />
        <XAxis type="number" {...chartXAxisProps} axisLine={false} tickFormatter={compactTick} />
        <YAxis type="category" dataKey="name" {...chartYAxisProps} tick={categoryTick} width={140} />
        <Tooltip
          cursor={tooltipCursor}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!active || !point) return null;
            return <ChartTooltipCard title={point.name} rows={[{ label: seriesLabel, value: inr(point.value), color: CHART_COLORS.positive }]} />;
          }}
        />
        <Bar dataKey="value" name={seriesLabel} fill="url(#fin-leaf-h)" radius={[0, 4, 4, 0]} maxBarSize={16} />
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
      bare
      height={height}
      label={`Exposure by builder: ${data.map((d) => `${d.name} outstanding ${formatINR(d.outstanding)}, committed ${formatINR(d.committed)}`).join("; ")}`}
      empty={points.every((p) => p.outstanding === 0 && p.committed === 0)}
      emptyText="No open exposure. Every disbursed request has been settled and nothing is awaiting payout."
      legend={[
        { label: "Outstanding settlement", color: CHART_COLORS.primary },
        { label: "Approved, not disbursed", color: CHART_COLORS.kota },
      ]}
      table={{
        headers: ["Builder", "Outstanding settlement", "Approved, not disbursed"],
        rows: data.map((d) => [d.name, formatINR(d.outstanding), formatINR(d.committed)]),
      }}
    >
      <BarChart responsive layout="vertical" data={points} margin={{ top: 4, right: 16, bottom: 0, left: 0 }} style={{ width: "100%", height }}>
        <CartesianGrid {...chartGridProps} vertical horizontal={false} />
        <XAxis type="number" {...chartXAxisProps} axisLine={false} tickFormatter={compactTick} />
        <YAxis type="category" dataKey="name" {...chartYAxisProps} tick={categoryTick} width={140} />
        <Tooltip
          cursor={tooltipCursor}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!active || !point) return null;
            return (
              <ChartTooltipCard
                title={point.name}
                rows={[
                  { label: "Outstanding settlement", value: inr(point.outstanding), color: CHART_COLORS.primary },
                  { label: "Approved, not disbursed", value: inr(point.committed), color: CHART_COLORS.kota },
                ]}
                footer={`Total ${inr(point.outstanding + point.committed)}`}
              />
            );
          }}
        />
        <Bar dataKey="outstanding" name="Outstanding settlement" stackId="exposure" fill={CHART_COLORS.primary} stroke={CHART_COLORS.surface} strokeWidth={2} maxBarSize={16} />
        <Bar
          dataKey="committed"
          name="Approved, not disbursed"
          stackId="exposure"
          fill={CHART_COLORS.kota}
          stroke={CHART_COLORS.surface}
          strokeWidth={2}
          radius={[0, 4, 4, 0]}
          maxBarSize={16}
        />
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

/** Ordinal risk scale from not-yet-due (basalt) to long overdue (deep red). */
const AGEING_COLORS: Record<string, string> = {
  "not-due-30": CHART_COLORS.primarySoft,
  "not-due": CHART_COLORS.primary,
  "overdue-30": CHART_COLORS.warning,
  "overdue-60": "#ff7b6e",
  "overdue-60+": CHART_COLORS.negative,
};

/** Open settlements bucketed by days to / past due date, labelled on the axis. */
export function SettlementAgeingChart({ data, height = 260 }: { data: AgeingDatum[]; height?: number }) {
  const points = data.map((d) => ({ key: d.key, label: d.label, short: d.short, value: Number(d.paise), count: d.count }));
  return (
    <ChartFrame
      bare
      height={height}
      label={`Settlement ageing: ${data.map((d) => `${d.label} ${formatINR(d.paise)}`).join(", ")}`}
      empty={points.every((p) => p.value === 0)}
      emptyText="No open settlements. Every disbursed request has been settled by its builder."
      table={{ headers: ["Bucket", "Settlements", "Amount"], rows: data.map((d) => [d.label, d.count, formatINR(d.paise)]) }}
    >
      <BarChart responsive data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} style={{ width: "100%", height }}>
        <CartesianGrid {...chartGridProps} />
        <XAxis dataKey="short" {...chartXAxisProps} tick={{ ...chartAxisTick, fontSize: 10 }} interval={0} />
        <YAxis {...chartYAxisProps} tickFormatter={compactTick} />
        <Tooltip
          cursor={tooltipCursor}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!active || !point) return null;
            return (
              <ChartTooltipCard
                title={point.label}
                rows={[{ label: "Open settlements", value: inr(point.value), color: AGEING_COLORS[point.key] ?? CHART_COLORS.primary }]}
                footer={`${point.count} settlement${point.count === 1 ? "" : "s"}`}
              />
            );
          }}
        />
        <Bar dataKey="value" name="Open settlements" {...chartBarProps} maxBarSize={40}>
          {points.map((p) => (
            <Cell key={p.key} fill={AGEING_COLORS[p.key] ?? CHART_COLORS.primary} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
