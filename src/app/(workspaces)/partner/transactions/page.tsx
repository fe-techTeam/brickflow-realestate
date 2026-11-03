import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Receipt, SearchX } from "lucide-react";
import type { FinancingStatus } from "@/generated/prisma/enums";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps, sumPaise } from "@/lib/money";
import { FINANCING_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { effectiveSettlementStatus, listFinancingRequests } from "@/server/services/financing";
import { CompactMoney, Money } from "../_components/money";
import { firstParam } from "../_components/summaries";
import { RefCell, SortTh, Table, TableToolbar, Td, Th, Tr } from "../_components/table";
import { EmptyNote, MetricStrip, PageIntro, Panel, SimulatedTag, StatusMark } from "../_components/ui";

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
      <PageIntro
        eyebrow="Early payment"
        title="My Transactions"
        description="Every early payment request you have made, with the agreed discount and its progress through Veefin approval and payout."
        actions={<SimulatedTag label="Simulated payments" />}
      />

      <MetricStrip
        className="mb-8"
        items={[
          { label: "Financing requests", value: <span className="text-[1.875rem] leading-none font-normal tabular">{all.length}</span>, hint: `${live.length} active or completed` },
          {
            label: "Approved amount financed",
            value: <CompactMoney paise={sumPaise(live.map((r) => r.approvedAmountPaise))} size="xl" />,
            hint: "Excludes rejected requests",
            accent: "slate",
          },
          {
            label: "Pending Veefin approval",
            value: <CompactMoney paise={sumPaise(pending.map((r) => r.netPayablePaise))} size="xl" />,
            hint: `${pending.length} ${pending.length === 1 ? "request" : "requests"} · net payable`,
            accent: "gold",
            href: `${PATH}?status=PENDING_APPROVAL`,
          },
          {
            label: "Received",
            value: <CompactMoney paise={sumPaise(disbursed.map((r) => r.netPayablePaise))} size="xl" />,
            hint: `${disbursed.length} disbursed`,
            accent: "heritage",
            href: "/partner/disbursements",
          },
        ]}
      />

      <Panel eyebrow={status || search ? "Filtered view" : "All requests"} title={`${rows.length} ${rows.length === 1 ? "request" : "requests"}`} bodyClassName="pb-0">
        <TableToolbar>
          <ListToolbar
            searchPlaceholder="Search request reference, invoice or builder"
            filters={[{ param: "status", label: "Statuses", options: STATUS_FILTERS.map((s) => ({ value: s, label: FINANCING_STATUS[s].label })) }]}
          />
        </TableToolbar>
        {rows.length === 0 ? (
          <div className="-mx-5 border-t border-hairline sm:-mx-7">
            {all.length === 0 ? (
              <EmptyNote
                icon={Receipt}
                title="No financing requests yet"
                description="Accept an early payment offer on an approved invoice and it will be tracked here."
                action={
                  <Button size="sm" asChild>
                    <Link href="/partner/offers">View financing offers</Link>
                  </Button>
                }
              />
            ) : (
              <EmptyNote icon={SearchX} title="No requests match your filters" description="Try a different search term or clear the filters." />
            )}
          </div>
        ) : (
          <>
            <ul className="-mx-5 divide-y divide-hairline border-t border-hairline md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/partner/invoices/${r.invoice.id}`} className="flex items-start gap-3 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-medium text-navy">{r.invoice.invoiceNumber}</p>
                        <Money paise={r.netPayablePaise} className="font-semibold text-heritage" />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {r.reference} · {formatBps(r.discountRateBps)} on <Money paise={r.approvedAmountPaise} />
                      </p>
                      <StatusMark kind="financing" status={r.status} className="mt-2.5 text-xs" />
                    </div>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>

            <Table minWidth={1180} className="hidden md:block">
              <thead>
                <tr>
                  <SortTh label="Request" sortKey="reference" sort={sort} searchParams={params} pathname={PATH} />
                  <SortTh label="Invoice" sortKey="invoice" sort={sort} searchParams={params} pathname={PATH} />
                  <SortTh label="Approved" sortKey="approved" sort={sort} searchParams={params} pathname={PATH} align="right" />
                  <Th align="right">Discount</Th>
                  <SortTh label="Net payable" sortKey="net" sort={sort} searchParams={params} pathname={PATH} align="right" />
                  <SortTh label="Status" sortKey="status" sort={sort} searchParams={params} pathname={PATH} />
                  <SortTh label="Accepted" sortKey="accepted" sort={sort} searchParams={params} pathname={PATH} />
                  <Th>Settlement</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <RefCell href={`/partner/invoices/${r.invoice.id}`} primary={r.reference} secondary={r.builder.name} />
                    </Td>
                    <Td>
                      <RefCell href={`/partner/invoices/${r.invoice.id}`} primary={r.invoice.invoiceNumber} secondary={r.invoice.project.name} />
                    </Td>
                    <Td align="right">
                      <Money paise={r.approvedAmountPaise} />
                    </Td>
                    <Td align="right">
                      <Money paise={r.discountAmountPaise} sign="minus" className="text-danger" />
                      <p className="mt-0.5 text-xs text-muted-foreground">{formatBps(r.discountRateBps)}</p>
                    </Td>
                    <Td align="right">
                      <Money paise={r.netPayablePaise} className="font-semibold text-heritage" />
                    </Td>
                    <Td>
                      <StatusMark kind="financing" status={r.status} />
                    </Td>
                    <Td className="text-[0.8125rem] whitespace-nowrap">{formatDateTime(r.acceptedAt)}</Td>
                    <Td>
                      {r.settlement ? (
                        <>
                          <StatusMark kind="settlement" status={effectiveSettlementStatus(r.settlement)} />
                          <p className="mt-1 text-xs text-muted-foreground">Due {formatDate(r.settlement.dueDate)}</p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">{r.status === "REJECTED" ? "Not applicable" : "After disbursement"}</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </Panel>
    </>
  );
}
