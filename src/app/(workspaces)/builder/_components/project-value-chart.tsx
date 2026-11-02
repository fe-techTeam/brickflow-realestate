"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisRupees, CHART_COLORS, CHART_INK, compactRupees } from "../_lib/chart";
import { ChartDataTable, ChartLegend, ChartTooltip, type SeriesDef } from "./chart-kit";

export interface ProjectValueDatum {
  name: string;
  code: string;
  approved: number;
  awaiting: number;
}

const SERIES: SeriesDef[] = [
  { key: "approved", label: "Approved value", color: CHART_COLORS.green },
  { key: "awaiting", label: "Awaiting decision", color: CHART_COLORS.blue },
];

/** Grouped bars of approved vs open invoice value per project (whole rupees). */
export function ProjectValueChart({ data }: { data: ProjectValueDatum[] }) {
  return (
    <figure>
      <ChartLegend series={SERIES} className="mb-4" />
      <div className="h-64 w-full" role="img" aria-label="Bar chart of approved and awaiting invoice value by project">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 256 }}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
            <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: CHART_INK.grid }} tick={{ fill: CHART_INK.axis, fontSize: 12 }} />
            <YAxis tickFormatter={axisRupees} tickLine={false} axisLine={false} width={64} tick={{ fill: CHART_INK.axis, fontSize: 11 }} />
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
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={44} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        caption="Invoice value by project"
        columns={["Project", "Approved value", "Awaiting decision"]}
        rows={data.map((d) => [`${d.name} (${d.code})`, compactRupees(d.approved), compactRupees(d.awaiting)])}
      />
    </figure>
  );
}
