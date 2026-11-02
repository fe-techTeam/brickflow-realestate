import type { Metadata } from "next";
import Link from "next/link";
import { Handshake, HandCoins, Users, Wallet } from "lucide-react";
import { DataTable, readSort, SortTh, sortRows, Td, Th, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import type { RecordStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { listBuilderPartners } from "@/server/queries/builder";
import { enumParam, param, type SearchParams } from "../_lib/params";
import { ToolbarRow } from "../_components/toolbar-row";

export const metadata: Metadata = { title: "Channel partners" };

const PATH = "/builder/partners";
const SORT_KEYS = ["name", "code", "credit", "invoices", "value", "approved", "financed"] as const;

export default async function PartnersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireWorkspace("builder");
  const sp = await searchParams;
  const partners = await listBuilderPartners(actor);

  const q = param(sp, "q")?.toLowerCase();
  const status = enumParam<RecordStatus>(sp, "status", ["ACTIVE", "INACTIVE"]);
  const sort = readSort(sp, SORT_KEYS, { key: "name", dir: "asc" });

  const filtered = partners.filter(
    (p) =>
      (!status || p.status === status) &&
      (!q || [p.cp.name, p.cp.legalName, p.empanelmentCode, p.cp.gstin ?? "", p.cp.city ?? ""].some((v) => v.toLowerCase().includes(q))),
  );
  const rows = sortRows(filtered, sort, {
    name: (p) => p.cp.name,
    code: (p) => p.empanelmentCode,
    credit: (p) => p.creditPeriodDays,
    invoices: (p) => p.totals.invoiceCount,
    value: (p) => p.totals.invoiceValue,
    approved: (p) => p.totals.approvedValue,
    financed: (p) => p.totals.financedValue,
  });

  const active = partners.filter((p) => p.status === "ACTIVE").length;
  const approved = sumPaise(partners.map((p) => p.totals.approvedValue));
  const financed = sumPaise(partners.map((p) => p.totals.financedValue));
  const share = approved > 0n ? Number((financed * 1000n) / approved) / 10 : 0;

  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="Channel partners"
        description="Brokers empanelled with you. Credit periods set here define the original due date when an invoice does not state one."
      />

      <StatGrid className="mb-8 xl:grid-cols-4 2xl:grid-cols-4">
        <StatCard label="Empanelled partners" value={partners.length} hint={`${active} active`} icon={Handshake} />
        <StatCard label="Invoice value received" value={formatINRCompact(sumPaise(partners.map((p) => p.totals.invoiceValue)))} hint="All submitted invoices" icon={Users} tone="slate" />
        <StatCard label="Approved value" value={formatINRCompact(approved)} hint="Approved amount of accepted invoices" icon={Wallet} tone="heritage" />
        <StatCard label="Financed value" value={formatINRCompact(financed)} hint={`${share.toFixed(1)}% of approved value paid early by Veefin`} icon={HandCoins} tone="gold" />
      </StatGrid>

      <Section
        title="Empanelled channel partners"
        description={`${rows.length} of ${partners.length} shown`}
        bodyClassName="py-0"
      >
        <ToolbarRow>
          <ListToolbar
            searchPlaceholder="Search partner, code or GSTIN…"
            filters={[{ param: "status", label: "Statuses", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] }]}
          />
        </ToolbarRow>
        {rows.length === 0 ? (
          <EmptyState
            icon={Handshake}
            title={partners.length === 0 ? "No channel partners empanelled" : "No partners match your filters"}
            description={partners.length === 0 ? "Empanelments are configured by the platform administrator." : "Try a different search term or clear the filters."}
          />
        ) : (
          <DataTable minWidth={980}>
            <thead>
              <tr>
                <SortTh label="Partner" sortKey="name" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Empanelment" sortKey="code" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Credit" sortKey="credit" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <Th>Status</Th>
                <SortTh label="Invoices" sortKey="invoices" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Invoiced" sortKey="value" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Approved" sortKey="approved" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Financed" sortKey="financed" sort={sort} searchParams={sp} pathname={PATH} align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link
                      href={`/builder/approvals?view=all&q=${encodeURIComponent(p.cp.name)}`}
                      className="font-medium text-navy underline-offset-4 hover:underline"
                      title={`View invoices from ${p.cp.name}`}
                    >
                      {p.cp.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {p.cp.gstin ? `GSTIN ${p.cp.gstin}` : "GSTIN not recorded"}
                      {p.cp.city ? ` · ${p.cp.city}` : ""}
                    </p>
                  </Td>
                  <Td>
                    <p className="font-mono text-xs text-slate-ink">{p.empanelmentCode}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Since {formatDate(p.empanelledAt)}</p>
                  </Td>
                  <Td align="right">{p.creditPeriodDays} days</Td>
                  <Td>
                    <StatusBadge kind="record" status={p.status} />
                  </Td>
                  <Td align="right">
                    {p.totals.invoiceCount}
                    {p.totals.openCount > 0 && <p className="text-xs text-muted-foreground">{p.totals.openCount} open</p>}
                  </Td>
                  <Td align="right">{formatINR(p.totals.invoiceValue)}</Td>
                  <Td align="right" className="text-heritage">
                    {formatINR(p.totals.approvedValue)}
                  </Td>
                  <Td align="right">{formatINR(p.totals.financedValue)}</Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>
    </>
  );
}
