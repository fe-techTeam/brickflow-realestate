"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { ChartTooltipCard } from "@/components/common/chart-frame";
import { CHART_COLORS, chartBarProps, chartGridProps, chartXAxisProps, chartYAxisProps } from "@/components/common/chart-theme";
import { formatINR, formatINRCompact } from "@/lib/money";
import { CompactMoney } from "./money";

export interface InvoiceValuePoint {
  label: string;
  submittedPaise: string;
  approvedPaise: string;
}

const SERIES = [
  { key: "submitted", label: "Invoiced", color: CHART_COLORS.primary },
  { key: "approved", label: "Builder-approved", color: CHART_COLORS.positiveSoft },
] as const;

/** Plot-only conversion; all displayed figures are formatted from exact paise strings. */
function toRupees(paise: string): number {
  return Number(BigInt(paise) / 100n);
}

function ChartTooltip({ active, payload, label }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload as InvoiceValuePoint;
  return (
    <ChartTooltipCard
      title={label}
      rows={SERIES.map((series) => ({ label: series.label, color: series.color, value: formatINR(series.key === "submitted" ? point.submittedPaise : point.approvedPaise) }))}
    />
  );
}

export function InvoiceValueChart({ data }: { data: InvoiceValuePoint[] }) {
  const rows = data.map((d) => ({ ...d, submitted: toRupees(d.submittedPaise), approved: toRupees(d.approvedPaise) }));
  const invoiced = data.reduce((sum, d) => sum + BigInt(d.submittedPaise), 0n);
  const approved = data.reduce((sum, d) => sum + BigInt(d.approvedPaise), 0n);
  const ratio = invoiced > 0n ? Number((approved * 1000n + invoiced / 2n) / invoiced) / 10 : null;

  return (
    <figure className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-4 border-b border-hairline pb-5">
        {SERIES.map((series) => (
          <div key={series.key} className="min-w-0">
            <p className="flex items-center gap-2 text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              <span aria-hidden="true" className="h-3 w-[3px] rounded-full" style={{ background: series.color }} />
              {series.label}
            </p>
            <CompactMoney paise={series.key === "submitted" ? invoiced : approved} className="mt-2 block text-[1.25rem] font-medium text-basalt" />
          </div>
        ))}
        <div className="min-w-0">
          <p className="text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Approval ratio</p>
          <p className="mt-2 text-[1.25rem] font-medium text-basalt tabular">{ratio === null ? "—" : `${ratio.toFixed(ratio % 1 ? 1 : 0)}%`}</p>
        </div>
      </div>
      <div className="h-52 w-full" role="img" aria-label="Invoice value by invoice month: invoiced versus builder-approved amounts for the last six months">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} barGap={3} barCategoryGap="34%" margin={{ top: 4, right: 0, bottom: 0, left: -8 }}>
            <CartesianGrid {...chartGridProps} />
            <XAxis dataKey="label" {...chartXAxisProps} />
            <YAxis {...chartYAxisProps} width={64} tickCount={4} tickFormatter={(value: number) => formatINRCompact(BigInt(Math.round(value)) * 100n)} />
            <Tooltip cursor={{ fill: CHART_COLORS.cursor }} content={(props) => <ChartTooltip {...(props as TooltipContentProps<number, string>)} />} />
            {SERIES.map((series) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                name={series.label}
                fill={series.color}
                {...chartBarProps}
                maxBarSize={18}
                animationDuration={600}
                animationEasing="ease-out"
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Invoice value by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Invoiced</th>
            <th scope="col">Builder-approved</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{formatINR(d.submittedPaise)}</td>
              <td>{formatINR(d.approvedPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
