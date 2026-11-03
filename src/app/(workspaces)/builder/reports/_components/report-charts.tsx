"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartAxisTick } from "@/components/common/chart-theme";
import { axisRupees, CHART_COLORS, CHART_INK, compactRupees } from "../../_lib/chart";
import { ChartDataTable, ChartLegend, ChartTooltip, type SeriesDef } from "../../_components/chart-kit";

const AXIS_TICK = chartAxisTick;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export interface MonthlyDatum {
  label: string;
  count: number;
  submitted: number;
  approved: number;
}

const MONTHLY_SERIES: SeriesDef[] = [
  { key: "submitted", label: "Invoice value submitted", color: CHART_COLORS.navySoft },
  { key: "approved", label: "Approved value", color: CHART_COLORS.heritage },
];

export function MonthlyVolumeChart({ data }: { data: MonthlyDatum[] }) {
  return (
    <figure>
      <ChartLegend series={MONTHLY_SERIES} className="mb-4" />
      <div className="h-64" role="img" aria-label="Monthly invoice value submitted and approved over the last six months">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 256 }}>
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke={CHART_INK.grid} strokeDasharray="2 4" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: CHART_INK.grid }} tick={AXIS_TICK} />
            <YAxis tickFormatter={axisRupees} tickLine={false} axisLine={false} width={60} tick={AXIS_TICK} />
            <Tooltip
              cursor={{ fill: CHART_INK.cursor }}
              content={({ active, payload, label }) => {
                const datum = payload?.[0]?.payload as MonthlyDatum | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    label={label}
                    rows={(payload ?? []).map((p) => ({ name: p.name, value: p.value, color: p.color, dataKey: p.dataKey }))}
                    format={compactRupees}
                    footer={datum ? `${plural(datum.count, "invoice")} submitted` : undefined}
                  />
                );
              }}
            />
            {MONTHLY_SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} animationDuration={700} maxBarSize={28} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        caption="Monthly invoice volume"
        columns={["Month", "Invoices", "Submitted value", "Approved value"]}
        rows={data.map((d) => [d.label, d.count, compactRupees(d.submitted), compactRupees(d.approved)])}
      />
    </figure>
  );
}

export function TurnaroundChart({ data }: { data: { label: string; count: number }[] }) {
  return (
    <figure>
      <div className="h-64" role="img" aria-label="Distribution of approval turnaround times for decided invoices">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 256 }}>
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke={CHART_INK.grid} strokeDasharray="2 4" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: CHART_INK.grid }} tick={AXIS_TICK} interval={0} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} tick={AXIS_TICK} />
            <Tooltip
              cursor={{ fill: CHART_INK.cursor }}
              content={({ active, payload, label }) => (
                <ChartTooltip
                  active={active}
                  label={`Decided in ${String(label).toLowerCase()}`}
                  rows={(payload ?? []).map((p) => ({ name: "Invoices", value: p.value, color: CHART_COLORS.navy, dataKey: p.dataKey }))}
                  format={(v) => String(v)}
                />
              )}
            />
            <Bar dataKey="count" name="Invoices" fill={CHART_COLORS.navy} radius={[4, 4, 0, 0]} animationDuration={700} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable caption="Approval turnaround distribution" columns={["Time to decision", "Invoices"]} rows={data.map((d) => [d.label, d.count])} />
    </figure>
  );
}

export interface ProjectFinancingDatum {
  name: string;
  financed: number;
  notFinanced: number;
  financedCount: number;
  notFinancedCount: number;
}

const FINANCING_SERIES: SeriesDef[] = [
  { key: "financed", label: "Financed by Veefin", color: CHART_COLORS.gold },
  { key: "notFinanced", label: "Not financed", color: CHART_COLORS.navy },
];

export function FinancingByProjectChart({ data }: { data: ProjectFinancingDatum[] }) {
  return (
    <figure>
      <ChartLegend series={FINANCING_SERIES} className="mb-4" />
      <div className="h-64" role="img" aria-label="Approved invoice value by project, split into financed and not financed">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 256 }}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }} barCategoryGap="32%">
            <CartesianGrid horizontal={false} stroke={CHART_INK.grid} strokeDasharray="2 4" />
            <XAxis type="number" tickFormatter={axisRupees} tickLine={false} axisLine={false} tick={AXIS_TICK} />
            <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={124} tick={{ ...AXIS_TICK, fontSize: 12 }} />
            <Tooltip
              cursor={{ fill: CHART_INK.cursor }}
              content={({ active, payload, label }) => (
                <ChartTooltip
                  active={active}
                  label={label}
                  rows={(payload ?? []).map((p) => ({ name: p.name, value: p.value, color: p.color, dataKey: p.dataKey }))}
                  format={compactRupees}
                />
              )}
            />
            <Bar dataKey="financed" name="Financed by Veefin" stackId="value" fill={CHART_COLORS.gold} stroke="#ffffff" strokeWidth={2} maxBarSize={30} animationDuration={700} />
            <Bar dataKey="notFinanced" name="Not financed" stackId="value" fill={CHART_COLORS.navy} stroke="#ffffff" strokeWidth={2} radius={[0, 3, 3, 0]} animationDuration={700} maxBarSize={30} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        caption="Financed versus not financed by project"
        columns={["Project", "Financed", "Not financed"]}
        rows={data.map((d) => [d.name, `${compactRupees(d.financed)} (${d.financedCount})`, `${compactRupees(d.notFinanced)} (${d.notFinancedCount})`])}
      />
    </figure>
  );
}

export interface SettlementProfileDatum {
  status: "NOT_DUE" | "DUE" | "OVERDUE" | "SETTLED";
  label: string;
  value: number;
  count: number;
}

const SETTLEMENT_COLORS: Record<SettlementProfileDatum["status"], string> = {
  SETTLED: CHART_COLORS.heritage,
  NOT_DUE: CHART_COLORS.navy,
  DUE: CHART_COLORS.gold,
  OVERDUE: CHART_COLORS.rose,
};

export function SettlementProfileChart({ data }: { data: SettlementProfileDatum[] }) {
  return (
    <figure>
      <div className="h-64" role="img" aria-label="Settlement value owed to Veefin by status">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 256 }}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid horizontal={false} stroke={CHART_INK.grid} strokeDasharray="2 4" />
            <XAxis type="number" tickFormatter={axisRupees} tickLine={false} axisLine={false} tick={AXIS_TICK} />
            <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={72} tick={{ ...AXIS_TICK, fontSize: 12 }} />
            <Tooltip
              cursor={{ fill: CHART_INK.cursor }}
              content={({ active, payload, label }) => {
                const datum = payload?.[0]?.payload as SettlementProfileDatum | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    label={label}
                    rows={datum ? [{ name: "Amount", value: datum.value, color: SETTLEMENT_COLORS[datum.status], dataKey: "value" }] : []}
                    format={compactRupees}
                    footer={datum ? plural(datum.count, "settlement") : undefined}
                  />
                );
              }}
            />
            <Bar dataKey="value" name="Amount" radius={[0, 3, 3, 0]} animationDuration={700} maxBarSize={28}>
              {data.map((d) => (
                <Cell key={d.status} fill={SETTLEMENT_COLORS[d.status]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable caption="Settlement profile" columns={["Status", "Settlements", "Amount"]} rows={data.map((d) => [d.label, d.count, compactRupees(d.value)])} />
    </figure>
  );
}
