import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type AgeTone = "fresh" | "steady" | "ageing" | "late";

/** Review ageing bands: under a day is fresh, 3+ days needs attention, a week or more is late. */
export function ageTone(days: number): AgeTone {
  if (days < 1) return "fresh";
  if (days < 3) return "steady";
  if (days < 7) return "ageing";
  return "late";
}

const TONE = {
  fresh: { text: "text-leaf", fill: "bg-leaf", track: "bg-leaf-100" },
  steady: { text: "text-ink", fill: "bg-basalt/60", track: "bg-[#ebe7dd]" },
  ageing: { text: "text-[#8a5a12]", fill: "bg-[#c48a2c]", track: "bg-[#f6ead2]" },
  late: { text: "text-[#8a1f37]", fill: "bg-[#b8324f]", track: "bg-[#f6e1dd]" },
} as const;

export function ageLabel(days: number): string {
  if (days < 1) return "Today";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** Days waiting with a seven-segment meter, one segment per day. */
export function AgeingMeter({ days, className, label = true }: { days: number; className?: string; label?: boolean }) {
  const tone = TONE[ageTone(days)];
  const filled = Math.min(7, Math.max(1, days + 1));
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span aria-hidden="true" className="flex gap-[3px]">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className={cn("h-2.5 w-[5px] rounded-[1.5px]", i < filled ? tone.fill : tone.track)} />
        ))}
      </span>
      {label && <span className={cn("tabular text-[0.75rem] font-medium whitespace-nowrap", tone.text)}>{ageLabel(days)}</span>}
    </span>
  );
}

export function ageTextClass(days: number): string {
  return TONE[ageTone(days)].text;
}

export interface Bucket {
  key: string;
  label: string;
  count: number;
  value: bigint;
  tone: "leaf" | "basalt" | "slate" | "amber" | "rose" | "kota";
}

const BUCKET_FILL: Record<Bucket["tone"], string> = {
  leaf: "bg-leaf",
  basalt: "bg-basalt",
  slate: "bg-[#8b9692]",
  amber: "bg-[#c48a2c]",
  rose: "bg-[#b8324f]",
  kota: "bg-kota",
};

/** Proportional bar of value by bucket with a labelled key underneath (ageing, maturity). */
export function BucketBar({ buckets, format }: { buckets: Bucket[]; format: (paise: bigint) => ReactNode }) {
  const total = buckets.reduce((sum, b) => sum + b.value, 0n);
  return (
    <div>
      <div className="flex h-3 w-full gap-[3px] overflow-hidden rounded-full bg-[#eceeeb]" aria-hidden="true">
        {total > 0n &&
          buckets
            .filter((b) => b.value > 0n)
            .map((b) => <span key={b.key} className={cn("h-full first:rounded-l-full last:rounded-r-full", BUCKET_FILL[b.tone])} style={{ width: `${Number((b.value * 10000n) / total) / 100}%` }} />)}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(7.25rem,1fr))]">
        {buckets.map((b) => (
          <div key={b.key} className="min-w-0">
            <dt className="flex items-center gap-2 text-[0.6875rem] font-medium text-muted-foreground">
              <span aria-hidden="true" className={cn("size-2 rounded-[2px]", BUCKET_FILL[b.tone])} />
              {b.label}
            </dt>
            <dd className="mt-1.5 text-basalt">
              {format(b.value)}
              <span className="tabular ml-1.5 text-[0.75rem] text-muted-foreground">· {b.count}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
