import type { Metadata } from "next";
import Link from "next/link";
import { BadgePercent } from "lucide-react";
import type { ProgrammeStatus } from "@/generated/prisma/enums";
import { ListToolbar } from "@/components/common/list-toolbar";
import { StatusBadge } from "@/components/common/status-badge";
import { formatDate } from "@/lib/format";
import { bpsToDecimalString } from "@/lib/money";
import { PROGRAMME_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { getProgrammeConfigContext } from "@/server/queries/admin";
import { listProgrammes } from "@/server/services/admin";
import { AdminHeader, Empty, Panel } from "../_components/editorial";
import { Rate } from "../_components/figures";
import { param, plural } from "../_components/labels";
import { Ledger, LTd, LTh, LTr, RefCode } from "../_components/ledger";
import { ProgrammeFormDialog } from "./_components/programme-form-dialog";
import { RateCard, UnconfiguredCard, type RateCardData } from "./_components/rate-card";
import type { ProgrammeRow } from "./_components/types";

export const metadata: Metadata = { title: "Financing configuration" };

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

const PRINCIPLES = [
  {
    title: "Agreed off-platform",
    body: "Each builder and Veefin negotiate a fixed discount outside BrickFlow. The Super Admin records it here as a financing programme.",
  },
  {
    title: "One fixed rate per builder",
    body: "Every early-payment offer for that builder's invoices uses the active programme's rate: no bidding, tiers or per-invoice pricing.",
  },
  {
    title: "Read-only for everyone else",
    body: "Channel partners and builders see the rate on offers and reports but cannot change it. Accepted requests keep a snapshot of their terms.",
  },
];

const NUMERALS = ["I", "II", "III"];

const STATUS_ORDER: Record<ProgrammeStatus, number> = { ACTIVE: 0, SUSPENDED: 1, DRAFT: 2, CLOSED: 3 };

export default async function FinancingConfigurationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("admin");
  const sp = await searchParams;
  const statusParam = param(sp.status);
  const status = statusParam && statusParam in PROGRAMME_STATUS ? (statusParam as ProgrammeStatus) : undefined;
  const q = param(sp.q)?.toLowerCase();

  const [programmes, context] = await Promise.all([listProgrammes(actor), getProgrammeConfigContext(actor)]);
  const activeByBuilder = Object.fromEntries(programmes.filter((p) => p.status === "ACTIVE").map((p) => [p.builder.id, p.code]));

  const toRow = (p: (typeof programmes)[number]): ProgrammeRow => ({
    id: p.id,
    code: p.code,
    builderName: p.builder.name,
    financierName: p.financier.name,
    discountRateBps: p.discountRateBps,
    status: p.status,
    openOffers: context.openOffersByProgramme[p.id] ?? 0,
    requests: p._count.requests,
    values: {
      name: p.name,
      discountRate: bpsToDecimalString(p.discountRateBps),
      status: p.status,
      effectiveFrom: isoDate(p.effectiveFrom),
      effectiveTo: isoDate(p.effectiveTo),
      offerValidityDays: String(p.offerValidityDays),
      terms: p.terms,
    },
  });

  const cards: RateCardData[] = programmes
    .filter((p) => p.status !== "CLOSED")
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.builder.name.localeCompare(b.builder.name))
    .map((p) => ({
      row: toRow(p),
      builderId: p.builder.id,
      builderInactive: p.builder.status === "INACTIVE",
      name: p.name,
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo,
      offerValidityDays: p.offerValidityDays,
      offers: p._count.offers,
    }));

  const visible = programmes.filter(
    (p) => (!status || p.status === status) && (!q || [p.code, p.name, p.builder.name, p.financier.name].some((v) => v.toLowerCase().includes(q))),
  );
  const buildersWithoutActive = context.builders.filter((b) => !activeByBuilder[b.id]);
  const counts = Object.fromEntries((Object.keys(PROGRAMME_STATUS) as ProgrammeStatus[]).map((s) => [s, programmes.filter((p) => p.status === s).length]));

  return (
    <>
      <AdminHeader
        eyebrow="Platform · Pricing"
        title="Financing configuration"
        lede="The discount a channel partner pays for early payment is agreed off-platform between each builder and Veefin, then recorded here. This is the only place on BrickFlow where a rate can be set."
        meta={
          <>
            {(["ACTIVE", "DRAFT", "SUSPENDED", "CLOSED"] as ProgrammeStatus[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-2">
                <StatusBadge kind="programme" status={s} />
                <span className="tabular font-medium text-navy">{counts[s]}</span>
              </span>
            ))}
          </>
        }
        actions={<ProgrammeFormDialog mode="create" builders={context.builders} financiers={context.financiers} activeByBuilder={activeByBuilder} />}
      />

      <section aria-labelledby="rate-book" className="mb-12">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-[0.625rem] font-semibold tracking-[0.22em] text-gold-600 uppercase">The rate book</p>
            <h2 id="rate-book" className="mt-1.5 text-[1.75rem] leading-tight font-semibold">
              Programmes in force
            </h2>
          </div>
          <p className="hidden max-w-sm text-right text-xs leading-relaxed text-muted-foreground md:block">
            Active, suspended and draft programmes. Closed programmes remain in the register below.
          </p>
        </div>
        {cards.length === 0 && buildersWithoutActive.length === 0 ? (
          <Panel>
            <Empty icon={BadgePercent} title="No programmes yet" description="Create the first programme to let channel partners request early payment." />
          </Panel>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((c) => (
              <RateCard key={c.row.id} data={c} />
            ))}
            {buildersWithoutActive
              .filter((b) => !cards.some((c) => c.builderId === b.id))
              .map((b) => (
                <UnconfiguredCard key={b.id} name={b.name}>
                  <ProgrammeFormDialog
                    mode="create"
                    trigger="subtle"
                    presetBuilderId={b.id}
                    builders={context.builders}
                    financiers={context.financiers}
                    activeByBuilder={activeByBuilder}
                  />
                </UnconfiguredCard>
              ))}
          </div>
        )}
        {buildersWithoutActive.length > 0 && (
          <p className="mt-5 flex items-start gap-2.5 text-[0.8125rem] text-[#6d4710]">
            <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#c48a2c]" />
            <span>
              <span className="font-semibold">{buildersWithoutActive.map((b) => b.name).join(", ")}</span>{" "}
              {buildersWithoutActive.length === 1 ? "has" : "have"} no active programme, so {buildersWithoutActive.length === 1 ? "its" : "their"} channel partners
              cannot request early payment.
            </span>
          </p>
        )}
      </section>

      <section aria-labelledby="pricing-rule" className="mb-12 grid animate-fade-up overflow-hidden rounded-xl border border-border/90 bg-card lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="relative bg-navy px-7 py-8 text-white">
          <span aria-hidden="true" className="pointer-events-none absolute -bottom-20 -left-16 size-56 rounded-full bg-gold/10 blur-3xl" />
          <p className="text-[0.625rem] font-semibold tracking-[0.22em] text-gold uppercase">The pricing rule</p>
          <h2 id="pricing-rule" className="mt-2 text-[1.625rem] leading-tight font-semibold text-white">
            A fixed discount on the approved amount
          </h2>
          <dl className="mt-6 space-y-3 border-l border-gold/50 pl-4 font-sans text-[0.875rem]">
            <div>
              <dt className="text-[0.6875rem] text-white/50">Discount</dt>
              <dd className="text-white/90">Approved amount × agreed rate</dd>
            </div>
            <div>
              <dt className="text-[0.6875rem] text-white/50">Partner receives</dt>
              <dd className="text-white/90">Approved amount − discount</dd>
            </div>
          </dl>
          <p className="mt-6 text-xs leading-relaxed text-white/55">Calculated on the server in paise and rounded half-up to the nearest paisa. No other charges apply.</p>
        </div>
        <ol className="grid divide-y divide-border/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {PRINCIPLES.map(({ title, body }, i) => (
            <li key={title} className="px-6 py-7">
              <span className="font-display text-[1.75rem] leading-none font-semibold text-gold">{NUMERALS[i]}</span>
              <p className="mt-4 text-sm font-semibold text-navy">{title}</p>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <Panel
        eyebrow="Register"
        title="All programmes"
        description={`${plural(programmes.length, "programme")} configured · ${Object.keys(activeByBuilder).length} active. A builder can have only one active programme at a time.`}
        bodyClassName="space-y-5"
      >
        <ListToolbar
          searchPlaceholder="Search code, builder or financier…"
          filters={[{ param: "status", label: "Statuses", options: Object.entries(PROGRAMME_STATUS).map(([value, meta]) => ({ value, label: meta.label })) }]}
        />
        {visible.length === 0 ? (
          <Empty
            icon={BadgePercent}
            title={programmes.length === 0 ? "No programmes yet" : "No programmes match"}
            description={programmes.length === 0 ? "Create the first programme to let channel partners request early payment." : "Try a different search or clear the filters."}
          />
        ) : (
          <Ledger minWidth={980}>
            <thead>
              <tr>
                <LTh>Programme</LTh>
                <LTh>Builder · financier</LTh>
                <LTh align="right">Agreed discount</LTh>
                <LTh>Status</LTh>
                <LTh>Effective window</LTh>
                <LTh align="right">Validity</LTh>
                <LTh align="right">
                  <span className="sr-only">Actions</span>
                </LTh>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const row = toRow(p);
                return (
                  <LTr key={p.id}>
                    <LTd className="max-w-60">
                      <RefCode>{p.code}</RefCode>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground" title={p.name}>
                        {p.name}
                      </p>
                    </LTd>
                    <LTd>
                      <Link href={`/admin/organisations/${p.builder.id}`} className="font-medium text-navy hover:underline">
                        {p.builder.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{p.financier.name}</p>
                      {p.builder.status === "INACTIVE" && <p className="text-xs text-[#8a5a12]">Builder inactive</p>}
                    </LTd>
                    <LTd align="right">
                      <Rate bps={p.discountRateBps} size="lg" />
                    </LTd>
                    <LTd>
                      <StatusBadge kind="programme" status={p.status} />
                      <p className="tabular mt-1.5 text-xs whitespace-nowrap text-muted-foreground">
                        {plural(p._count.offers, "offer")} · {plural(p._count.requests, "request")}
                      </p>
                      {row.openOffers > 0 && <p className="text-xs text-gold-600">{row.openOffers} open</p>}
                    </LTd>
                    <LTd className="tabular text-xs whitespace-nowrap">
                      <p className="text-navy">{formatDate(p.effectiveFrom)}</p>
                      <p className="text-muted-foreground">{p.effectiveTo ? `to ${formatDate(p.effectiveTo)}` : "open-ended"}</p>
                    </LTd>
                    <LTd align="right" className="text-xs whitespace-nowrap">
                      {p.offerValidityDays} days
                    </LTd>
                    <LTd align="right">
                      <ProgrammeFormDialog mode="edit" programme={row} />
                    </LTd>
                  </LTr>
                );
              })}
            </tbody>
          </Ledger>
        )}
      </Panel>
    </>
  );
}
