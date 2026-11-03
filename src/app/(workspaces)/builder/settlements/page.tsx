import type { Metadata } from "next";
import Link from "next/link";
import { Info, Landmark, SearchX } from "lucide-react";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import type { SettlementStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { sumPaise } from "@/lib/money";
import { SETTLEMENT_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { listBuilderSettlements, type BuilderSettlement } from "@/server/queries/builder";
import { BucketBar, type Bucket } from "../_components/ageing";
import { CARD, Callout, Empty, Masthead, Panel } from "../_components/kit";
import { Money } from "../_components/money";
import { Ledger, Ref, RowLink, SortTh, TableToolbar, Td, Th, Tr } from "../_components/table";
import { calendarDaysUntil } from "../_lib/dates";
import { enumParam, param, type SearchParams } from "../_lib/params";

export const metadata: Metadata = { title: "Settlements" };

const PATH = "/builder/settlements";
const STATUSES: SettlementStatus[] = ["NOT_DUE", "DUE", "OVERDUE", "SETTLED"];
const STATUS_ORDER: Record<SettlementStatus, number> = { OVERDUE: 0, DUE: 1, NOT_DUE: 2, SETTLED: 3 };
const SORT_KEYS = ["request", "cp", "amount", "due", "status"] as const;

const MATURITY: { key: string; label: string; tone: Bucket["tone"]; test: (days: number) => boolean }[] = [
  { key: "overdue", label: "Overdue", tone: "rose", test: (d) => d < 0 },
  { key: "today", label: "Due today", tone: "amber", test: (d) => d === 0 },
  { key: "week", label: "Within 7 days", tone: "kota", test: (d) => d > 0 && d <= 7 },
  { key: "month", label: "8–30 days", tone: "basalt", test: (d) => d > 7 && d <= 30 },
  { key: "later", label: "Beyond 30 days", tone: "slate", test: (d) => d > 30 },
];

function DaysCell({ settlement, now }: { settlement: BuilderSettlement; now: Date }) {
  if (settlement.effectiveStatus === "SETTLED") {
    const days = settlement.settledAt ? calendarDaysUntil(settlement.dueDate, settlement.settledAt) : null;
    return (
      <span className="text-[0.75rem] text-leaf">
        {days === null ? "Settled" : days >= 0 ? "Settled on time" : `Settled ${-days} ${days === -1 ? "day" : "days"} late`}
      </span>
    );
  }
  const days = calendarDaysUntil(settlement.dueDate, now);
  if (days === 0) return <span className="font-medium text-[#8a5a12]">Due today</span>;
  if (days < 0) return <span className="font-medium text-[#8a1f37]">{-days} {days === -1 ? "day" : "days"} overdue</span>;
  return (
    <span className={cn("tabular", days <= 7 ? "font-medium text-[#8a5a12]" : "text-ink")}>
      {days} {days === 1 ? "day" : "days"} to due
    </span>
  );
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

  const open = settlements.filter((s) => s.effectiveStatus !== "SETTLED");
  const settled = settlements.filter((s) => s.effectiveStatus === "SETTLED");
  const maturity: Bucket[] = MATURITY.map((band) => {
    const group = open.filter((s) => band.test(calendarDaysUntil(s.dueDate, now)));
    return { key: band.key, label: band.label, tone: band.tone, count: group.length, value: sumPaise(group.map((s) => s.amountPaise)) };
  });

  return (
    <>
      <Masthead
        eyebrow="Finance"
        title="Settlements"
        lede="What you owe Veefin for invoices it paid early to your channel partners. Each settlement is the full approved invoice amount, due on the invoice's original due date."
      />

      <section className={cn(CARD, "mb-6 grid animate-fade-up gap-px overflow-hidden bg-[#e4e7e3] lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]")}>
        <div className="bg-basalt px-5 py-6 text-white sm:px-7">
          <p className="flex items-center gap-2 text-[0.625rem] font-semibold tracking-[0.18em] text-kota uppercase">
            <Landmark className="size-3.5" />
            Owed to Veefin
          </p>
          <Money paise={sumPaise(open.map((s) => s.amountPaise))} compact size="xl" className="mt-4 font-light text-white" />
          <p className="mt-2 text-[0.75rem] text-white/60">
            {open.length} open {open.length === 1 ? "settlement" : "settlements"}
          </p>
          <div className="mt-5 border-t border-white/10 pt-4 text-[0.75rem] text-white/60">
            <Money paise={sumPaise(settled.map((s) => s.amountPaise))} compact className="font-medium text-white/85" /> settled to date · {settled.length}
          </div>
        </div>
        <div className="bg-card px-5 py-6 sm:px-7">
          <p className="mb-4 text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Maturity of open settlements</p>
          <BucketBar buckets={maturity} format={(v) => <Money paise={v} compact className="text-[0.9375rem] font-medium" />} />
        </div>
      </section>

      <Callout icon={Info} title="Settlement is recorded by Veefin" className="mb-6 animate-fade-up sm:mb-8">
        Pay the approved amount to Veefin on or before the due date; Veefin marks the settlement as settled once your payment is received. Your credit period with each
        channel partner is unchanged, and the discount is borne by the partner.
        {awaitingDisbursement.count > 0 && (
          <span className="mt-1 block">
            {awaitingDisbursement.count} approved {awaitingDisbursement.count === 1 ? "request" : "requests"} (
            <Money paise={awaitingDisbursement.value} compact />) will appear here once Veefin completes the disbursement.
          </span>
        )}
      </Callout>

      <Panel title="Settlement schedule" description={rows.length > 0 ? `${rows.length} of ${settlements.length} shown · read-only` : "Read-only"} flush>
        <TableToolbar>
          <ListToolbar
            searchPlaceholder="Search request, invoice, partner or reference…"
            filters={[{ param: "status", label: "Statuses", options: STATUSES.map((s) => ({ value: s, label: SETTLEMENT_STATUS[s].label })) }]}
          />
        </TableToolbar>
        {rows.length === 0 ? (
          settlements.length === 0 ? (
            <Empty
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
            <Empty icon={SearchX} title="No settlements match your filters" description="Try a different search term or clear the filters." />
          )
        ) : (
          <Ledger minWidth={1060} caption="Settlement schedule">
            <thead>
              <tr>
                <SortTh label="Due date" sortKey="due" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Request" sortKey="request" sort={sort} searchParams={sp} pathname={PATH} />
                <Th>Invoice</Th>
                <SortTh label="Partner" sortKey="cp" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Amount due" sortKey="amount" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <Th>Days to due</Th>
                <SortTh label="Status" sortKey="status" sort={sort} searchParams={sp} pathname={PATH} />
                <Th>Settled</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <Tr key={s.id}>
                  <Td className="whitespace-nowrap">
                    <span className="font-medium text-basalt">{formatDate(s.dueDate)}</span>
                  </Td>
                  <Td>
                    <p className="font-mono text-[0.75rem] text-basalt">{s.request.reference}</p>
                    <p className="mt-1 text-[0.75rem] text-muted-foreground">Payable to {s.request.financier.name}</p>
                  </Td>
                  <Td>
                    <RowLink href={`/builder/invoices/${s.request.invoice.id}`}>{s.request.invoice.invoiceNumber}</RowLink>
                    <p className="mt-1 text-[0.75rem] text-muted-foreground">{s.request.invoice.project.name}</p>
                  </Td>
                  <Td className="font-medium text-basalt">{s.request.cp.name}</Td>
                  <Td align="right">
                    <Money paise={s.amountPaise} className="font-semibold text-basalt" />
                  </Td>
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
                        {s.reference && <Ref>{s.reference}</Ref>}
                      </>
                    ) : (
                      <span className="text-[0.75rem] whitespace-nowrap text-muted-foreground">Awaiting payment</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Ledger>
        )}
      </Panel>
    </>
  );
}
