import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Handshake } from "lucide-react";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { sumPaise } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { listFinancePartners, listFinancierBuilderOptions, type FinancePartnerRow } from "@/server/queries/finance";
import { Count, EmptyNote, KeyFigures, Masthead, Money, Monogram, Panel } from "../_components/ledger";
import { LedgerTable, LSortTh, LTd, LTh, LTr } from "../_components/ledger-table";

export const metadata: Metadata = { title: "Channel partners · Veefin Finance" };

const PATH = "/finance/partners";
const SORT_KEYS = ["name", "requests", "disbursed"] as const;
const accessors: Record<(typeof SORT_KEYS)[number], (row: FinancePartnerRow) => string | number | bigint> = {
  name: (r) => r.name,
  requests: (r) => r.requestCount,
  disbursed: (r) => r.disbursedValue,
};

export default async function PartnersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("finance");
  const params = await searchParams;
  const sort = readSort(params, SORT_KEYS, { key: "name", dir: "asc" });
  const q = typeof params.q === "string" ? params.q.trim().toLowerCase() : "";
  const builder = typeof params.builder === "string" ? params.builder : "";
  const [partners, builderOptions] = await Promise.all([listFinancePartners(actor), listFinancierBuilderOptions(actor)]);

  const filtered = partners.filter(
    (p) =>
      (!q || [p.name, p.legalName, p.gstin ?? "", p.city ?? ""].some((v) => v.toLowerCase().includes(q))) &&
      (!builder || p.builders.some((b) => b.id === builder)),
  );
  const rows = sortRows(filtered, sort, accessors);
  const pending = partners.reduce((n, p) => n + p.pendingCount, 0);
  const requestTotal = partners.reduce((n, p) => n + p.requestCount, 0);

  return (
    <>
      <Masthead
        eyebrow="Portfolio · Beneficiaries"
        title="Channel partners"
        context={[
          <span key="n">
            <strong className="font-semibold text-navy">{partners.length}</strong> partner{partners.length === 1 ? "" : "s"} empanelled with programme builders
          </span>,
          <span key="p">{pending} pending approval</span>,
        ]}
      />

      <KeyFigures
        items={[
          { label: "Channel partners", value: <Count value={partners.length} />, hint: "Brokers on Veefin programme builders" },
          { label: "Financing requests", value: <Count value={requestTotal} />, hint: "Raised with Veefin, all statuses", accent: "navy" },
          { label: "Pending approval", value: <Count value={pending} />, hint: pending ? "Awaiting a credit decision" : "Queue is clear", accent: "gold", href: "/finance/requests?status=PENDING_APPROVAL" },
          {
            label: "Net disbursed",
            value: <Money paise={sumPaise(partners.map((p) => p.disbursedValue))} compact size="lg" className="text-heritage" />,
            hint: "Simulated payouts to partners",
            accent: "heritage",
          },
        ]}
      />

      <Panel className="mt-8" eyebrow="Directory" title="Channel partner register" description={`${rows.length} of ${partners.length} partners`} bodyClassName="pb-0">
        <div className="border-t border-border/70 py-4">
          <ListToolbar searchPlaceholder="Search name, GSTIN or city…" filters={[{ param: "builder", label: "Builders", options: builderOptions }]} />
        </div>
        {rows.length === 0 ? (
          <EmptyNote
            icon={Handshake}
            title="No matching channel partners"
            description="Clear the search or builder filter to see every partner."
            action={
              <Button asChild variant="outline">
                <Link href={PATH}>Show all partners</Link>
              </Button>
            }
            className="border-t border-border/70"
          />
        ) : (
          <>
            <ul className="-mx-5 divide-y divide-border/70 border-t border-border/70 md:hidden">
              {rows.map((p) => (
                <li key={p.id}>
                  <Link href={`/finance/partners/${p.id}`} className="flex items-center gap-3 px-5 py-4">
                    <Monogram name={p.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-navy">{p.name}</p>
                      <p className="truncate text-[0.6875rem] text-muted-foreground">
                        {p.city ?? "—"} · {p.requestCount} request{p.requestCount === 1 ? "" : "s"}
                        {p.pendingCount > 0 && ` · ${p.pendingCount} pending`}
                      </p>
                    </div>
                    <Money paise={p.disbursedValue} className="text-heritage" />
                  </Link>
                </li>
              ))}
            </ul>
            <LedgerTable minWidth={1000} className="hidden md:block">
              <thead>
                <tr>
                  <LSortTh label="Channel partner" sortKey="name" sort={sort} searchParams={params} pathname={PATH} />
                  <LTh>GSTIN</LTh>
                  <LTh>Empanelled builders</LTh>
                  <LSortTh label="Requests" sortKey="requests" sort={sort} searchParams={params} pathname={PATH} align="right" />
                  <LSortTh label="Net disbursed" sortKey="disbursed" sort={sort} searchParams={params} pathname={PATH} align="right" />
                  <LTh align="right">
                    <span className="sr-only">Action</span>
                  </LTh>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <LTr key={p.id}>
                    <LTd>
                      <div className="flex items-center gap-3">
                        <Monogram name={p.name} size="sm" />
                        <div className="min-w-0">
                          <Link href={`/finance/partners/${p.id}`} className="font-medium text-navy underline-offset-4 hover:underline">
                            {p.name}
                          </Link>
                          <p className="flex items-center gap-2 text-xs text-muted-foreground">
                            {p.city ?? "—"}
                            {p.status !== "ACTIVE" && <StatusBadge kind="record" status={p.status} />}
                          </p>
                        </div>
                      </div>
                    </LTd>
                    <LTd className="tabular text-xs tracking-wide">{p.gstin ?? "—"}</LTd>
                    <LTd>
                      {p.builders.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <ul className="flex flex-wrap gap-1.5">
                          {p.builders.map((b) => (
                            <li key={b.id}>
                              <Link
                                href={`/finance/builders/${b.id}`}
                                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-ivory/50 px-2.5 py-0.5 text-xs text-slate-ink transition-colors hover:border-gold/50 hover:text-navy"
                              >
                                {b.name}
                                <span className="tabular text-[0.625rem] text-muted-foreground">{b.code}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </LTd>
                    <LTd align="right">
                      <span className="text-navy">{p.requestCount}</span>
                      {p.pendingCount > 0 && <p className="text-[0.6875rem] font-medium text-[#8a5a12]">{p.pendingCount} pending</p>}
                    </LTd>
                    <LTd align="right">
                      <Money paise={p.disbursedValue} className="font-semibold text-heritage" />
                      <p className="text-[0.6875rem] text-muted-foreground">{p.disbursedCount} payouts</p>
                    </LTd>
                    <LTd align="right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/finance/partners/${p.id}`} aria-label={`View ${p.name}`}>
                          Open
                          <ArrowRight className="size-3.5" />
                        </Link>
                      </Button>
                    </LTd>
                  </LTr>
                ))}
              </tbody>
            </LedgerTable>
          </>
        )}
      </Panel>
    </>
  );
}
