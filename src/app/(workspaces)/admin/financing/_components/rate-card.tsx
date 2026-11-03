import type { ReactNode } from "react";
import Link from "next/link";
import type { ProgrammeStatus } from "@/generated/prisma/enums";
import { StatusBadge } from "@/components/common/status-badge";
import { calculateDiscount } from "@/lib/financing";
import { formatDate } from "@/lib/format";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Monogram } from "../../_components/editorial";
import { Rate } from "../../_components/figures";
import { plural } from "../../_components/labels";
import { RefCode } from "../../_components/ledger";
import { ProgrammeFormDialog } from "./programme-form-dialog";
import { ProgrammeStatusAction } from "./programme-status-action";
import type { ProgrammeRow } from "./types";

const SAMPLE_PAISE = 5_00_000_00n;

/** Status transitions offered as one-click actions for each programme status. */
export const QUICK_ACTIONS: Record<ProgrammeStatus, ("ACTIVE" | "SUSPENDED" | "CLOSED")[]> = {
  DRAFT: ["ACTIVE", "CLOSED"],
  ACTIVE: ["SUSPENDED", "CLOSED"],
  SUSPENDED: ["ACTIVE", "CLOSED"],
  CLOSED: [],
};

export interface RateCardData {
  row: ProgrammeRow;
  builderId: string;
  builderInactive: boolean;
  name: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  offerValidityDays: number;
  offers: number;
}

/** A programme presented as a rate card: builder, financier, agreed discount, window and actions. */
export function RateCard({ data }: { data: RateCardData }) {
  const { row } = data;
  const sample = calculateDiscount(SAMPLE_PAISE, row.discountRateBps);
  const active = row.status === "ACTIVE";
  const draft = row.status === "DRAFT";

  return (
    <article
      aria-label={`${row.builderName}, ${row.code}`}
      className={cn(
        "relative flex animate-fade-up flex-col overflow-hidden rounded-xl border bg-card shadow-[0_24px_48px_-36px_rgba(34, 45, 43,0.45)]",
        active && "border-border/90",
        draft && "border-dashed border-basalt/25 bg-paper/40",
        row.status === "SUSPENDED" && "border-warning/30",
        row.status === "CLOSED" && "border-border/70 opacity-80",
      )}
    >
      {active && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-leaf via-leaf/80 to-kota/70" />}
      {row.status === "SUSPENDED" && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-warning/70" />}

      <header className="flex items-start gap-3.5 px-6 pt-7">
        <Monogram name={row.builderName} tone={active ? "basalt" : "paper"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <RefCode className="text-[0.6875rem] text-muted-foreground">{row.code}</RefCode>
            <StatusBadge kind="programme" status={row.status} />
          </div>
          <div className="mt-2 min-h-[4.75rem]">
            <Link
              href={`/admin/organisations/${data.builderId}`}
              className="line-clamp-2 font-display text-[1.375rem] leading-tight font-semibold text-basalt hover:underline"
              title={row.builderName}
            >
              {row.builderName}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              with <span className="font-medium text-ink">{row.financierName}</span>
            </p>
          </div>
        </div>
      </header>

      <div className="px-6 pt-7">
        <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-muted-foreground uppercase">Agreed discount</p>
        <div className="mt-2 flex items-end justify-between gap-4">
          <Rate bps={row.discountRateBps} size="hero" className={cn(!active && "text-basalt/80")} />
          <p className="max-w-28 pb-1 text-right text-[0.6875rem] leading-snug text-muted-foreground">of the builder-approved amount</p>
        </div>
        <span aria-hidden="true" className="mt-5 block h-px bg-gradient-to-r from-kota via-kota/40 to-transparent" />
        <p className="tabular mt-3 text-xs text-muted-foreground">
          On {formatINR(SAMPLE_PAISE, { showPaise: false })}, partner receives{" "}
          <span className="font-semibold text-leaf">{formatINR(sample.netPayablePaise, { showPaise: sample.netPayablePaise % 100n !== 0n })}</span>
        </p>
      </div>

      <dl className="mx-6 mt-6 grid grid-cols-3 gap-4 border-y border-border/70 py-4 text-xs">
        <div className="min-w-0">
          <dt className="text-[0.625rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Window</dt>
          <dd className="tabular mt-1.5 leading-snug text-basalt">
            {formatDate(data.effectiveFrom)}
            <span className="block text-muted-foreground">{data.effectiveTo ? `to ${formatDate(data.effectiveTo)}` : "open-ended"}</span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[0.625rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Validity</dt>
          <dd className="tabular mt-1.5 leading-snug text-basalt">
            {data.offerValidityDays} days
            <span className="block text-muted-foreground">per offer</span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[0.625rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Activity</dt>
          <dd className="tabular mt-1.5 leading-snug text-basalt">
            {plural(row.requests, "request")}
            <span className={cn("block", row.openOffers > 0 ? "font-medium text-kota-600" : "text-muted-foreground")}>
              {row.openOffers > 0 ? `${row.openOffers} open offer${row.openOffers === 1 ? "" : "s"}` : plural(data.offers, "offer")}
            </span>
          </dd>
        </div>
      </dl>

      {data.builderInactive && <p className="mx-6 mt-3 text-xs text-warning">The builder is inactive, so no new offers are produced.</p>}

      <footer className="mt-auto px-6 pt-4 pb-5">
        <div className="flex flex-wrap justify-end gap-2">
          <ProgrammeFormDialog mode="edit" programme={row} />
          {QUICK_ACTIONS[row.status].map((target) => (
            <ProgrammeStatusAction key={target} programme={row} target={target} />
          ))}
        </div>
      </footer>
    </article>
  );
}

/** Placeholder card for a builder with no active programme. */
export function UnconfiguredCard({ name, children }: { name: string; children: ReactNode }) {
  return (
    <article className="flex animate-fade-up flex-col items-start justify-between gap-6 rounded-xl border border-dashed border-kota/50 bg-kota-100/25 px-6 py-7">
      <div className="flex items-start gap-4">
        <Monogram name={name} tone="kota" />
        <div>
          <p className="font-display text-[1.375rem] leading-tight font-semibold text-basalt">{name}</p>
          <p className="mt-1 text-xs text-muted-foreground">No active programme</p>
        </div>
      </div>
      <p className="text-[0.8125rem] leading-relaxed text-ink">
        Channel partners of this builder cannot request early payment until a rate agreed with Veefin is recorded and activated.
      </p>
      {children}
    </article>
  );
}
