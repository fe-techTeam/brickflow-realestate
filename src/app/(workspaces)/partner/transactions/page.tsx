import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock3, HandCoins, Receipt, SearchX, Wallet } from "lucide-react";
import type { FinancingStatus } from "@/generated/prisma/enums";
import { DataTable, readSort, SortTh, sortRows, Th, Td, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { DemoBadge, StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps, formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { FINANCING_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { effectiveSettlementStatus, listFinancingRequests } from "@/server/services/financing";
import { firstParam } from "../_components/summaries";

export const metadata: Metadata = { title: "My Transactions" };

const PATH = "/partner/transactions";
const STATUS_FILTERS: FinancingStatus[] = ["PENDING_APPROVAL", "APPROVED", "DISBURSEMENT_INITIATED", "DISBURSED", "REJECTED"];
const SORT_KEYS = ["reference", "invoice", "builder", "approved", "net", "status", "accepted"] as const;

type SearchParams = Record<string, string | string[] | undefined>;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireWorkspace("partner");
  const params = await searchParams;
  const statusParam = firstParam(params.status);
  const status = STATUS_FILTERS.includes(statusParam as FinancingStatus) ? (statusParam as FinancingStatus) : undefined;
  const search = firstParam(params.q);

  const [all, filteredRequests] = await Promise.all([
    listFinancingRequests(actor),
    status || search ? listFinancingRequests(actor, { status, search }) : null,
  ]);
  const requests = filteredRequests ?? all;
  const sort = readSort(params, SORT_KEYS, { key: "accepted", dir: "desc" });
  const rows = sortRows(requests, sort, {
    reference: (r) => r.reference,
    invoice: (r) => r.invoice.invoiceNumber,
    builder: (r) => r.builder.name,
    approved: (r) => r.approvedAmountPaise,
    net: (r) => r.netPayablePaise,
    status: (r) => FINANCING_STATUS[r.status].label,
    accepted: (r) => r.acceptedAt,
  });

  const live = all.filter((r) => r.status !== "REJECTED");
  const pending = all.filter((r) => r.status === "PENDING_APPROVAL");
  const disbursed = all.filter((r) => r.status === "DISBURSED");

  return (
    <>
      <PageHeader
        eyebrow="Early payment"
        title="My Transactions"
        description="Every early payment request you have made, with the agreed discount and its progress through Veefin approval and payout."
        actions={<DemoBadge />}
      />

      <StatGrid className="mb-8 xl:grid-cols-4 2xl:grid-cols-4">
        <StatCard label="Financing requests" value={all.length} hint={`${live.length} active or completed`} icon={Receipt} />
        <StatCard label="Approved amount financed" value={formatINRCompact(sumPaise(live.map((r) => r.approvedAmountPaise)))} hint="Excludes rejected requests" icon={HandCoins} />
        <StatCard label="Pending Veefin approval" value={pending.length} hint={`${formatINRCompact(sumPaise(pending.map((r) => r.netPayablePaise)))} net payable`} icon={Clock3} tone="gold" />
        <StatCard
          label="Received (simulated)"
          value={formatINRCompact(sumPaise(disbursed.map((r) => r.netPayablePaise)))}
          hint={`${disbursed.length} disbursed`}
          icon={Wallet}
          tone="heritage"
          href="/partner/disbursements"
        />
      </StatGrid>

      <Section title={`${rows.length} ${rows.length === 1 ? "request" : "requests"}`} bodyClassName="py-0">
        <div className="border-b border-border/70 py-4">
          <ListToolbar
            searchPlaceholder="Search request reference, invoice or builder"
            filters={[{ param: "status", label: "Statuses", options: STATUS_FILTERS.map((s) => ({ value: s, label: FINANCING_STATUS[s].label })) }]}
          />
        </div>
        {rows.length === 0 ? (
          all.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No financing requests yet"
              description="Accept an early payment offer on an approved invoice and it will be tracked here."
              action={
                <Button size="sm" asChild>
                  <Link href="/partner/offers">View financing offers</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState icon={SearchX} title="No requests match your filters" description="Try a different search term or clear the filters." />
          )
        ) : (
          <DataTable minWidth={1280}>
            <thead>
              <tr>
                <SortTh label="Reference" sortKey="reference" sort={sort} searchParams={params} pathname={PATH} />
                <SortTh label="Invoice" sortKey="invoice" sort={sort} searchParams={params} pathname={PATH} />
                <SortTh label="Builder" sortKey="builder" sort={sort} searchParams={params} pathname={PATH} />
                <SortTh label="Approved amount" sortKey="approved" sort={sort} searchParams={params} pathname={PATH} align="right" />
                <Th align="right">Discount</Th>
                <Th align="right">Discount amount</Th>
                <SortTh label="Net payable" sortKey="net" sort={sort} searchParams={params} pathname={PATH} align="right" />
                <SortTh label="Status" sortKey="status" sort={sort} searchParams={params} pathname={PATH} />
                <SortTh label="Accepted" sortKey="accepted" sort={sort} searchParams={params} pathname={PATH} />
                <Th>Settlement</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap">
                    <Link href={`/partner/invoices/${r.invoice.id}`} className="font-medium text-navy hover:underline">
                      {r.reference}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/partner/invoices/${r.invoice.id}`} className="text-navy hover:underline">
                      {r.invoice.invoiceNumber}
                    </Link>
                    <p className="text-xs text-muted-foreground">{r.invoice.project.name}</p>
                  </Td>
                  <Td>{r.builder.name}</Td>
                  <Td align="right">{formatINR(r.approvedAmountPaise)}</Td>
                  <Td align="right">{formatBps(r.discountRateBps)}</Td>
                  <Td align="right" className="text-[#93342a]">
                    − {formatINR(r.discountAmountPaise)}
                  </Td>
                  <Td align="right" className="font-semibold text-heritage">
                    {formatINR(r.netPayablePaise)}
                  </Td>
                  <Td>
                    <StatusBadge kind="financing" status={r.status} />
                  </Td>
                  <Td className="whitespace-nowrap">{formatDateTime(r.acceptedAt)}</Td>
                  <Td>
                    {r.settlement ? (
                      <>
                        <StatusBadge kind="settlement" status={effectiveSettlementStatus(r.settlement)} />
                        <p className="mt-1 text-xs text-muted-foreground">Due {formatDate(r.settlement.dueDate)}</p>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{r.status === "REJECTED" ? "Not applicable" : "After disbursement"}</span>
                    )}
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
