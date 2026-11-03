import Link from "next/link";
import { cn } from "@/lib/utils";
import { Money } from "./money";

export interface ProjectValueRow {
  id: string;
  name: string;
  code: string;
  approved: bigint;
  awaiting: bigint;
}

export const PROJECT_SERIES = [
  { key: "approved", label: "Approved", swatch: "bg-leaf" },
  { key: "awaiting", label: "Awaiting decision", swatch: "bg-kota" },
] as const;

export function ProjectValueLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[0.75rem] text-muted-foreground", className)}>
      {PROJECT_SERIES.map((s) => (
        <li key={s.key} className="flex items-center gap-2">
          <span aria-hidden="true" className={cn("h-2 w-4 rounded-[2px]", s.swatch)} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

const pct = (part: bigint, whole: bigint) => (whole === 0n ? 0 : Number((part * 10000n) / whole) / 100);

/** Horizontal stacked bars of approved versus open invoice value per project, scaled to the largest project. */
export function ProjectValueBars({ rows }: { rows: ProjectValueRow[] }) {
  const max = rows.reduce((m, r) => (r.approved + r.awaiting > m ? r.approved + r.awaiting : m), 0n);
  return (
    <ul className="divide-y divide-[#eceeeb]">
      {rows.map((row) => {
        const total = row.approved + row.awaiting;
        return (
          <li key={row.id} className="py-5 first:pt-1 last:pb-1">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <Link href={`/builder/approvals?view=all&project=${row.id}`} className="group flex items-baseline gap-2.5">
                <span className="font-display text-[1.1875rem] leading-none font-semibold text-basalt decoration-kota/60 underline-offset-4 group-hover:underline">{row.name}</span>
                <span className="font-mono text-[0.6875rem] text-muted-foreground">{row.code}</span>
              </Link>
              <Money paise={total} compact size="md" className="font-medium text-basalt" />
            </div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[#eceeeb]" aria-hidden="true">
              <div className="flex h-full gap-[2px]" style={{ width: `${pct(total, max)}%` }}>
                {row.approved > 0n && <span className="h-full rounded-l-full bg-leaf last:rounded-r-full" style={{ width: `${pct(row.approved, total)}%` }} />}
                {row.awaiting > 0n && <span className="h-full rounded-r-full bg-kota first:rounded-l-full" style={{ width: `${pct(row.awaiting, total)}%` }} />}
              </div>
            </div>
            <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[0.75rem] text-muted-foreground">
              <div className="flex items-baseline gap-1.5">
                <dt>Approved</dt>
                <dd>
                  <Money paise={row.approved} compact className="text-[0.75rem] font-medium text-leaf" />
                </dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt>Awaiting decision</dt>
                <dd>
                  <Money paise={row.awaiting} compact className="text-[0.75rem] font-medium text-[#8a6a2e]" />
                </dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
