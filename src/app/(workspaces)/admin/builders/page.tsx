import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { StatusBadge, ToneBadge } from "@/components/common/status-badge";
import { sumPaise } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { listBuilderSummaries } from "@/server/queries/admin";
import { AdminHeader, Empty, Monogram, Panel, SummaryStrip } from "../_components/editorial";
import { Count, Money, Rate } from "../_components/figures";
import { param, plural } from "../_components/labels";
import { Ledger, LSortTh, LTd, LTh, LTr, RefCode } from "../_components/ledger";

export const metadata: Metadata = { title: "Builders" };

const SORT_KEYS = ["name", "rate", "invoices", "financed", "outstanding"] as const;

export default async function BuildersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("admin");
  const sp = await searchParams;
  const sort = readSort(sp, SORT_KEYS, { key: "name", dir: "asc" });
  const builders = sortRows(await listBuilderSummaries(actor, { search: param(sp.q) }), sort, {
    name: (b) => b.name,
    rate: (b) => b.programme?.discountRateBps ?? null,
    invoices: (b) => b.invoicePaise,
    financed: (b) => b.financedPaise,
    outstanding: (b) => b.outstandingPaise,
  });
  const withProgramme = builders.filter((b) => b.programme).length;

  return (
    <>
      <AdminHeader
        eyebrow="Directory"
        title="Builders"
        lede="Real estate developers on the platform, the discount rate agreed with Veefin for each, and the receivables flowing through them."
      />

      <SummaryStrip
        items={[
          {
            label: "Builders",
            value: <Count value={builders.length} size="lg" />,
            hint: `${withProgramme} with an active programme`,
            href: "/admin/financing",
          },
          { label: "Invoice value", value: <Money paise={sumPaise(builders.map((b) => b.invoicePaise))} compact size="lg" />, hint: "Submitted by channel partners", accent: "navy" },
          {
            label: "Financed",
            value: <Money paise={sumPaise(builders.map((b) => b.financedPaise))} compact size="lg" className="text-heritage" />,
            hint: "Approved by Veefin",
            accent: "heritage",
          },
          {
            label: "Settlement due",
            value: <Money paise={sumPaise(builders.map((b) => b.outstandingPaise))} compact size="lg" />,
            hint: "Owed by builders to Veefin",
            accent: "gold",
          },
        ]}
      />

      <Panel
        eyebrow="Register"
        title={`${builders.length} builder${builders.length === 1 ? "" : "s"}`}
        description={
          builders.length - withProgramme > 0
            ? `${builders.length - withProgramme} without an active financing programme. Their channel partners cannot request early payment.`
            : "Every builder has an active financing programme."
        }
        bodyClassName="space-y-5"
      >
        <ListToolbar searchPlaceholder="Search builder name or city…" />
        {builders.length === 0 ? (
          <Empty icon={Building2} title="No builders match" description="Try a different search term." />
        ) : (
          <Ledger minWidth={1060}>
            <thead>
              <tr>
                <LSortTh label="Builder" sortKey="name" sort={sort} searchParams={sp} pathname="/admin/builders" />
                <LTh>Active programme</LTh>
                <LSortTh label="Rate" sortKey="rate" sort={sort} searchParams={sp} pathname="/admin/builders" align="right" />
                <LTh align="right">Projects · CPs</LTh>
                <LSortTh label="Invoice value" sortKey="invoices" sort={sort} searchParams={sp} pathname="/admin/builders" align="right" />
                <LSortTh label="Financed" sortKey="financed" sort={sort} searchParams={sp} pathname="/admin/builders" align="right" />
                <LSortTh label="Settlement due" sortKey="outstanding" sort={sort} searchParams={sp} pathname="/admin/builders" align="right" />
                <LTh>Status</LTh>
              </tr>
            </thead>
            <tbody>
              {builders.map((b) => (
                <LTr key={b.id}>
                  <LTd>
                    <div className="flex items-center gap-3">
                      <Monogram name={b.name} size="sm" tone={b.programme ? "navy" : "muted"} />
                      <div>
                        <Link href={`/admin/organisations/${b.id}`} className="font-medium whitespace-nowrap text-navy hover:underline">
                          {b.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{b.city ?? b.legalName}</p>
                      </div>
                    </div>
                  </LTd>
                  <LTd>
                    {b.programme ? (
                      <>
                        <RefCode>{b.programme.code}</RefCode>
                        <p className="text-xs text-muted-foreground">{b.programme.financier.name}</p>
                      </>
                    ) : (
                      <ToneBadge meta={{ label: "No active programme", tone: "warning" }} />
                    )}
                  </LTd>
                  <LTd align="right">{b.programme ? <Rate bps={b.programme.discountRateBps} size="lg" /> : <span className="text-muted-foreground">—</span>}</LTd>
                  <LTd align="right" className="whitespace-nowrap">
                    {b.projects} · {b.empanelledPartners}
                  </LTd>
                  <LTd align="right">
                    <Money paise={b.invoicePaise} compact className="text-navy" />
                    <p className="text-xs text-muted-foreground">{plural(b.invoiceCount, "invoice")}</p>
                  </LTd>
                  <LTd align="right">
                    <Money paise={b.financedPaise} compact className="text-heritage" />
                    <p className="text-xs text-muted-foreground">{plural(b.financedCount, "request")}</p>
                  </LTd>
                  <LTd align="right">
                    <Money paise={b.outstandingPaise} compact className="text-navy" />
                  </LTd>
                  <LTd>
                    <StatusBadge kind="record" status={b.status} />
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
