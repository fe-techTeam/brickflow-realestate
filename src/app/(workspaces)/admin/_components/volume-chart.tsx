"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatINRCompact } from "@/lib/money";

export interface VolumePoint {
  label: string;
  invoicedPaise: string;
  financedPaise: string;
}

const SERIES = [
  { key: "invoiced", label: "Invoices submitted", color: "#222d2b" },
  { key: "financed", label: "Accepted for early payment", color: "#a89a84" },
] as const;

const TICK = { fontSize: 11, fill: "#8b9692", fontFamily: "var(--font-inter), ui-sans-serif, system-ui", fontVariantNumeric: "tabular-nums" };

/** Rupees as a chart number; display values are always formatted from the exact paise strings. */
function toRupees(paise: string): number {
  return Number(BigInt(paise) / 100n);
}

function axisTick(rupees: number): string {
  const trim = (n: number) => Number(n.toFixed(1)).toString();
  if (rupees >= 1_00_00_000) return `${trim(rupees / 1_00_00_000)} Cr`;
  if (rupees >= 1_00_000) return `${trim(rupees / 1_00_000)} L`;
  if (rupees >= 1_000) return `${trim(rupees / 1_000)}k`;
  return String(rupees);
}

type Row = { label: string; invoiced: number; financed: number; invoicedPaise: string; financedPaise: string };

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }>; label?: string | number }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Row | undefined;
  if (!row) return null;
  return (
    <div className="min-w-52 rounded-lg border border-border bg-card px-4 py-3 text-xs shadow-[0_16px_40px_-20px_rgba(34, 45, 43,0.45)]">
      <p className="mb-2 text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Week of {label}</p>
      {SERIES.map((s) => (
        <p key={s.key} className="flex items-center justify-between gap-6 py-0.5">
          <span className="flex items-center gap-2 text-ink">
            <span aria-hidden="true" className="h-2 w-3 rounded-[2px]" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
          <span className="tabular font-medium text-basalt">{formatINRCompact(s.key === "invoiced" ? row.invoicedPaise : row.financedPaise)}</span>
        </p>
      ))}
    </div>
  );
}

export function VolumeChart({ data }: { data: VolumePoint[] }) {
  const rows: Row[] = data.map((d) => ({ ...d, invoiced: toRupees(d.invoicedPaise), financed: toRupees(d.financedPaise) }));
  return (
    <figure>
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-ink" aria-hidden="true">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-2">
            <span className="h-2 w-3.5 rounded-[2px]" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto text-[0.6875rem] text-muted-foreground">Weekly totals, ₹</span>
      </div>
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} barGap={3} barCategoryGap="34%" margin={{ top: 6, right: 0, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="#e6e8e4" strokeDasharray="2 4" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#d4d8d3" }} tick={TICK} interval="preserveStartEnd" minTickGap={18} tickMargin={10} />
            <YAxis tickLine={false} axisLine={false} width={52} tick={TICK} tickFormatter={axisTick} />
            <Tooltip cursor={{ fill: "rgba(168, 154, 132,0.08)" }} content={(props) => <ChartTooltip active={props.active} payload={props.payload} label={props.label} />} />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={12} isAnimationActive={false} />
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
