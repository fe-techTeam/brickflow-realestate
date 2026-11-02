"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { formatINR, formatINRCompact } from "@/lib/money";

export interface InvoiceValuePoint {
  label: string;
  submittedPaise: string;
  approvedPaise: string;
}

const SERIES = [
  { key: "submitted", label: "Invoiced", color: "#2d6cb0" },
  { key: "approved", label: "Builder-approved", color: "#2a8a5c" },
] as const;

/** Plot-only conversion; all displayed figures are formatted from exact paise strings. */
function toRupees(paise: string): number {
  return Number(BigInt(paise) / 100n);
}

function ChartTooltip({ active, payload, label }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload as InvoiceValuePoint;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium text-navy">{label}</p>
      {SERIES.map((series) => (
        <p key={series.key} className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: series.color }} />
            {series.label}
          </span>
          <span className="tabular font-medium text-slate-ink">{formatINR(series.key === "submitted" ? point.submittedPaise : point.approvedPaise)}</span>
        </p>
      ))}
    </div>
  );
}

export function InvoiceValueChart({ data }: { data: InvoiceValuePoint[] }) {
  const rows = data.map((d) => ({ ...d, submitted: toRupees(d.submittedPaise), approved: toRupees(d.approvedPaise) }));
  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground" aria-hidden="true">
        {SERIES.map((series) => (
          <span key={series.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: series.color }} />
            {series.label}
          </span>
        ))}
      </div>
      <div className="h-64 w-full" role="img" aria-label="Invoice value by invoice month: invoiced versus builder-approved amounts for the last six months">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} barGap={2} barCategoryGap="28%" margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#e3ddcf" strokeDasharray="0" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#d9d2c2" }} tick={{ fill: "#5f6b78", fontSize: 11 }} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={72}
              tick={{ fill: "#5f6b78", fontSize: 11 }}
              tickFormatter={(value: number) => formatINRCompact(BigInt(Math.round(value)) * 100n)}
            />
            <Tooltip cursor={{ fill: "rgba(20,43,67,0.04)" }} content={(props) => <ChartTooltip {...(props as TooltipContentProps<number, string>)} />} />
            {SERIES.map((series) => (
              <Bar key={series.key} dataKey={series.key} name={series.label} fill={series.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
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
