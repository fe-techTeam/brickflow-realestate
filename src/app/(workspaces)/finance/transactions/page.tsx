import type { Metadata } from "next";
import Link from "next/link";
import { Download, Receipt } from "lucide-react";
import { DataTable, readSort, SortTh, sortRows, Td, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { formatBps, formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { FINANCING_STATUS, SETTLEMENT_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { FINANCIER_REQUEST_STATUSES, listFinanceLedger, listFinancierBuilderOptions, parseLedgerFilters, type LedgerRow } from "@/server/queries/finance";

export const metadata: Metadata = { title: "Transactions · Veefin Finance" };

const PATH = "/finance/transactions";
const SORT_KEYS = ["reference", "cp", "approved", "net", "status", "disbursed", "due"] as const;

const accessors: Record<(typeof SORT_KEYS)[number], (row: LedgerRow) => string | number | bigint | Date | null | undefined> = {
  reference: (r) => r.request.createdAt,
  cp: (r) => r.request.cp.name,
  approved: (r) => r.request.approvedAmountPaise,
  net: (r) => r.request.netPayablePaise,
  status: (r) => r.request.status,
  disbursed: (r) => r.request.disbursement?.completedAt,
  due: (r) => r.request.settlement?.dueDate ?? r.request.invoice.dueDate,
};

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("finance");
  const params = await searchParams;
  const filters = parseLedgerFilters(params);
  const sort = readSort(params, SORT_KEYS, { key: "reference", dir: "desc" });
  const [ledger, builderOptions] = await Promise.all([listFinanceLedger(actor, filters), listFinancierBuilderOptions(actor)]);
  const rows = sortRows(ledger, sort, accessors);

  const exportParams = new URLSearchParams();
  for (const key of ["q", "status", "builder", "settlement"]) {
    const value = params[key];
    if (typeof value === "string" && value) exportParams.set(key, value);
  }
  const exportHref = `/api/finance/reports/requests${exportParams.size ? `?${exportParams}` : ""}`;
  const disbursed = rows.filter((r) => r.request.status === "DISBURSED");
  const th = (label: string, key: (typeof SORT_KEYS)[number], align: "left" | "right" = "left") => (
    <SortTh label={label} sortKey={key} sort={sort} searchParams={params} pathname={PATH} align={align} />
  );

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Transactions"
        description="The complete ledger of financing requests across every status, with disbursement and builder settlement positions."
        actions={
          <Button asChild variant="outline">
            <a href={exportHref} download>
              <Download className="size-4" />
              Export CSV
            </a>
          </Button>
        }
      />

      <StatGrid className="xl:grid-cols-4 2xl:grid-cols-4">
        <StatCard label="Requests in view" value={rows.length} icon={Receipt} tone="slate" />
        <StatCard label="Approved invoice value" value={formatINRCompact(sumPaise(rows.map((r) => r.request.approvedAmountPaise)))} hint="Across requests in view" />
        <StatCard
          label="Net disbursed"
          value={formatINRCompact(sumPaise(disbursed.map((r) => r.request.disbursement?.amountPaise ?? r.request.netPayablePaise)))}
          hint={`${disbursed.length} simulated payout${disbursed.length === 1 ? "" : "s"}`}
          tone="heritage"
        />
        <StatCard label="Discount earned" value={formatINRCompact(sumPaise(disbursed.map((r) => r.request.discountAmountPaise)))} hint="On disbursed requests" tone="gold" />
      </StatGrid>

      <Section className="mt-6" title="Financing ledger" description={`${rows.length} record${rows.length === 1 ? "" : "s"}`} bodyClassName="p-0 sm:p-0">
        <div className="border-b border-border/80 px-5 py-4 sm:px-6">
          <ListToolbar
            searchPlaceholder="Search reference, invoice, CP or builder…"
            filters={[
              { param: "status", label: "Statuses", options: FINANCIER_REQUEST_STATUSES.map((s) => ({ value: s, label: FINANCING_STATUS[s].label })) },
              {
                param: "settlement",
                label: "Settlements",
                options: [
                  ...(["NOT_DUE", "DUE", "OVERDUE", "SETTLED"] as const).map((s) => ({ value: s, label: SETTLEMENT_STATUS[s].label })),
                  { value: "NONE", label: "No settlement yet" },
                ],
              },
              { param: "builder", label: "Builders", options: builderOptions },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No matching transactions"
            description="Adjust or clear the filters to see more of the ledger."
            action={
              <Button asChild variant="outline">
                <Link href={PATH}>Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <div className="px-5 sm:px-6">
            <DataTable minWidth={1000}>
              <thead>
                <tr>
                  {th("Request", "reference")}
                  {th("Channel partner → Builder", "cp")}
                  {th("Approved", "approved", "right")}
                  {th("Net payable", "net", "right")}
                  {th("Status", "status")}
                  {th("Disbursed", "disbursed")}
                  {th("Settlement", "due")}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ request: r, settlementStatus }) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap">
                      <Link href={`/finance/requests/${r.id}`} className="tabular font-medium text-navy hover:underline">
                        {r.reference}
                      </Link>
                      <p className="tabular text-xs text-slate-ink">{r.invoice.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</p>
                    </Td>
                    <Td className="min-w-48">
                      {r.cp.name}
                      <p className="text-xs text-muted-foreground">→ {r.builder.name}</p>
                    </Td>
                    <Td align="right">
                      {formatINR(r.approvedAmountPaise)}
                      <p className="text-xs text-muted-foreground">
                        <span className="whitespace-nowrap">− {formatINR(r.discountAmountPaise)}</span>{" "}
                        <span className="whitespace-nowrap">at {formatBps(r.discountRateBps)}</span>
                      </p>
                    </Td>
                    <Td align="right" className="font-medium text-heritage">
                      {formatINR(r.netPayablePaise)}
                    </Td>
                    <Td>
                      <StatusBadge kind="financing" status={r.status} />
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(r.disbursement?.completedAt)}</Td>
                    <Td className="min-w-40">
                      {r.settlement && settlementStatus ? (
                        <>
                          <StatusBadge kind="settlement" status={settlementStatus} />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {r.settlement.settledAt ? `Settled ${formatDate(r.settlement.settledAt)}` : `Due ${formatDate(r.settlement.dueDate)}`}
                          </p>
                        </>
                      ) : r.status === "REJECTED" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <p className="text-xs text-muted-foreground">Opens on disbursement · invoice due {formatDate(r.invoice.dueDate)}</p>
                      )}
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
