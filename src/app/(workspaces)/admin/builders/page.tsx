import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { DataTable, readSort, SortTh, sortRows, Td, Th, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatusBadge, ToneBadge } from "@/components/common/status-badge";
import { formatBps, formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { listBuilderSummaries } from "@/server/queries/admin";
import { param, plural } from "../_components/labels";

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
  const withoutProgramme = builders.filter((b) => !b.programme).length;

  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="Builders"
        description="Real estate developers on the platform, the discount rate agreed with Veefin for each, and the invoice and financing volume flowing through them."
      />
      <Section
        title={`${builders.length} builder${builders.length === 1 ? "" : "s"}`}
        description={
          withoutProgramme
            ? `${withoutProgramme} without an active financing programme. Their channel partners cannot request early payment.`
            : `Total financed ${formatINRCompact(sumPaise(builders.map((b) => b.financedPaise)))}`
        }
        bodyClassName="space-y-5"
      >
        <ListToolbar searchPlaceholder="Search builder name or city…" />
        {builders.length === 0 ? (
          <EmptyState icon={Building2} title="No builders match" description="Try a different search term." />
        ) : (
          <DataTable minWidth={1000}>
            <thead>
              <tr>
                <SortTh label="Builder" sortKey="name" sort={sort} searchParams={sp} pathname="/admin/builders" />
                <Th>Active programme</Th>
                <SortTh label="Rate" sortKey="rate" sort={sort} searchParams={sp} pathname="/admin/builders" align="right" />
                <Th align="right">Projects · CPs</Th>
                <SortTh label="Invoice value" sortKey="invoices" sort={sort} searchParams={sp} pathname="/admin/builders" align="right" />
                <SortTh label="Financed" sortKey="financed" sort={sort} searchParams={sp} pathname="/admin/builders" align="right" />
                <SortTh label="Settlement due" sortKey="outstanding" sort={sort} searchParams={sp} pathname="/admin/builders" align="right" />
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {builders.map((b) => (
                <Tr key={b.id}>
                  <Td>
                    <Link href={`/admin/organisations/${b.id}`} className="font-medium whitespace-nowrap text-navy hover:underline">
                      {b.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{b.city ?? b.legalName}</p>
                  </Td>
                  <Td>
                    {b.programme ? (
                      <>
                        <p className="font-mono text-xs text-navy">{b.programme.code}</p>
                        <p className="text-xs text-muted-foreground">{b.programme.financier.name}</p>
                      </>
                    ) : (
                      <ToneBadge meta={{ label: "No active programme", tone: "warning" }} />
                    )}
                  </Td>
                  <Td align="right" className="font-display text-xl font-semibold text-heritage">
                    {b.programme ? formatBps(b.programme.discountRateBps) : "—"}
                  </Td>
                  <Td align="right" className="whitespace-nowrap">
                    {b.projects} · {b.empanelledPartners}
                  </Td>
                  <Td align="right">
                    <span title={formatINR(b.invoicePaise)}>{formatINRCompact(b.invoicePaise)}</span>
                    <p className="text-xs text-muted-foreground">{plural(b.invoiceCount, "invoice")}</p>
                  </Td>
                  <Td align="right">
                    <span title={formatINR(b.financedPaise)}>{formatINRCompact(b.financedPaise)}</span>
                    <p className="text-xs text-muted-foreground">{plural(b.financedCount, "request")}</p>
                  </Td>
                  <Td align="right">{formatINRCompact(b.outstandingPaise)}</Td>
                  <Td>
                    <StatusBadge kind="record" status={b.status} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>
    </>
  );
}
