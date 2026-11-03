import type { Metadata } from "next";
import Link from "next/link";
import { Download, Receipt } from "lucide-react";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { formatBps, formatINRCompact, sumPaise } from "@/lib/money";
import { FINANCING_STATUS, SETTLEMENT_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { FINANCIER_REQUEST_STATUSES, listFinanceLedger, listFinancierBuilderOptions, parseLedgerFilters, type LedgerRow } from "@/server/queries/finance";
import { Count, EmptyNote, KeyFigures, Masthead, Money, Panel } from "../_components/ledger";
import { LedgerTable, LSortTh, LTd, LTr } from "../_components/ledger-table";

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

function SettlementCell({ row }: { row: LedgerRow }) {
  const { request: r, settlementStatus } = row;
  if (r.settlement && settlementStatus) {
    return (
      <>
        <StatusBadge kind="settlement" status={settlementStatus} />
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">
          {r.settlement.settledAt ? `Settled ${formatDate(r.settlement.settledAt)}` : `Due ${formatDate(r.settlement.dueDate)}`}
        </p>
      </>
    );
  }
  if (r.status === "REJECTED") return <span className="text-muted-foreground">—</span>;
  return <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">Opens on payout · due {formatDate(r.invoice.dueDate)}</p>;
}

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
    <LSortTh label={label} sortKey={key} sort={sort} searchParams={params} pathname={PATH} align={align} />
  );

  return (
    <>
      <Masthead
        eyebrow="Operations · General ledger"
        title="Transactions"
        context={[
          <span key="r">The complete ledger of financing requests</span>,
          <span key="p">with disbursement and settlement positions</span>,
        ]}
        actions={
          <Button asChild variant="outline" className="bg-card">
            <a href={exportHref} download>
              <Download className="size-4" />
              Export CSV
            </a>
          </Button>
        }
      />

      <KeyFigures
        items={[
          { label: "Requests in view", value: <Count value={rows.length} unit={rows.length === 1 ? "record" : "records"} />, hint: "Matching the current filters" },
          {
            label: "Approved invoice value",
            value: <Money paise={sumPaise(rows.map((r) => r.request.approvedAmountPaise))} compact size="lg" />,
            hint: "Builder-approved, across requests in view",
            accent: "basalt",
          },
          {
            label: "Net disbursed",
            value: <Money paise={sumPaise(disbursed.map((r) => r.request.disbursement?.amountPaise ?? r.request.netPayablePaise))} compact size="lg" className="text-leaf" />,
            hint: `${disbursed.length} simulated payout${disbursed.length === 1 ? "" : "s"}`,
            accent: "leaf",
          },
          {
            label: "Discount earned",
            value: <Money paise={sumPaise(disbursed.map((r) => r.request.discountAmountPaise))} compact size="lg" />,
            hint: "On disbursed requests",
            accent: "kota",
          },
        ]}
      />

      <Panel className="mt-8" eyebrow="Financing ledger" title="All entries" description={`${rows.length} record${rows.length === 1 ? "" : "s"} · newest first unless sorted`} bodyClassName="pb-0">
        <div className="border-t border-border/70 py-4">
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
          <EmptyNote
            icon={Receipt}
            title="No matching transactions"
            description="Adjust or clear the filters to see more of the ledger."
            action={
              <Button asChild variant="outline">
                <Link href={PATH}>Clear filters</Link>
              </Button>
            }
            className="border-t border-border/70"
          />
        ) : (
          <>
            <ul className="-mx-5 divide-y divide-border/70 border-t border-border/70 md:hidden">
              {rows.map((row) => {
                const r = row.request;
                return (
                  <li key={r.id}>
                    <Link href={`/finance/requests/${r.id}`} className="block px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="tabular text-sm font-medium text-fg">{r.reference}</p>
                          <p className="truncate text-xs text-fg-soft/80">
                            {r.cp.name} to {r.builder.name}
                          </p>
                        </div>
                        <StatusBadge kind="financing" status={r.status} />
                      </div>
                      <div className="mt-3 flex items-end justify-between gap-3">
                        <div>
                          <Money paise={r.netPayablePaise} size="md" className="text-leaf" />
                          <p className="text-[0.6875rem] text-muted-foreground">
                            on <Money paise={r.approvedAmountPaise} size="xs" className="font-normal" /> at {formatBps(r.discountRateBps)}
                          </p>
                        </div>
                        <div className="text-right">
                          <SettlementCell row={row} />
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <LedgerTable minWidth={1040} className="hidden md:block">
              <thead>
                <tr>
                  {th("Request", "reference")}
                  {th("Counterparties", "cp")}
                  {th("Approved", "approved", "right")}
                  {th("Net payable", "net", "right")}
                  {th("Status", "status")}
                  {th("Disbursed", "disbursed")}
                  {th("Settlement", "due")}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const r = row.request;
                  return (
                    <LTr key={r.id}>
                      <LTd className="whitespace-nowrap">
                        <Link href={`/finance/requests/${r.id}`} className="tabular font-medium tracking-wide text-fg underline-offset-4 hover:underline">
                          {r.reference}
                        </Link>
                        <p className="tabular mt-0.5 text-xs text-fg-soft/80">{r.invoice.invoiceNumber}</p>
                        <p className="text-[0.6875rem] text-muted-foreground">{formatDate(r.createdAt)}</p>
                      </LTd>
                      <LTd className="min-w-44">
                        <span className="text-fg">{r.cp.name}</span>
                        <p className="text-xs text-muted-foreground">to {r.builder.name}</p>
                      </LTd>
                      <LTd align="right">
                        <Money paise={r.approvedAmountPaise} className="font-normal text-fg-soft" />
                        <p className="mt-0.5 text-[0.6875rem] whitespace-nowrap text-muted-foreground">
                          <Money paise={r.discountAmountPaise} sign="−" size="xs" className="font-normal text-danger" /> at {formatBps(r.discountRateBps)}
                        </p>
                      </LTd>
                      <LTd align="right">
                        <Money paise={r.netPayablePaise} className="font-semibold text-leaf" />
                      </LTd>
                      <LTd>
                        <StatusBadge kind="financing" status={r.status} />
                      </LTd>
                      <LTd className="text-xs whitespace-nowrap">{formatDate(r.disbursement?.completedAt)}</LTd>
                      <LTd className="min-w-36">
                        <SettlementCell row={row} />
                      </LTd>
                    </LTr>
                  );
                })}
              </tbody>
            </LedgerTable>
          </>
        )}
      </Panel>

      <p className="mt-6 text-xs text-muted-foreground">
        Totals are computed on the rows in view. {formatINRCompact(sumPaise(rows.map((r) => r.request.netPayablePaise)))} net payable across this selection.
      </p>
    </>
  );
}
