import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgePercent } from "lucide-react";
import { requireWorkspace } from "@/server/auth/session";
import { listProgrammes } from "@/server/services/admin";
import { FacilityCard } from "../_components/facility";
import { EmptyNote, Masthead } from "../_components/ledger";

export const metadata: Metadata = { title: "Financing programmes · Veefin Finance" };

export default async function ProgrammesPage() {
  const actor = await requireWorkspace("finance");
  const programmes = await listProgrammes(actor);
  const active = programmes.filter((p) => p.status === "ACTIVE").length;

  return (
    <>
      <Masthead
        eyebrow="Portfolio · Facilities"
        title="Financing programmes"
        context={[
          <span key="n">
            <strong className="font-semibold text-navy">{programmes.length}</strong> programme{programmes.length === 1 ? "" : "s"}
          </span>,
          <span key="a">{active} active</span>,
          <span key="r" className="text-muted-foreground">
            Read-only view
          </span>,
        ]}
      />

      <aside className="mb-8 grid animate-fade-up gap-4 rounded-xl border border-gold/30 bg-[linear-gradient(135deg,#fbf8f1,#f3ede0)] px-6 py-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-6">
        <span className="flex size-11 items-center justify-center rounded-full bg-card text-gold-600 ring-1 ring-gold/40">
          <BadgePercent className="size-5" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <p className="text-[0.8125rem] leading-relaxed text-slate-ink">
          Discount rates are agreed between Veefin and each builder <strong className="font-semibold text-navy">off-platform</strong> and configured in BrickFlow
          by the Super Admin. Channel partners always see the fixed agreed rate; a rate change applies to new offers only, and every accepted request keeps the rate
          in its snapshot.
        </p>
      </aside>

      {programmes.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyNote icon={BadgePercent} title="No programmes configured" description="Programmes appear here once the Super Admin sets one up for a builder." />
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {programmes.map((p) => (
            <article
              key={p.id}
              className="animate-fade-up overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_40px_-30px_rgba(20,43,67,0.3)]"
            >
              <FacilityCard
                className="rounded-none shadow-none"
                code={p.code}
                name={p.name}
                rateBps={p.discountRateBps}
                status={p.status}
                builder={p.builder}
                effectiveFrom={p.effectiveFrom}
                effectiveTo={p.effectiveTo}
                offerValidityDays={p.offerValidityDays}
              />
              <div className="px-6 py-5 sm:px-7">
                <dl className="grid grid-cols-3 divide-x divide-border/70 rounded-lg border border-border/70">
                  {[
                    { label: "Requests", value: p._count.requests },
                    { label: "Offers", value: p._count.offers },
                    { label: "Financier", value: p.financier.name },
                  ].map((item) => (
                    <div key={item.label} className="min-w-0 px-4 py-3">
                      <dt className="text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">{item.label}</dt>
                      <dd className={typeof item.value === "number" ? "tabular mt-1 text-xl font-light text-navy" : "mt-1.5 truncate text-sm text-navy"}>{item.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-5 text-[0.625rem] font-semibold tracking-[0.2em] text-gold-600 uppercase">Terms</p>
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-slate-ink">{p.terms}</p>
                {p._count.requests > 0 && (
                  <Link
                    href={`/finance/requests?builder=${p.builder.id}`}
                    className="group mt-5 inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.06em] text-navy"
                  >
                    View {p._count.requests} request{p._count.requests === 1 ? "" : "s"} for {p.builder.name}
                    <ArrowRight className="size-3.5 text-gold-600 transition-transform group-hover:translate-x-0.5" />
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
