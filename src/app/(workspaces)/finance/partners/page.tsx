import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Handshake } from "lucide-react";
import { DataTable, readSort, SortTh, sortRows, Td, Th, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { listFinancePartners, listFinancierBuilderOptions, type FinancePartnerRow } from "@/server/queries/finance";

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

  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Channel partners"
        description="Brokers empanelled with builders on Veefin programmes, and those who have requested early payment."
      />

      <Section title="Channel partner directory" description={`${rows.length} of ${partners.length} partners`} bodyClassName="p-0 sm:p-0">
        <div className="border-b border-border/80 px-5 py-4 sm:px-6">
          <ListToolbar searchPlaceholder="Search name, GSTIN or city…" filters={[{ param: "builder", label: "Builders", options: builderOptions }]} />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={Handshake} title="No matching channel partners" description="Clear the search or builder filter to see all partners." />
        ) : (
          <div className="px-5 sm:px-6">
            <DataTable minWidth={1000}>
              <thead>
                <tr>
                  <SortTh label="Channel partner" sortKey="name" sort={sort} searchParams={params} pathname={PATH} />
                  <Th>GSTIN</Th>
                  <Th>Empanelled builders</Th>
                  <SortTh label="Requests" sortKey="requests" sort={sort} searchParams={params} pathname={PATH} align="right" />
                  <SortTh label="Net disbursed" sortKey="disbursed" sort={sort} searchParams={params} pathname={PATH} align="right" />
                  <Th align="right">
                    <span className="sr-only">Action</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <Link href={`/finance/partners/${p.id}`} className="font-medium text-navy hover:underline">
                        {p.name}
                      </Link>
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        {p.city ?? "—"}
                        {p.status !== "ACTIVE" && <StatusBadge kind="record" status={p.status} />}
                      </p>
                    </Td>
                    <Td className="tabular text-xs">{p.gstin ?? "—"}</Td>
                    <Td>
                      {p.builders.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {p.builders.map((b) => (
                            <li key={b.id} className="text-sm">
                              <Link href={`/finance/builders/${b.id}`} className="text-slate-ink hover:text-navy hover:underline">
                                {b.name}
                              </Link>
                              <span className="tabular ml-1.5 text-xs text-muted-foreground">{b.code}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                    <Td align="right">
                      {p.requestCount}
                      {p.pendingCount > 0 && <p className="text-xs text-[#8a5a12]">{p.pendingCount} pending</p>}
                    </Td>
                    <Td align="right" className="font-medium text-heritage">
                      {formatINR(p.disbursedValue)}
                      <p className="text-xs font-normal text-muted-foreground">{p.disbursedCount} payouts</p>
                    </Td>
                    <Td align="right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/finance/partners/${p.id}`} aria-label={`View ${p.name}`}>
                          View
                          <ArrowRight className="size-3.5" />
                        </Link>
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
      </Section>
    </>
  );
}
