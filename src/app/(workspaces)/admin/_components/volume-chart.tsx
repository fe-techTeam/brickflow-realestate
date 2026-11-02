"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatINRCompact } from "@/lib/money";

export interface VolumePoint {
  label: string;
  invoicedPaise: string;
  financedPaise: string;
}

const SERIES = [
  { key: "invoiced", label: "Invoices submitted", color: "#2f6a9e" },
  { key: "financed", label: "Early payment accepted", color: "#b8862f" },
] as const;

/** Rupees as a chart number; display values are always formatted from the exact paise strings. */
function toRupees(paise: string): number {
  return Number(BigInt(paise) / 100n);
}

function axisTick(rupees: number): string {
  if (rupees === 0) return "₹0";
  return formatINRCompact(BigInt(Math.round(rupees)) * 100n).replace(".00", "");
}

type Row = { label: string; invoiced: number; financed: number; invoicedPaise: string; financedPaise: string };

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }>; label?: string | number }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Row | undefined;
  if (!row) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium text-navy">Week of {label}</p>
      {SERIES.map((s) => (
        <p key={s.key} className="flex items-center justify-between gap-6 py-0.5">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
          <span className="tabular font-medium text-slate-ink">{formatINRCompact(s.key === "invoiced" ? row.invoicedPaise : row.financedPaise)}</span>
        </p>
      ))}
    </div>
  );
}

export function VolumeChart({ data }: { data: VolumePoint[] }) {
  const rows: Row[] = data.map((d) => ({ ...d, invoiced: toRupees(d.invoicedPaise), financed: toRupees(d.financedPaise) }));
  return (
    <figure className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground" aria-hidden="true">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} barGap={2} barCategoryGap="28%" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#ece7db" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#d9d2c2" }} tick={{ fontSize: 11, fill: "#5f6b78" }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} width={64} tick={{ fontSize: 11, fill: "#5f6b78" }} tickFormatter={axisTick} />
            <Tooltip cursor={{ fill: "rgba(20,43,67,0.04)" }} content={(props) => <ChartTooltip active={props.active} payload={props.payload} label={props.label} />} />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={16} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">Weekly invoice value submitted and early payment accepted over the last {data.length} weeks.</figcaption>
      <table className="sr-only">
        <thead>
          <tr>
            <th scope="col">Week of</th>
            {SERIES.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{formatINRCompact(r.invoicedPaise)}</td>
              <td>{formatINRCompact(r.financedPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
