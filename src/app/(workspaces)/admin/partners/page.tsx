import type { Metadata } from "next";
import Link from "next/link";
import { Handshake } from "lucide-react";
import { DataTable, readSort, SortTh, sortRows, Td, Th, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { listPartnerSummaries } from "@/server/queries/admin";
import { param, plural } from "../_components/labels";

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

  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="Channel partners"
        description="Brokerages that invoice builders for commission and can request early payment on builder-approved invoices."
      />
      <Section
        title={`${partners.length} channel partner${partners.length === 1 ? "" : "s"}`}
        description={`Paid out early (simulated): ${formatINRCompact(sumPaise(partners.map((p) => p.receivedPaise)))}`}
        bodyClassName="space-y-5"
      >
        <ListToolbar searchPlaceholder="Search partner name or city…" />
        {partners.length === 0 ? (
          <EmptyState icon={Handshake} title="No channel partners match" description="Try a different search term." />
        ) : (
          <DataTable minWidth={1040}>
            <thead>
              <tr>
                <SortTh label="Channel partner" sortKey="name" sort={sort} searchParams={sp} pathname="/admin/partners" />
                <Th>Empanelled with</Th>
                <SortTh label="Invoices" sortKey="invoices" sort={sort} searchParams={sp} pathname="/admin/partners" align="right" />
                <SortTh label="Financed" sortKey="financed" sort={sort} searchParams={sp} pathname="/admin/partners" align="right" />
                <SortTh label="Received early" sortKey="received" sort={sort} searchParams={sp} pathname="/admin/partners" align="right" />
                <Th>Status</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`/admin/organisations/${p.id}`} className="font-medium text-navy hover:underline">
                      {p.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{p.city ?? p.legalName}</p>
                  </Td>
                  <Td>
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
                                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:border-navy/40",
                                e.status === "ACTIVE" ? "border-border bg-ivory/60 text-navy" : "border-dashed border-border text-muted-foreground line-through",
                              )}
                            >
                              {e.builderName}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Td>
                  <Td align="right">
                    <span title={formatINR(p.invoicePaise)}>{formatINRCompact(p.invoicePaise)}</span>
                    <p className="text-xs text-muted-foreground">{plural(p.invoiceCount, "invoice")}</p>
                  </Td>
                  <Td align="right">
                    <span title={formatINR(p.financedPaise)}>{formatINRCompact(p.financedPaise)}</span>
                    <p className="text-xs text-muted-foreground">{plural(p.financedCount, "request")}</p>
                  </Td>
                  <Td align="right" className="text-heritage">
                    {formatINRCompact(p.receivedPaise)}
                  </Td>
                  <Td>
                    <StatusBadge kind="record" status={p.status} />
                  </Td>
                  <Td align="right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/admin/organisations/${p.id}`}>View</Link>
                    </Button>
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
