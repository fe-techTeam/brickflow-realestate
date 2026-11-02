import type { Metadata } from "next";
import Link from "next/link";
import { BadgePercent, Info } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DetailList, EmptyState } from "@/components/common/panels";
import { StatusBadge } from "@/components/common/status-badge";
import { formatDate } from "@/lib/format";
import { formatBps } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { listProgrammes } from "@/server/services/admin";

export const metadata: Metadata = { title: "Financing programmes · Veefin Finance" };

export default async function ProgrammesPage() {
  const actor = await requireWorkspace("finance");
  const programmes = await listProgrammes(actor);

  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Financing programmes"
        description="The early-payment facilities Veefin offers on each builder's channel partner invoices. This view is read-only."
      />

      <div className="mb-6 flex animate-fade-up gap-3 rounded-lg border border-gold/30 bg-gold-100/60 px-5 py-4 text-sm leading-relaxed text-slate-ink">
        <Info className="mt-0.5 size-4 shrink-0 text-gold-600" aria-hidden="true" />
        <p>
          Discount rates are agreed between Veefin and each builder <strong className="font-semibold text-navy">off-platform</strong> and configured in
          BrickFlow by the Super Admin. Channel partners always see the fixed agreed rate; a rate change applies to new offers only, and every accepted
          request keeps the rate in its snapshot.
        </p>
      </div>

      {programmes.length === 0 ? (
        <div className="surface">
          <EmptyState icon={BadgePercent} title="No programmes configured" description="Programmes appear here once the Super Admin sets one up for a builder." />
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {programmes.map((p) => (
            <article key={p.id} className="surface animate-fade-up overflow-hidden">
              <header className="flex flex-col gap-4 border-b border-border/80 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                <div className="min-w-0">
                  <p className="eyebrow tabular mb-1 text-gold-600">{p.code}</p>
                  <h2 className="font-display text-xl leading-tight font-semibold">{p.name}</h2>
                  <Link href={`/finance/builders/${p.builder.id}`} className="mt-1 inline-block text-sm font-medium text-navy hover:underline">
                    {p.builder.name}
                  </Link>
                </div>
                <div className="flex shrink-0 items-center gap-4 sm:flex-col sm:items-end sm:gap-2">
                  <p className="tabular font-display text-[2.25rem] leading-none font-semibold text-heritage">{formatBps(p.discountRateBps)}</p>
                  <StatusBadge kind="programme" status={p.status} />
                </div>
              </header>
              <div className="px-5 py-5 sm:px-6">
                <DetailList
                  columns={3}
                  items={[
                    { label: "Effective from", value: formatDate(p.effectiveFrom) },
                    { label: "Effective to", value: p.effectiveTo ? formatDate(p.effectiveTo) : "Open-ended" },
                    { label: "Offer validity", value: `${p.offerValidityDays} day${p.offerValidityDays === 1 ? "" : "s"}` },
                    { label: "Requests", value: <span className="tabular">{p._count.requests}</span> },
                    { label: "Offers generated", value: <span className="tabular">{p._count.offers}</span> },
                    { label: "Financier", value: p.financier.name },
                  ]}
                />
                <div className="mt-5">
                  <p className="eyebrow mb-1">Terms</p>
                  <p className="text-sm leading-relaxed text-slate-ink">{p.terms}</p>
                </div>
                {p._count.requests > 0 && (
                  <Link
                    href={`/finance/requests?builder=${p.builder.id}`}
                    className="mt-5 inline-flex text-xs font-medium text-navy underline-offset-4 hover:underline"
                  >
                    View {p._count.requests} request{p._count.requests === 1 ? "" : "s"} for {p.builder.name}
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
