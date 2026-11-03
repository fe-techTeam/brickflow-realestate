import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
import { StatusBadge, ToneBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatBps, sumPaise } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { listFinanceBuilders, type FinanceBuilderRow } from "@/server/queries/finance";
import { Count, EmptyNote, KeyFigures, Masthead, Money, Monogram, Panel } from "../_components/ledger";
import { LedgerTable, LTd, LTh, LTr } from "../_components/ledger-table";

export const metadata: Metadata = { title: "Builders · Veefin Finance" };

function Utilisation({ financed, approved }: { financed: bigint; approved: bigint }) {
  const pct = approved > 0n ? Math.min(100, Number((financed * 1000n) / approved) / 10) : 0;
  return (
    <div className="w-full min-w-28">
      <div className="h-1 overflow-hidden rounded-full bg-paper-200" aria-hidden="true">
        <span className="block h-full rounded-full bg-gradient-to-r from-leaf to-[#3f8752]" style={{ width: `${pct}%` }} />
      </div>
      <p className="tabular mt-1.5 text-[0.6875rem] text-muted-foreground">{pct.toFixed(0)}% of approved book financed</p>
    </div>
  );
}

function OutstandingNote({ b }: { b: FinanceBuilderRow }) {
  if (b.overdueCount > 0) return <ToneBadge meta={{ label: `${b.overdueCount} overdue`, tone: "danger" }} />;
  return <span className="text-[0.6875rem] text-muted-foreground">{b.outstandingValue > 0n ? "On schedule" : "Nothing open"}</span>;
}

export default async function BuildersPage() {
  const actor = await requireWorkspace("finance");
  const builders = await listFinanceBuilders(actor);
  const overdue = builders.filter((b) => b.overdueCount > 0).length;
  const active = builders.filter((b) => b.programme.status === "ACTIVE").length;

  return (
    <>
      <Masthead
        eyebrow="Portfolio · Obligors"
        title="Builders"
        context={[
          <span key="b">
            <strong className="font-semibold text-basalt">{builders.length}</strong> developer{builders.length === 1 ? "" : "s"} on a Veefin programme
          </span>,
          <span key="a">{active} active facilit{active === 1 ? "y" : "ies"}</span>,
        ]}
      />

      <KeyFigures
        items={[
          { label: "Builders", value: <Count value={builders.length} />, hint: `${active} with an active programme` },
          {
            label: "Approved invoices",
            value: <Money paise={sumPaise(builders.map((b) => b.approvedInvoiceValue))} compact size="lg" />,
            hint: "Builder-approved CP invoices",
            accent: "basalt",
          },
          {
            label: "Financed",
            value: <Money paise={sumPaise(builders.map((b) => b.financedValue))} compact size="lg" className="text-leaf" />,
            hint: "Approved or disbursed requests",
            accent: "leaf",
          },
          {
            label: "Outstanding settlements",
            value: <Money paise={sumPaise(builders.map((b) => b.outstandingValue))} compact size="lg" className={overdue ? "text-danger" : undefined} />,
            hint: overdue ? `${overdue} builder${overdue === 1 ? "" : "s"} overdue` : "No builder overdue",
            accent: overdue ? "danger" : "kota",
          },
        ]}
      />

      <Panel className="mt-8" eyebrow="Book by obligor" title="Builder portfolio" description={`${builders.length} builder${builders.length === 1 ? "" : "s"}`} bodyClassName={builders.length ? "pb-0" : undefined}>
        {builders.length === 0 ? (
          <EmptyNote icon={Building2} title="No builders yet" description="Builders appear here once the Super Admin configures a Veefin programme for them." className="border-t border-border/70" />
        ) : (
          <>
            <ul className="-mx-5 divide-y divide-border/70 border-t border-border/70 md:hidden">
              {builders.map((b) => (
                <li key={b.id}>
                  <Link href={`/finance/builders/${b.id}`} className="block px-5 py-4">
                    <div className="flex items-center gap-3">
                      <Monogram name={b.name} tone="leaf" size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-basalt">{b.name}</p>
                        <p className="tabular text-[0.6875rem] text-muted-foreground">
                          {b.programme.code} · {formatBps(b.programme.discountRateBps)}
                        </p>
                      </div>
                      <StatusBadge kind="programme" status={b.programme.status} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">Financed</p>
                        <Money paise={b.financedValue} className="text-leaf" />
                      </div>
                      <div className="text-right">
                        <p className="text-muted-foreground">Outstanding</p>
                        <Money paise={b.outstandingValue} className="text-basalt" />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <LedgerTable minWidth={1080} className="hidden md:block">
              <thead>
                <tr>
                  <LTh>Builder</LTh>
                  <LTh>Programme</LTh>
                                    <LTh align="right">Approved book</LTh>
                  <LTh>Utilisation</LTh>
                  <LTh align="right">Financed</LTh>
                  <LTh align="right">Outstanding</LTh>
                  <LTh align="right">
                    <span className="sr-only">Action</span>
                  </LTh>
                </tr>
              </thead>
              <tbody>
                {builders.map((b) => (
                  <LTr key={b.id}>
                    <LTd className="min-w-56">
                      <div className="flex items-center gap-3">
                        <Monogram name={b.name} tone="leaf" size="sm" />
                        <div className="min-w-0">
                          <Link href={`/finance/builders/${b.id}`} className="font-medium text-basalt underline-offset-4 hover:underline">
                            {b.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">{[b.city, b.state].filter(Boolean).join(", ")}</p>
                          <p className="tabular text-[0.6875rem] text-muted-foreground">
                            {b.projectCount} project{b.projectCount === 1 ? "" : "s"}
                          </p>
                        </div>
                      </div>
                    </LTd>
                    <LTd>
                      <div className="flex items-center gap-2">
                        <span className="tabular font-medium tracking-wide whitespace-nowrap text-basalt">{b.programme.code}</span>
                        <span className="tabular rounded-md bg-kota-100 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-kota-600">{formatBps(b.programme.discountRateBps)}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <StatusBadge kind="programme" status={b.programme.status} />
                        {b.status !== "ACTIVE" && <StatusBadge kind="record" status={b.status} />}
                      </div>
                    </LTd>
                    <LTd align="right">
                      <Money paise={b.approvedInvoiceValue} className="font-normal text-ink" />
                      <p className="text-[0.6875rem] text-muted-foreground">{b.approvedInvoiceCount} invoices</p>
                    </LTd>
                    <LTd>
                      <Utilisation financed={b.financedValue} approved={b.approvedInvoiceValue} />
                    </LTd>
                    <LTd align="right">
                      <Money paise={b.financedValue} className="font-semibold text-leaf" />
                      <p className="text-[0.6875rem] text-muted-foreground">{b.financedCount} requests</p>
                    </LTd>
                    <LTd align="right">
                      <Money paise={b.outstandingValue} className={b.overdueCount ? "text-danger" : "text-basalt"} />
                      <div className="mt-1 flex justify-end">
                        <OutstandingNote b={b} />
                      </div>
                    </LTd>
                    <LTd align="right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/finance/builders/${b.id}`} aria-label={`View ${b.name}`}>
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
