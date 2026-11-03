import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { SortState } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import type { FinancingStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { formatBps } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { FinancingRequestListItem } from "@/server/services/financing";
import { Money } from "./ledger";
import { LedgerTable, LSortTh, LTd, LTh, LTr } from "./ledger-table";

export const REQUEST_SORT_KEYS = ["cp", "builder", "invoice", "approved", "rate", "net", "date", "status"] as const;

export const requestSortAccessors: Record<(typeof REQUEST_SORT_KEYS)[number], (row: FinancingRequestListItem) => string | number | bigint | Date> = {
  cp: (r) => r.cp.name,
  builder: (r) => r.builder.name,
  invoice: (r) => r.invoice.invoiceNumber,
  approved: (r) => r.approvedAmountPaise,
  rate: (r) => r.discountRateBps,
  net: (r) => r.netPayablePaise,
  date: (r) => r.createdAt,
  status: (r) => r.status,
};

const NEXT_STEP: Partial<Record<FinancingStatus, { label: string; variant: "default" | "success" | "accent" | "outline" }>> = {
  PENDING_APPROVAL: { label: "Review", variant: "default" },
  APPROVED: { label: "Disburse", variant: "accent" },
  DISBURSEMENT_INITIATED: { label: "Confirm", variant: "default" },
};

export function RequestActionLink({ id, status, compact = false, className }: { id: string; status: FinancingStatus; compact?: boolean; className?: string }) {
  const step = NEXT_STEP[status] ?? { label: "Open", variant: "outline" as const };
  return (
    <Button asChild size="sm" variant={step.variant} className={className}>
      <Link href={`/finance/requests/${id}`} aria-label={`${step.label} request`} title={compact ? `${step.label} request` : undefined}>
        <span className={compact ? "hidden 2xl:inline" : undefined}>{step.label}</span>
        <ArrowRight className="size-3.5" />
      </Link>
    </Button>
  );
}

/** Lets long invoice numbers wrap after their separators instead of widening the column. */
function Breakable({ text }: { text: string }) {
  const parts = text.split(/(?<=[/-])/);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <wbr />}
        </span>
      ))}
    </>
  );
}

type Column = "cp" | "builder";
type SortKey = (typeof REQUEST_SORT_KEYS)[number];

/** Financing requests: a refined table from md up, stacked case cards below. */
export function RequestTable({
  rows,
  hide = [],
  sort,
  searchParams = {},
  pathname = "/finance/requests",
}: {
  rows: FinancingRequestListItem[];
  hide?: Column[];
  sort?: SortState;
  searchParams?: Record<string, string | string[] | undefined>;
  pathname?: string;
}) {
  const showCp = !hide.includes("cp");
  const showBuilder = !hide.includes("builder");
  const builderColumn = showCp ? "hidden 2xl:table-cell" : undefined;

  const header = (label: string, key: SortKey, align: "left" | "right" = "left", className?: string) =>
    sort ? (
      <LSortTh label={label} sortKey={key} sort={sort} searchParams={searchParams} pathname={pathname} align={align} className={className} />
    ) : (
      <LTh align={align} className={className}>
        {label}
      </LTh>
    );

  return (
    <>
      <ul className="-mx-5 divide-y divide-border/70 border-t border-border/70 md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/finance/requests/${r.id}`} className="block px-5 py-4 transition-colors active:bg-glass/60">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{showCp ? r.cp.name : r.builder.name}</p>
                  {showCp && showBuilder && <p className="truncate text-xs text-fg-soft/80">to {r.builder.name}</p>}
                  <p className="tabular mt-0.5 text-[0.6875rem] tracking-wide text-muted-foreground">
                    {r.reference} · {r.invoice.invoiceNumber}
                  </p>
                </div>
                <StatusBadge kind="financing" status={r.status} />
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Net payable</p>
                  <Money paise={r.netPayablePaise} size="md" className="text-leaf" />
                </div>
                <p className="text-right text-xs text-muted-foreground">
                  <Money paise={r.approvedAmountPaise} size="xs" className="font-normal" /> at {formatBps(r.discountRateBps)}
                  <span className="block">{formatDate(r.createdAt)}</span>
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <LedgerTable minWidth={960} className="hidden md:block">
        <thead>
          <tr>
            {showCp && header("Channel partner", "cp")}
            {showBuilder && header("Builder", "builder", "left", builderColumn)}
            {header("Invoice", "invoice")}
            {header("Approved", "approved", "right")}
            {header("Rate", "rate", "right")}
            {header("Net payable", "net", "right")}
            {header("Requested", "date")}
            {header("Status", "status")}
            <LTh align="right">
              <span className="sr-only">Action</span>
            </LTh>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <LTr key={r.id}>
              {showCp && (
                <LTd className="min-w-44">
                  <Link href={`/finance/requests/${r.id}`} className="font-medium text-fg underline-offset-4 hover:underline">
                    {r.cp.name}
                  </Link>
                  {showBuilder && <p className="text-xs text-fg-soft/80 2xl:hidden">to {r.builder.name}</p>}
                  <p className="tabular mt-0.5 text-[0.6875rem] tracking-wide text-muted-foreground">{r.reference}</p>
                </LTd>
              )}
              {showBuilder && (
                <LTd className={cn("min-w-36", builderColumn)}>
                  <span className="text-fg">{r.builder.name}</span>
                  {!showCp && <p className="tabular mt-0.5 text-[0.6875rem] tracking-wide text-muted-foreground">{r.reference}</p>}
                </LTd>
              )}
              <LTd className="min-w-36">
                <span className="tabular text-fg">
                  <Breakable text={r.invoice.invoiceNumber} />
                </span>
                <p className="text-xs text-muted-foreground">{r.invoice.project.name}</p>
              </LTd>
              <LTd align="right">
                <Money paise={r.approvedAmountPaise} className="font-normal text-fg-soft" />
              </LTd>
              <LTd align="right" className="text-fg-soft">
                {formatBps(r.discountRateBps)}
              </LTd>
              <LTd align="right">
                <Money paise={r.netPayablePaise} className="font-semibold text-leaf" />
              </LTd>
              <LTd className="text-xs whitespace-nowrap">{formatDate(r.createdAt)}</LTd>
              <LTd>
                <StatusBadge kind="financing" status={r.status} />
              </LTd>
              <LTd align="right">
                <RequestActionLink id={r.id} status={r.status} compact={showCp && showBuilder} />
              </LTd>
            </LTr>
          ))}
        </tbody>
      </LedgerTable>
    </>
  );
}
