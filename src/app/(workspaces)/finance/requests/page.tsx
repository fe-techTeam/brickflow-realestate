import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { Button } from "@/components/ui/button";
import { FINANCING_STATUS } from "@/lib/status";
import { formatINRCompact, sumPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { FINANCIER_REQUEST_STATUSES, listFinancierBuilderOptions, parseLedgerFilters } from "@/server/queries/finance";
import { listFinancingRequests } from "@/server/services/financing";
import { EmptyNote, Masthead, Panel } from "../_components/ledger";
import { REQUEST_SORT_KEYS, RequestTable, requestSortAccessors } from "../_components/request-table";

export const metadata: Metadata = { title: "Financing requests · Veefin Finance" };

const PATH = "/finance/requests";

const SHORT_LABEL: Record<(typeof FINANCIER_REQUEST_STATUSES)[number], string> = {
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  DISBURSEMENT_INITIATED: "Payout in flight",
  DISBURSED: "Disbursed",
  REJECTED: "Rejected",
};

const DOT: Record<(typeof FINANCIER_REQUEST_STATUSES)[number], string> = {
  PENDING_APPROVAL: "bg-[#ffb36b]",
  APPROVED: "bg-leaf",
  DISBURSEMENT_INITIATED: "bg-night",
  DISBURSED: "bg-leaf",
  REJECTED: "bg-danger",
};

function tabHref(searchParams: Record<string, string | string[] | undefined>, status: string | null) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && k !== "status") params.set(k, v);
  if (status) params.set("status", status);
  const qs = params.toString();
  return qs ? `${PATH}?${qs}` : PATH;
}

export default async function FinancingRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("finance");
  const params = await searchParams;
  const filters = parseLedgerFilters(params);
  const sort = readSort(params, REQUEST_SORT_KEYS, { key: "date", dir: "desc" });

  const [all, builderOptions] = await Promise.all([
    listFinancingRequests(actor, { search: filters.search, builderId: filters.builderId }),
    listFinancierBuilderOptions(actor),
  ]);
  const byStatus = Object.fromEntries(FINANCIER_REQUEST_STATUSES.map((s) => [s, all.filter((r) => r.status === s)])) as Record<
    (typeof FINANCIER_REQUEST_STATUSES)[number],
    typeof all
  >;
  const visible = filters.status ? all.filter((r) => r.status === filters.status) : all;
  const rows = sortRows(visible, sort, requestSortAccessors);
  const pending = byStatus.PENDING_APPROVAL;
  const pendingValue = sumPaise(pending.map((r) => r.netPayablePaise));
  const filtered = Boolean(filters.search || filters.builderId || filters.status);

  const tabs = [
    { value: null, label: "All requests", count: all.length, valuePaise: sumPaise(all.map((r) => r.netPayablePaise)), dot: "bg-haze" },
    ...FINANCIER_REQUEST_STATUSES.map((s) => ({
      value: s,
      label: SHORT_LABEL[s],
      count: byStatus[s].length,
      valuePaise: sumPaise(byStatus[s].map((r) => r.netPayablePaise)),
      dot: DOT[s],
    })),
  ];

  return (
    <>
      <Masthead
        eyebrow="Operations · Credit desk"
        title="Financing requests"
        context={[
          <span key="p">
            <strong className="font-semibold text-fg">{pending.length}</strong> awaiting approval
          </span>,
          <span key="v">
            <strong className="tabular font-semibold text-fg">{formatINRCompact(pendingValue)}</strong> net payable pending
          </span>,
          <span key="a" className="text-muted-foreground">
            {all.length} request{all.length === 1 ? "" : "s"} on the book
          </span>,
        ]}
      />

      <nav aria-label="Filter by status" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="grid min-w-[760px] animate-fade-up grid-cols-6 overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_40px_-32px_rgba(8, 14, 24,0.3)]">
          {tabs.map((tab, i) => {
            const active = (filters.status ?? null) === tab.value;
            return (
              <li key={tab.label} className={cn(i > 0 && "border-l border-border/70")}>
                <Link
                  href={tabHref(params, tab.value)}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-full flex-col px-4 py-4 transition-colors",
                    active ? "bg-night text-white" : "hover:bg-glass/50",
                    !active && tab.value === "PENDING_APPROVAL" && tab.count > 0 && "bg-[rgba(255,255,255,0.05)]",
                  )}
                >
                  {active && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-haze" />}
                  <span className={cn("flex items-center gap-1.5 text-[0.625rem] font-semibold tracking-[0.16em] whitespace-nowrap uppercase", active ? "text-fg-muted" : "text-muted-foreground")}>
                    <span aria-hidden="true" className={cn("size-1.5 rounded-full", tab.dot)} />
                    {tab.label}
                  </span>
                  <span className={cn("tabular mt-2.5 font-sans text-[1.5rem] leading-none font-light", active ? "text-white" : "text-fg")}>{tab.count}</span>
                  <span className={cn("tabular mt-1.5 text-[0.6875rem]", active ? "text-white/60" : "text-muted-foreground")}>{formatINRCompact(tab.valuePaise)} net</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Panel
        eyebrow={filters.status ? "Filtered view" : "Complete register"}
        title={filters.status ? FINANCING_STATUS[filters.status].label : "All requests"}
        description={`${rows.length} request${rows.length === 1 ? "" : "s"} · newest first unless sorted`}
        bodyClassName="pb-0"
      >
        <div className="border-t border-border/70 py-4">
          <ListToolbar
            searchPlaceholder="Search reference, invoice, CP or builder…"
            filters={[
              { param: "status", label: "Statuses", options: FINANCIER_REQUEST_STATUSES.map((s) => ({ value: s, label: FINANCING_STATUS[s].label })) },
              { param: "builder", label: "Builders", options: builderOptions },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyNote
            icon={ListChecks}
            title={filters.status === "PENDING_APPROVAL" ? "No requests awaiting approval" : "No matching requests"}
            description={filtered ? "Nothing matches this view. Clear the filters to see every financing request." : "Requests appear here once a channel partner accepts an offer."}
            action={
              filtered ? (
                <Button asChild variant="outline">
                  <Link href={PATH}>Show all requests</Link>
                </Button>
              ) : undefined
            }
            className="border-t border-border/70"
          />
        ) : (
          <RequestTable rows={rows} sort={sort} searchParams={params} pathname={PATH} />
        )}
      </Panel>
    </>
  );
}
