import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarClock,
  ClipboardList,
  FileCheck2,
  Handshake,
  Hourglass,
  Landmark,
  ListChecks,
  Wallet,
} from "lucide-react";
import { EmptyState, Section } from "@/components/common/panels";
import { PageHeader } from "@/components/common/page-header";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { DemoBadge, StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { formatBps, formatINR, formatINRCompact } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { getFinanceOverview, type WatchlistItem } from "@/server/queries/finance";
import type { FinancingRequestListItem } from "@/server/services/financing";
import { MonthlyVolumeChart } from "./_components/charts";
import { RequestActionLink } from "./_components/request-table";

export const metadata: Metadata = { title: "Overview · Veefin Finance" };

const DAY_MS = 24 * 60 * 60 * 1000;

function waitingFor(since: Date | null | undefined, now: Date): string {
  if (!since) return "—";
  const days = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
  if (days <= 0) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}

function QueueGroup({
  title,
  icon: Icon,
  items,
  since,
  empty,
  href,
  now,
}: {
  title: string;
  icon: typeof Hourglass;
  items: FinancingRequestListItem[];
  since: (r: FinancingRequestListItem) => Date | null | undefined;
  empty: string;
  href: string;
  now: Date;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-sans text-sm font-semibold tracking-normal text-navy">
          <Icon className="size-4 text-gold-600" strokeWidth={1.75} />
          {title}
          <span className="tabular rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-semibold text-slate-ink">{items.length}</span>
        </h3>
        {items.length > 0 && (
          <Link href={href} className="text-xs font-medium text-muted-foreground hover:text-navy">
            View all
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-md border border-border">
          {items.slice(0, 4).map((r) => (
            <li key={r.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-navy">
                  {r.cp.name} <span className="text-muted-foreground">→</span> {r.builder.name}
                </p>
                <p className="tabular mt-0.5 text-xs text-muted-foreground">
                  {r.reference} · {r.invoice.invoiceNumber} · {formatBps(r.discountRateBps)}
                </p>
              </div>
              <div className="flex items-center justify-between gap-4 sm:justify-end">
                <div className="text-left sm:text-right">
                  <p className="tabular text-sm font-semibold text-heritage">{formatINR(r.netPayablePaise)}</p>
                  <p className="text-[0.6875rem] text-muted-foreground">Waiting {waitingFor(since(r), now)}</p>
                </div>
                <RequestActionLink id={r.id} status={r.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Watchlist({ items }: { items: WatchlistItem[] }) {
  if (items.length === 0) {
    return <EmptyState icon={CalendarClock} title="Nothing outstanding" description="Every disbursed request has been settled by its builder." className="py-10" />;
  }
  return (
    <ul className="-my-1 divide-y divide-border/70">
      {items.slice(0, 6).map((item) => (
        <li key={item.request.id} className="py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/finance/requests/${item.request.id}`} className="block truncate text-sm font-medium text-navy hover:underline">
                {item.request.builder.name}
              </Link>
              <p className="tabular text-xs text-muted-foreground">
                {item.request.reference} · due {formatDate(item.dueDate)}
              </p>
            </div>
            <StatusBadge kind="settlement" status={item.status} />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <p className="tabular text-sm font-semibold text-navy">{formatINR(item.amountPaise)}</p>
            <p className={item.daysToDue < 0 ? "text-xs font-medium text-[#93342a]" : "text-xs text-muted-foreground"}>
              {item.daysToDue < 0
                ? `${Math.abs(item.daysToDue)} day${item.daysToDue === -1 ? "" : "s"} overdue`
                : item.daysToDue === 0
                  ? "Due today"
                  : `In ${item.daysToDue} day${item.daysToDue === 1 ? "" : "s"}`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function FinanceOverviewPage() {
  const actor = await requireWorkspace("finance");
  const now = new Date();
  const o = await getFinanceOverview(actor, now);
  const monthlyTotal = o.monthly.reduce((sum, m) => sum + BigInt(m.paise), 0n);

  return (
    <>
      <PageHeader
        eyebrow="Veefin Finance · Credit operations"
        title="Portfolio overview"
        description="Early-payment financing across your builder programmes: decisions awaiting you, payouts in flight and builder settlements coming due."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/finance/reports">Reports</Link>
            </Button>
            <Button asChild>
              <Link href="/finance/requests?status=PENDING_APPROVAL">
                <ListChecks className="size-4" />
                Review pending ({o.pendingCount})
              </Link>
            </Button>
          </>
        }
      />

      <StatGrid className="xl:grid-cols-4 2xl:grid-cols-4">
        <StatCard label="Builders" value={o.builderCount} hint="With a Veefin programme" icon={Building2} href="/finance/builders" />
        <StatCard label="Channel partners" value={o.cpCount} hint="Empanelled with those builders" icon={Handshake} href="/finance/partners" />
        <StatCard
          label="Invoices approved"
          value={o.approvedInvoiceCount}
          hint={`${formatINRCompact(o.approvedInvoiceValue)} builder-approved`}
          icon={FileCheck2}
          tone="slate"
        />
        <StatCard label="Financing requests" value={o.requestCount} hint="All statuses" icon={ClipboardList} tone="slate" href="/finance/transactions" />
        <StatCard
          label="Pending approvals"
          value={o.pendingCount}
          hint={o.pendingCount ? `${formatINRCompact(o.pendingValue)} approved invoice value` : "Queue is clear"}
          icon={Hourglass}
          tone="gold"
          href="/finance/requests?status=PENDING_APPROVAL"
        />
        <StatCard
          label="Total financed"
          value={formatINRCompact(o.financedValue)}
          hint={`${o.financedCount} approved or disbursed`}
          icon={BadgeCheck}
          tone="heritage"
        />
        <StatCard
          label="Total disbursed"
          value={formatINRCompact(o.disbursedValue)}
          hint={`${o.disbursedCount} simulated payout${o.disbursedCount === 1 ? "" : "s"} · net to CPs`}
          icon={Wallet}
          tone="heritage"
          href="/finance/disbursements"
        />
        <StatCard
          label="Outstanding settlements"
          value={formatINRCompact(o.outstandingValue)}
          hint={o.overdueCount ? `${o.overdueCount} overdue` : `${o.outstandingCount} open · none overdue`}
          icon={o.overdueCount ? AlertTriangle : Landmark}
          tone={o.overdueCount ? "gold" : "navy"}
        />
      </StatGrid>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Section title="Work queue" description="Requests that need an action from the credit operations team, oldest first.">
          <div className="space-y-6">
            <QueueGroup
              title="Pending approval"
              icon={Hourglass}
              items={[...o.queue.pending].reverse()}
              since={(r) => r.createdAt}
              empty="No requests are waiting for a credit decision."
              href="/finance/requests?status=PENDING_APPROVAL"
              now={now}
            />
            <QueueGroup
              title="Approved — awaiting disbursement"
              icon={BadgeCheck}
              items={[...o.queue.approved].reverse()}
              since={(r) => r.decidedAt}
              empty="No approved requests are waiting for a payout."
              href="/finance/disbursements"
              now={now}
            />
            <QueueGroup
              title="Disbursements in progress"
              icon={ArrowDownToLine}
              items={[...o.queue.inProgress].reverse()}
              since={(r) => r.disbursement?.initiatedAt}
              empty="No simulated payouts are awaiting confirmation."
              href="/finance/disbursements"
              now={now}
            />
          </div>
        </Section>

        <Section title="Settlement watchlist" description="Open builder settlements, nearest due date first.">
          <Watchlist items={o.watchlist} />
        </Section>
      </div>

      <Section
        className="mt-6"
        title="Disbursed volume"
        description={`Net amount paid to channel partners per month · last 6 months · ${formatINR(monthlyTotal)} in total`}
        actions={<DemoBadge />}
      >
        <MonthlyVolumeChart data={o.monthly} />
      </Section>

      <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ArrowRight className="size-3" aria-hidden="true" />
        Discount rates are agreed with each builder and configured by the BrickFlow Super Admin; every request keeps the rate accepted by the CP.
      </p>
    </>
  );
}
