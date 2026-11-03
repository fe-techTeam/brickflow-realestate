import type { Metadata } from "next";
import Link from "next/link";
import { HandCoins, SearchX } from "lucide-react";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { DemoBadge, StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import type { FinancingStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { formatBps, sumPaise } from "@/lib/money";
import { FINANCING_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { effectiveSettlementStatus, listFinancingRequests } from "@/server/services/financing";
import { Empty, Figure, Masthead, Metric, MetricStrip, Panel } from "../_components/kit";
import { Money } from "../_components/money";
import { Ledger, Ref, RowLink, SortTh, TableToolbar, Td, Tr } from "../_components/table";
import { enumParam, param, type SearchParams } from "../_lib/params";

export const metadata: Metadata = { title: "Financed invoices" };

const PATH = "/builder/financed";
const STATUS_FILTER: FinancingStatus[] = ["PENDING_APPROVAL", "APPROVED", "DISBURSEMENT_INITIATED", "DISBURSED", "REJECTED"];
const SORT_KEYS = ["invoice", "cp", "approved", "rate", "discount", "net", "status", "due"] as const;

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

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
      <Masthead
        eyebrow="Invoices"
        title="Financed invoices"
        lede="Approved invoices on which channel partners have taken early payment from Veefin. You settle the full approved amount with Veefin on each invoice's original due date."
      />

      <MetricStrip className="mb-6 grid-cols-1 sm:mb-8 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Financed value"
          accent="leaf"
          value={<Money paise={sumPaise(live.map((r) => r.approvedAmountPaise))} compact size="xl" className="font-normal" />}
          caption={`${plural(live.length, "request")}, excluding rejected`}
        />
        <Metric
          label="Net paid to partners"
          accent="basalt"
          value={<Money paise={sumPaise(disbursed.map((r) => r.netPayablePaise))} compact size="xl" className="font-normal" />}
          caption={`${plural(disbursed.length, "disbursement")} completed`}
        />
        <Metric
          label="Partner discount"
          accent="kota"
          value={<Money paise={sumPaise(live.map((r) => r.discountAmountPaise))} compact size="xl" className="font-normal" />}
          caption="Deducted from the partner's payout, never charged to you"
        />
        <Metric
          label="Pending Veefin approval"
          accent="amber"
          value={<Figure unit={pending.length === 1 ? "request" : "requests"}>{pending.length}</Figure>}
          caption={
            pending.length > 0 ? (
              <>
                <Money paise={sumPaise(pending.map((r) => r.approvedAmountPaise))} compact /> under credit review
              </>
            ) : (
              "No requests under review"
            )
          }
        />
      </MetricStrip>

      <Panel title="Financing requests" description={rows.length > 0 ? `${rows.length} of ${all.length} shown` : undefined} flush>
        <TableToolbar>
          <ListToolbar
            searchPlaceholder="Search request, invoice or partner…"
            filters={[{ param: "status", label: "Financing statuses", options: STATUS_FILTER.map((s) => ({ value: s, label: FINANCING_STATUS[s].label })) }]}
          />
        </TableToolbar>
        {rows.length === 0 ? (
          all.length === 0 ? (
            <Empty
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
            <Empty icon={SearchX} title="No requests match your filters" description="Try a different search term or clear the filters." />
          )
        ) : (
          <Ledger minWidth={960} caption="Financing requests">
            <thead>
              <tr>
                <SortTh label="Original invoice" sortKey="invoice" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Partner" sortKey="cp" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Approved" sortKey="approved" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Discount" sortKey="discount" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Net to CP" sortKey="net" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Financing · disbursement" sortKey="status" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Settlement" sortKey="due" sort={sort} searchParams={sp} pathname={PATH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const settlementStatus = r.settlement ? effectiveSettlementStatus(r.settlement) : null;
                return (
                  <Tr key={r.id}>
                    <Td>
                      <RowLink href={`/builder/invoices/${r.invoice.id}`}>{r.invoice.invoiceNumber}</RowLink>
                      <p className="mt-1 text-[0.75rem] whitespace-nowrap text-muted-foreground">
                        <Money paise={r.invoice.amountPaise} className="text-[0.75rem]" /> invoiced
                      </p>
                      <Ref>{r.reference}</Ref>
                    </Td>
                    <Td className="font-medium text-fg">{r.cp.name}</Td>
                    <Td align="right">
                      <Money paise={r.approvedAmountPaise} className="text-fg" />
                    </Td>
                    <Td align="right">
                      <Money paise={r.discountAmountPaise} sign="minus" className="text-[#ff8c80]" />
                      <p className="mt-1 text-[0.6875rem] text-muted-foreground">at {formatBps(r.discountRateBps)}</p>
                    </Td>
                    <Td align="right">
                      <Money paise={r.netPayablePaise} className="font-semibold text-leaf" />
                    </Td>
                    <Td>
                      <StatusBadge kind="financing" status={r.status} />
                      {r.disbursement ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[0.6875rem] whitespace-nowrap text-fg-soft">{r.disbursement.reference}</span>
                          <DemoBadge />
                        </div>
                      ) : (
                        <p className="mt-1.5 text-[0.75rem] text-muted-foreground">{r.status === "REJECTED" ? "Not applicable" : "Not yet disbursed"}</p>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {settlementStatus ? (
                        <StatusBadge kind="settlement" status={settlementStatus} />
                      ) : (
                        <span className="text-[0.75rem] text-muted-foreground">{r.status === "REJECTED" ? "No settlement" : "After disbursement"}</span>
                      )}
                      <p className="mt-1.5 text-[0.75rem] text-fg-soft">Due {formatDate(r.settlement?.dueDate ?? r.invoice.dueDate)}</p>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Ledger>
        )}
      </Panel>
    </>
  );
}
