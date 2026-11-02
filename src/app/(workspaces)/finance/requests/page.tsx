import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { Button } from "@/components/ui/button";
import { FINANCING_STATUS } from "@/lib/status";
import { formatINR, sumPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { FINANCIER_REQUEST_STATUSES, listFinancierBuilderOptions, parseLedgerFilters } from "@/server/queries/finance";
import { listFinancingRequests } from "@/server/services/financing";
import { REQUEST_SORT_KEYS, RequestTable, requestSortAccessors } from "../_components/request-table";

export const metadata: Metadata = { title: "Financing requests · Veefin Finance" };

const PATH = "/finance/requests";

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
  const counts = Object.fromEntries(FINANCIER_REQUEST_STATUSES.map((s) => [s, all.filter((r) => r.status === s).length]));
  const visible = filters.status ? all.filter((r) => r.status === filters.status) : all;
  const rows = sortRows(visible, sort, requestSortAccessors);
  const pendingValue = sumPaise(all.filter((r) => r.status === "PENDING_APPROVAL").map((r) => r.netPayablePaise));

  const tabs = [{ value: null, label: "All", count: all.length }, ...FINANCIER_REQUEST_STATUSES.map((s) => ({ value: s, label: FINANCING_STATUS[s].label, count: counts[s] ?? 0 }))];

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Financing requests"
        description="Early-payment requests accepted by channel partners on builder-approved invoices. Approve or reject pending requests, then disburse."
        actions={
          counts.PENDING_APPROVAL ? (
            <p className="rounded-md border border-[#efd9ae] bg-[#fbf1df] px-3 py-2 text-xs text-[#8a5a12]">
              <span className="tabular font-semibold">{counts.PENDING_APPROVAL}</span> pending approval ·{" "}
              <span className="tabular font-semibold">{formatINR(pendingValue)}</span> net payable
            </p>
          ) : undefined
        }
      />

      <nav aria-label="Filter by status" className="mb-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-1 rounded-lg border border-border bg-card p-1">
          {tabs.map((tab) => {
            const active = (filters.status ?? null) === tab.value;
            return (
              <li key={tab.label}>
                <Link
                  href={tabHref(params, tab.value)}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                    active ? "bg-navy text-white" : "text-slate-ink hover:bg-muted",
                  )}
                >
                  {tab.label}
                  <span
                    className={cn(
                      "tabular rounded-full px-1.5 py-px text-[0.625rem] font-semibold",
                      active ? "bg-white/15 text-white" : tab.value === "PENDING_APPROVAL" && tab.count > 0 ? "bg-[#fbf1df] text-[#8a5a12]" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {tab.count}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Section
        title={filters.status ? FINANCING_STATUS[filters.status].label : "All requests"}
        description={`${rows.length} request${rows.length === 1 ? "" : "s"} · newest first unless sorted`}
        bodyClassName="p-0 sm:p-0"
      >
        <div className="border-b border-border/80 px-5 py-4 sm:px-6">
          <ListToolbar
            searchPlaceholder="Search reference, invoice, CP or builder…"
            filters={[
              { param: "status", label: "Statuses", options: FINANCIER_REQUEST_STATUSES.map((s) => ({ value: s, label: FINANCING_STATUS[s].label })) },
              { param: "builder", label: "Builders", options: builderOptions },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={filters.status === "PENDING_APPROVAL" ? "No requests awaiting approval" : "No matching requests"}
            description={
              filters.search || filters.builderId || filters.status ? "Try clearing the filters to see every financing request." : "Requests appear here once a channel partner accepts an offer."
            }
            action={
              filters.search || filters.builderId || filters.status ? (
                <Button asChild variant="outline">
                  <Link href={PATH}>Show all requests</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="px-5 sm:px-6">
            <RequestTable rows={rows} sort={sort} searchParams={params} pathname={PATH} />
          </div>
        )}
      </Section>
    </>
  );
}
