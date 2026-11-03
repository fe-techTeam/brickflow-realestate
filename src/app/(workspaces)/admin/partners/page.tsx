import type { Metadata } from "next";
import Link from "next/link";
import { Handshake } from "lucide-react";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { sumPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { listPartnerSummaries } from "@/server/queries/admin";
import { AdminHeader, Empty, Monogram, Panel, SummaryStrip } from "../_components/editorial";
import { Count, Money } from "../_components/figures";
import { param, plural } from "../_components/labels";
import { Ledger, LSortTh, LTd, LTh, LTr } from "../_components/ledger";

export const metadata: Metadata = { title: "Channel partners" };

const SORT_KEYS = ["name", "invoices", "financed", "received"] as const;

export default async function PartnersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("admin");
  const sp = await searchParams;
  const sort = readSort(sp, SORT_KEYS, { key: "name", dir: "asc" });
  const partners = sortRows(await listPartnerSummaries(actor, { search: param(sp.q) }), sort, {
    name: (p) => p.name,
    invoices: (p) => p.invoicePaise,
    financed: (p) => p.financedPaise,
    received: (p) => p.receivedPaise,
  });
  const empanelments = partners.reduce((n, p) => n + p.empanelments.filter((e) => e.status === "ACTIVE").length, 0);

  return (
    <>
      <AdminHeader
        eyebrow="Directory"
        title="Channel partners"
        lede="Brokerages that invoice builders for commission and can request early payment on builder-approved invoices."
      />

      <SummaryStrip
        items={[
          { label: "Channel partners", value: <Count value={partners.length} size="lg" />, hint: `${partners.filter((p) => p.status === "ACTIVE").length} active` },
          { label: "Empanelments", value: <Count value={empanelments} size="lg" />, hint: "Active CP–builder relationships", accent: "navy" },
          {
            label: "Invoiced",
            value: <Money paise={sumPaise(partners.map((p) => p.invoicePaise))} compact size="lg" />,
            hint: "Submitted to builders",
            accent: "gold",
          },
          {
            label: "Received early",
            value: <Money paise={sumPaise(partners.map((p) => p.receivedPaise))} compact size="lg" className="text-heritage" />,
            hint: "Net payouts (simulated)",
            accent: "heritage",
          },
        ]}
      />

      <Panel eyebrow="Register" title={`${partners.length} channel partner${partners.length === 1 ? "" : "s"}`} bodyClassName="space-y-5">
        <ListToolbar searchPlaceholder="Search partner name or city…" />
        {partners.length === 0 ? (
          <Empty icon={Handshake} title="No channel partners match" description="Try a different search term." />
        ) : (
          <Ledger minWidth={1060}>
            <thead>
              <tr>
                <LSortTh label="Channel partner" sortKey="name" sort={sort} searchParams={sp} pathname="/admin/partners" />
                <LTh>Empanelled with</LTh>
                <LSortTh label="Invoiced" sortKey="invoices" sort={sort} searchParams={sp} pathname="/admin/partners" align="right" />
                <LSortTh label="Financed" sortKey="financed" sort={sort} searchParams={sp} pathname="/admin/partners" align="right" />
                <LSortTh label="Received early" sortKey="received" sort={sort} searchParams={sp} pathname="/admin/partners" align="right" />
                <LTh>Status</LTh>
                <LTh align="right">
                  <span className="sr-only">Actions</span>
                </LTh>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <LTr key={p.id}>
                  <LTd>
                    <div className="flex items-center gap-3">
                      <Monogram name={p.name} size="sm" tone={p.status === "ACTIVE" ? "ivory" : "muted"} />
                      <div>
                        <Link href={`/admin/organisations/${p.id}`} className="font-medium text-navy hover:underline">
                          {p.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{p.city ?? p.legalName}</p>
                      </div>
                    </div>
                  </LTd>
                  <LTd>
                    {p.empanelments.length === 0 ? (
                      <span className="text-xs text-muted-foreground">Not empanelled</span>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {p.empanelments.map((e) => (
                          <li key={e.id}>
                            <Link
                              href={`/admin/organisations/${e.builderId}`}
                              title={`${e.code} · ${e.creditPeriodDays}-day credit${e.status === "INACTIVE" ? " · inactive" : ""}`}
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:border-gold/60",
                                e.status === "ACTIVE" ? "border-border bg-ivory/60 text-navy" : "border-dashed border-border text-muted-foreground line-through",
                              )}
                            >
                              {e.builderName}
                              <span className="tabular text-[0.625rem] text-muted-foreground">{e.creditPeriodDays}d</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </LTd>
                  <LTd align="right">
                    <Money paise={p.invoicePaise} compact className="text-navy" />
                    <p className="text-xs text-muted-foreground">{plural(p.invoiceCount, "invoice")}</p>
                  </LTd>
                  <LTd align="right">
                    <Money paise={p.financedPaise} compact className="text-navy" />
                    <p className="text-xs text-muted-foreground">{plural(p.financedCount, "request")}</p>
                  </LTd>
                  <LTd align="right">
                    <Money paise={p.receivedPaise} compact className="text-heritage" />
                  </LTd>
                  <LTd>
                    <StatusBadge kind="record" status={p.status} />
                  </LTd>
                  <LTd align="right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/admin/organisations/${p.id}`}>View</Link>
                    </Button>
                  </LTd>
                </LTr>
              ))}
            </tbody>
          </Ledger>
        )}
      </Panel>
    </>
  );
}
