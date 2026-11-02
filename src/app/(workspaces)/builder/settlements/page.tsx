import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, Info, Landmark, SearchX } from "lucide-react";
import { DataTable, readSort, SortTh, sortRows, Td, Th, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import type { SettlementStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { SETTLEMENT_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { listBuilderSettlements, type BuilderSettlement } from "@/server/queries/builder";
import { ToolbarRow } from "../_components/toolbar-row";
import { calendarDaysUntil } from "../_lib/dates";
import { enumParam, param, type SearchParams } from "../_lib/params";

export const metadata: Metadata = { title: "Settlements" };

const PATH = "/builder/settlements";
const STATUSES: SettlementStatus[] = ["NOT_DUE", "DUE", "OVERDUE", "SETTLED"];
const STATUS_ORDER: Record<SettlementStatus, number> = { OVERDUE: 0, DUE: 1, NOT_DUE: 2, SETTLED: 3 };
const SORT_KEYS = ["request", "cp", "amount", "due", "status"] as const;

function DaysCell({ settlement, now }: { settlement: BuilderSettlement; now: Date }) {
  if (settlement.effectiveStatus === "SETTLED") {
    const days = settlement.settledAt ? calendarDaysUntil(settlement.dueDate, settlement.settledAt) : null;
    return <span className="text-xs text-muted-foreground">{days === null ? "Settled" : days >= 0 ? "Settled on time" : `Settled ${-days} ${days === -1 ? "day" : "days"} late`}</span>;
  }
  const days = calendarDaysUntil(settlement.dueDate, now);
  if (days === 0) return <span className="text-sm font-medium text-[#8a5a12]">Due today</span>;
  if (days < 0) return <span className="text-sm font-medium text-[#93342a]">{-days} {days === -1 ? "day" : "days"} overdue</span>;
  return <span className={cn("text-sm", days <= 7 ? "font-medium text-[#8a5a12]" : "text-slate-ink")}>{days} {days === 1 ? "day" : "days"} to due</span>;
}

export default async function SettlementsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireWorkspace("builder");
  const sp = await searchParams;
  const { settlements, awaitingDisbursement } = await listBuilderSettlements(actor);
  const now = new Date();

  const q = param(sp, "q")?.toLowerCase();
  const status = enumParam(sp, "status", STATUSES);
  const sort = readSort(sp, SORT_KEYS, { key: "due", dir: "asc" });

  const filtered = settlements.filter(
    (s) =>
      (!status || s.effectiveStatus === status) &&
      (!q || [s.request.reference, s.request.invoice.invoiceNumber, s.request.invoice.reference, s.request.cp.name, s.reference ?? ""].some((v) => v.toLowerCase().includes(q))),
  );
  const rows = sortRows(filtered, sort, {
    request: (s) => s.request.reference,
    cp: (s) => s.request.cp.name,
    amount: (s) => s.amountPaise,
    due: (s) => s.dueDate,
    status: (s) => STATUS_ORDER[s.effectiveStatus],
  });

  const totals = Object.fromEntries(
    STATUSES.map((st) => {
      const group = settlements.filter((s) => s.effectiveStatus === st);
      return [st, { count: group.length, value: sumPaise(group.map((s) => s.amountPaise)) }];
    }),
  ) as Record<SettlementStatus, { count: number; value: bigint }>;
  const countLabel = (n: number) => `${n} ${n === 1 ? "settlement" : "settlements"}`;

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Settlements"
        description="What you owe Veefin for invoices it paid early to your channel partners. Each settlement is the full approved invoice amount, due on the invoice's original due date."
      />

      <StatGrid className="mb-6 xl:grid-cols-4 2xl:grid-cols-4">
        <StatCard label="Not due" value={formatINRCompact(totals.NOT_DUE.value)} hint={countLabel(totals.NOT_DUE.count)} icon={CalendarDays} />
        <StatCard label="Due today" value={formatINRCompact(totals.DUE.value)} hint={countLabel(totals.DUE.count)} icon={CalendarClock} tone="gold" />
        <StatCard label="Overdue" value={formatINRCompact(totals.OVERDUE.value)} hint={countLabel(totals.OVERDUE.count)} icon={AlertTriangle} tone="slate" />
        <StatCard label="Settled" value={formatINRCompact(totals.SETTLED.value)} hint={countLabel(totals.SETTLED.count)} icon={CheckCircle2} tone="heritage" />
      </StatGrid>

      <div className="mb-6 flex animate-fade-up gap-3 rounded-lg border border-heritage/15 bg-sage/60 px-5 py-4 text-sm text-heritage">
        <Info className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1 leading-relaxed">
          <p>
            <span className="font-semibold">Settlement is recorded by Veefin.</span> Pay the approved amount to Veefin on or before the due date; Veefin marks the
            settlement as settled once your payment is received. Your credit period with each channel partner is unchanged, and the discount is borne by the partner.
          </p>
          {awaitingDisbursement.count > 0 && (
            <p className="text-heritage/85">
              {awaitingDisbursement.count} approved {awaitingDisbursement.count === 1 ? "request" : "requests"} ({formatINRCompact(awaitingDisbursement.value)}) will appear here
              once Veefin completes the disbursement.
            </p>
          )}
        </div>
      </div>

      <Section title="Settlement schedule" description={rows.length > 0 ? `${rows.length} of ${settlements.length} shown · read-only` : "Read-only"} bodyClassName="py-0">
        <ToolbarRow>
          <ListToolbar
            searchPlaceholder="Search request, invoice, partner or reference…"
            filters={[{ param: "status", label: "Statuses", options: STATUSES.map((s) => ({ value: s, label: SETTLEMENT_STATUS[s].label })) }]}
          />
        </ToolbarRow>
        {rows.length === 0 ? (
          settlements.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="Nothing owed to Veefin"
              description="Settlements are created when Veefin pays a channel partner early on one of your approved invoices."
              action={
                <Button variant="outline" asChild>
                  <Link href="/builder/financed">View financed invoices</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState icon={SearchX} title="No settlements match your filters" description="Try a different search term or clear the filters." />
          )
        ) : (
          <DataTable minWidth={1000}>
            <thead>
              <tr>
                <SortTh label="Request" sortKey="request" sort={sort} searchParams={sp} pathname={PATH} />
                <Th>Invoice</Th>
                <SortTh label="Partner" sortKey="cp" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Amount due" sortKey="amount" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Due date" sortKey="due" sort={sort} searchParams={sp} pathname={PATH} />
                <Th>Days to due</Th>
                <SortTh label="Status" sortKey="status" sort={sort} searchParams={sp} pathname={PATH} />
                <Th>Settled</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <p className="font-mono text-xs text-navy">{s.request.reference}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Payable to {s.request.financier.name}</p>
                  </Td>
                  <Td>
                    <Link href={`/builder/invoices/${s.request.invoice.id}`} className="font-medium text-navy underline-offset-4 hover:underline">
                      {s.request.invoice.invoiceNumber}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.request.invoice.project.name}</p>
                  </Td>
                  <Td className="font-medium text-navy">{s.request.cp.name}</Td>
                  <Td align="right" className="font-semibold text-navy">
                    {formatINR(s.amountPaise)}
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(s.dueDate)}</Td>
                  <Td className="whitespace-nowrap">
                    <DaysCell settlement={s} now={now} />
                  </Td>
                  <Td>
                    <StatusBadge kind="settlement" status={s.effectiveStatus} />
                  </Td>
                  <Td>
                    {s.effectiveStatus === "SETTLED" ? (
                      <>
                        <p className="whitespace-nowrap">{formatDate(s.settledAt)}</p>
                        {s.reference && <p className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">{s.reference}</p>}
                      </>
                    ) : (
                      <span className="text-xs whitespace-nowrap text-muted-foreground">Awaiting payment</span>
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
