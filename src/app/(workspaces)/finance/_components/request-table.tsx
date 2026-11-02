import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown } from "lucide-react";
import { DataTable, Td, Th, Tr, type SortDirection, type SortState } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import type { FinancingStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { formatBps, formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { FinancingRequestListItem } from "@/server/services/financing";

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

const NEXT_STEP: Partial<Record<FinancingStatus, { label: string; variant: "default" | "success" | "gold" | "outline" }>> = {
  PENDING_APPROVAL: { label: "Review", variant: "default" },
  APPROVED: { label: "Disburse", variant: "gold" },
  DISBURSEMENT_INITIATED: { label: "Confirm", variant: "default" },
};

export function RequestActionLink({ id, status, compact = false }: { id: string; status: FinancingStatus; compact?: boolean }) {
  const step = NEXT_STEP[status] ?? { label: "View", variant: "outline" as const };
  return (
    <Button asChild size="sm" variant={step.variant}>
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

function sortHref(searchParams: Record<string, string | string[] | undefined>, pathname: string, key: string, dir: SortDirection) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && k !== "sort" && k !== "dir") params.set(k, v);
  params.set("sort", key);
  params.set("dir", dir);
  return `${pathname}?${params.toString()}`;
}

/** Financing requests table; sortable when `sort` is provided. Below 2xl the builder is shown under the CP to keep every column visible. */
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

  const header = (label: string, key: SortKey, align: "left" | "right" = "left", className?: string) => {
    if (!sort) {
      return (
        <Th align={align} className={className}>
          {label}
        </Th>
      );
    }
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <Th align={align} className={className}>
        <Link
          href={sortHref(searchParams, pathname, key, active && sort.dir === "desc" ? "asc" : "desc")}
          scroll={false}
          className={cn("inline-flex items-center gap-1 hover:text-navy", active && "text-navy")}
          aria-label={`Sort by ${label}`}
        >
          {label}
          <Icon className="size-3" />
        </Link>
      </Th>
    );
  };

  return (
    <DataTable minWidth={960}>
      <thead>
        <tr>
          {showCp && header("Channel partner", "cp")}
          {showBuilder && header("Builder", "builder", "left", builderColumn)}
          {header("Invoice no.", "invoice")}
          {header("Approved", "approved", "right")}
          {header("Rate", "rate", "right")}
          {header("Net payable", "net", "right")}
          {header("Requested", "date")}
          {header("Status", "status")}
          <Th align="right">
            <span className="sr-only">Action</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.id}>
            {showCp && (
              <Td className="min-w-44">
                <Link href={`/finance/requests/${r.id}`} className="font-medium text-navy hover:underline">
                  {r.cp.name}
                </Link>
                {showBuilder && <p className="text-xs text-slate-ink 2xl:hidden">→ {r.builder.name}</p>}
                <p className="tabular text-xs text-muted-foreground">{r.reference}</p>
              </Td>
            )}
            {showBuilder && (
              <Td className={cn("min-w-36", builderColumn)}>
                <span className="text-slate-ink">{r.builder.name}</span>
                {!showCp && <p className="tabular text-xs text-muted-foreground">{r.reference}</p>}
              </Td>
            )}
            <Td className="min-w-36">
              <span className="tabular">
                <Breakable text={r.invoice.invoiceNumber} />
              </span>
              <p className="text-xs text-muted-foreground">{r.invoice.project.name}</p>
            </Td>
            <Td align="right">{formatINR(r.approvedAmountPaise)}</Td>
            <Td align="right">{formatBps(r.discountRateBps)}</Td>
            <Td align="right" className="font-medium text-heritage">
              {formatINR(r.netPayablePaise)}
            </Td>
            <Td className="whitespace-nowrap">{formatDate(r.createdAt)}</Td>
            <Td>
              <StatusBadge kind="financing" status={r.status} />
            </Td>
            <Td align="right">
              <RequestActionLink id={r.id} status={r.status} compact={showCp && showBuilder} />
            </Td>
          </Tr>
        ))}
      </tbody>
    </DataTable>
  );
}
