import type { Metadata } from "next";
import Link from "next/link";
import { BadgePercent, Banknote, Clock, HandCoins, SearchX } from "lucide-react";
import { DataTable, readSort, SortTh, sortRows, Td, Th, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { DemoBadge, StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import type { FinancingStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { formatBps, formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { FINANCING_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { effectiveSettlementStatus, listFinancingRequests } from "@/server/services/financing";
import { ToolbarRow } from "../_components/toolbar-row";
import { enumParam, param, type SearchParams } from "../_lib/params";

export const metadata: Metadata = { title: "Financed invoices" };

const PATH = "/builder/financed";
const STATUS_FILTER: FinancingStatus[] = ["PENDING_APPROVAL", "APPROVED", "DISBURSEMENT_INITIATED", "DISBURSED", "REJECTED"];
const SORT_KEYS = ["invoice", "cp", "approved", "rate", "discount", "net", "status", "due"] as const;

export default async function FinancedInvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireWorkspace("builder");
  const sp = await searchParams;
  const q = param(sp, "q");
  const status = enumParam(sp, "status", STATUS_FILTER);

  const [all, requests] = await Promise.all([listFinancingRequests(actor), listFinancingRequests(actor, { search: q, status })]);

  const sort = readSort(sp, SORT_KEYS, { key: "due", dir: "asc" });
  const rows = sortRows(requests, sort, {
    invoice: (r) => r.invoice.invoiceNumber,
    cp: (r) => r.cp.name,
    approved: (r) => r.approvedAmountPaise,
    rate: (r) => r.discountRateBps,
    discount: (r) => r.discountAmountPaise,
    net: (r) => r.netPayablePaise,
    status: (r) => FINANCING_STATUS[r.status].label,
    due: (r) => r.settlement?.dueDate ?? r.invoice.dueDate,
  });

  const live = all.filter((r) => r.status !== "REJECTED");
  const disbursed = all.filter((r) => r.status === "DISBURSED");
  const pending = all.filter((r) => r.status === "PENDING_APPROVAL");

  return (
    <>
      <PageHeader
        eyebrow="Invoices"
        title="Financed invoices"
        description="Approved invoices on which channel partners have taken early payment from Veefin. You settle the full approved amount with Veefin on each invoice's original due date."
      />

      <StatGrid className="mb-8 xl:grid-cols-4 2xl:grid-cols-4">
        <StatCard
          label="Financed value"
          value={formatINRCompact(sumPaise(live.map((r) => r.approvedAmountPaise)))}
          hint={`${live.length} ${live.length === 1 ? "request" : "requests"}, excluding rejected`}
          icon={HandCoins}
          tone="heritage"
        />
        <StatCard
          label="Net paid to partners"
          value={formatINRCompact(sumPaise(disbursed.map((r) => r.netPayablePaise)))}
          hint={`${disbursed.length} simulated ${disbursed.length === 1 ? "disbursement" : "disbursements"} completed`}
          icon={Banknote}
        />
        <StatCard
          label="Discount borne by partners"
          value={formatINRCompact(sumPaise(live.map((r) => r.discountAmountPaise)))}
          hint="Deducted upfront from the partner's payout, not charged to you"
          icon={BadgePercent}
          tone="gold"
        />
        <StatCard
          label="Pending Veefin approval"
          value={pending.length}
          hint={pending.length > 0 ? `${formatINRCompact(sumPaise(pending.map((r) => r.approvedAmountPaise)))} under credit review` : "No requests under review"}
          icon={Clock}
          tone="slate"
        />
      </StatGrid>

      <Section title="Financing requests" description={rows.length > 0 ? `${rows.length} of ${all.length} shown` : undefined} bodyClassName="py-0">
        <ToolbarRow>
          <ListToolbar
            searchPlaceholder="Search request, invoice or partner…"
            filters={[{ param: "status", label: "Financing statuses", options: STATUS_FILTER.map((s) => ({ value: s, label: FINANCING_STATUS[s].label })) }]}
          />
        </ToolbarRow>
        {rows.length === 0 ? (
          all.length === 0 ? (
            <EmptyState
              icon={HandCoins}
              title="No financed invoices yet"
              description="When a channel partner takes early payment on one of your approved invoices, it appears here with its settlement date."
              action={
                <Button variant="outline" asChild>
                  <Link href="/builder/approved">View approved invoices</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState icon={SearchX} title="No requests match your filters" description="Try a different search term or clear the filters." />
          )
        ) : (
          <DataTable minWidth={1080}>
            <thead>
              <tr>
                <SortTh label="Original invoice" sortKey="invoice" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Partner" sortKey="cp" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Approved" sortKey="approved" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Rate" sortKey="rate" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Discount" sortKey="discount" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Net to CP" sortKey="net" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Financing" sortKey="status" sort={sort} searchParams={sp} pathname={PATH} />
                <Th>Disbursement</Th>
                <SortTh label="Settlement" sortKey="due" sort={sort} searchParams={sp} pathname={PATH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const settlementStatus = r.settlement ? effectiveSettlementStatus(r.settlement) : null;
                return (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/builder/invoices/${r.invoice.id}`} className="font-medium text-navy underline-offset-4 hover:underline">
                        {r.invoice.invoiceNumber}
                      </Link>
                      <p className="mt-0.5 text-xs whitespace-nowrap text-muted-foreground">{formatINR(r.invoice.amountPaise)} invoiced</p>
                      <p className="font-mono text-[0.6875rem] text-muted-foreground">{r.reference}</p>
                    </Td>
                    <Td className="font-medium text-navy">{r.cp.name}</Td>
                    <Td align="right">{formatINR(r.approvedAmountPaise)}</Td>
                    <Td align="right">{formatBps(r.discountRateBps)}</Td>
                    <Td align="right" className="text-[#93342a]">
                      {formatINR(r.discountAmountPaise)}
                    </Td>
                    <Td align="right" className="font-semibold text-heritage">
                      {formatINR(r.netPayablePaise)}
                    </Td>
                    <Td>
                      <StatusBadge kind="financing" status={r.status} />
                    </Td>
                    <Td>
                      {r.disbursement ? (
                        <div className="space-y-1">
                          <p className="font-mono text-xs whitespace-nowrap">{r.disbursement.reference}</p>
                          <DemoBadge />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{r.status === "REJECTED" ? "Not applicable" : "Not yet disbursed"}</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {settlementStatus ? (
                        <StatusBadge kind="settlement" status={settlementStatus} />
                      ) : (
                        <span className="text-xs text-muted-foreground">{r.status === "REJECTED" ? "No settlement" : "After disbursement"}</span>
                      )}
                      <p className="mt-1 text-xs text-slate-ink">Due {formatDate(r.settlement?.dueDate ?? r.invoice.dueDate)}</p>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Section>
    </>
  );
}
