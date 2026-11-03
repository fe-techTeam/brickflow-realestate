import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine, ArrowRight, CalendarClock, CircleCheck, FileBarChart2, ListChecks } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatBps, formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { getFinanceOverview, type WatchlistItem } from "@/server/queries/finance";
import type { FinancingRequestListItem } from "@/server/services/financing";
import { MonthlyVolumeChart } from "./_components/charts";
import { EmptyNote, LaneHeading, Masthead, Money, Monogram, Panel, SimulatedTag } from "./_components/ledger";
import { RequestActionLink } from "./_components/request-table";

export const metadata: Metadata = { title: "Overview · Veefin Finance" };

const DAY_MS = 24 * 60 * 60 * 1000;
const dueDay = new Intl.DateTimeFormat("en-IN", { day: "2-digit", timeZone: "Asia/Kolkata" });
const dueMonth = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "Asia/Kolkata" });

function waitingFor(since: Date | null | undefined, now: Date): string {
  if (!since) return "—";
  const days = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
  if (days <= 0) return "since today";
  return days === 1 ? "for 1 day" : `for ${days} days`;
}

function QueueLane({
  index,
  title,
  items,
  since,
  empty,
  href,
  now,
}: {
  index: string;
  title: string;
  items: FinancingRequestListItem[];
  since: (r: FinancingRequestListItem) => Date | null | undefined;
  empty: string;
  href: string;
  now: Date;
}) {
  const total = sumPaise(items.map((r) => r.netPayablePaise));
  return (
    <div className="min-w-0">
      <LaneHeading
        index={index}
        title={title}
        count={items.length}
        total={items.length > 0 ? <>{formatINRCompact(total)} net</> : undefined}
        action={
          items.length > 0 ? (
            <Link href={href} className="text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase transition-colors hover:text-fg">
              View all
            </Link>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2.5 rounded-lg border border-dashed border-border bg-glass/30 px-4 py-3.5 text-[0.8125rem] text-muted-foreground">
          <CircleCheck className="size-4 text-leaf/70" strokeWidth={1.75} aria-hidden="true" />
          {empty}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border/70 overflow-hidden rounded-lg border border-border/80">
          {items.slice(0, 4).map((r) => (
            <li key={r.id} className="flex flex-col gap-3 bg-card px-4 py-4 transition-colors hover:bg-glass/30 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-3.5">
                <Monogram name={r.cp.name} size="sm" tone="paper" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">
                    {r.cp.name} <span className="font-normal text-fg-muted">→</span> {r.builder.name}
                  </p>
                  <p className="tabular mt-0.5 truncate text-[0.6875rem] tracking-wide text-muted-foreground">
                    {r.reference} · {r.invoice.invoiceNumber} · {formatBps(r.discountRateBps)}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-5 pl-[2.875rem] sm:justify-end sm:pl-0">
                <div className="text-left sm:text-right">
                  <Money paise={r.netPayablePaise} className="font-semibold text-leaf" />
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
    return <EmptyNote icon={CalendarClock} title="Nothing outstanding" description="Every disbursed request has been settled by its builder." compact />;
  }
  return (
    <ul className="-mt-1 divide-y divide-border/70">
      {items.slice(0, 6).map((item) => {
        const overdue = item.daysToDue < 0;
        return (
          <li key={item.request.id} className="flex gap-4 py-4">
            <div
              className={cn(
                "flex w-12 shrink-0 flex-col items-center justify-center rounded-lg border py-1.5",
                overdue ? "border-danger/25 bg-danger-soft/60 text-danger" : "border-line-strong/35 bg-glass/70 text-fg",
              )}
            >
              <span className="tabular font-display text-xl leading-none font-normal">{dueDay.format(item.dueDate)}</span>
              <span className="mt-0.5 text-[0.5625rem] font-semibold tracking-[0.18em] uppercase opacity-70">{dueMonth.format(item.dueDate)}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/finance/requests/${item.request.id}`} className="truncate text-sm font-medium text-fg underline-offset-4 hover:underline">
                  {item.request.builder.name}
                </Link>
                <StatusBadge kind="settlement" status={item.status} />
              </div>
              <p className="tabular mt-0.5 text-[0.6875rem] tracking-wide text-muted-foreground">{item.request.reference}</p>
              <div className="mt-1.5 flex items-baseline justify-between gap-3">
                <Money paise={item.amountPaise} className="text-fg" />
                <p className={overdue ? "text-xs font-medium text-danger" : "text-xs text-muted-foreground"}>
                  {overdue
                    ? `${Math.abs(item.daysToDue)} day${item.daysToDue === -1 ? "" : "s"} overdue`
                    : item.daysToDue === 0
                      ? "Due today"
                      : `In ${item.daysToDue} day${item.daysToDue === 1 ? "" : "s"}`}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function HeroFigure({ label, paise, hint, accent }: { label: string; paise: bigint; hint: string; accent: string }) {
  return (
    <div className="flex min-w-0 items-end justify-between gap-4 py-4 sm:block sm:px-6 sm:py-0 sm:first:pl-0">
      <div>
        <p className="flex items-center gap-2 text-[0.625rem] font-semibold tracking-[0.2em] whitespace-nowrap text-white/55 uppercase">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", accent)} />
          {label}
        </p>
        <p className="mt-1.5 text-xs text-white/50 sm:hidden">{hint}</p>
      </div>
      <Money paise={paise} compact size="lg" className="block text-white sm:mt-3" symbolClassName="text-fg-muted" />
      <p className="mt-2 hidden text-xs text-white/50 sm:block">{hint}</p>
    </div>
  );
}

export default async function FinanceOverviewPage() {
  const actor = await requireWorkspace("finance");
  const now = new Date();
  const o = await getFinanceOverview(actor, now);
  const committed = sumPaise([...o.queue.approved, ...o.queue.inProgress].map((r) => r.approvedAmountPaise));
  const exposure = o.outstandingValue + committed;
  const outstandingShare = exposure > 0n ? Number((o.outstandingValue * 1000n) / exposure) / 10 : 0;
  const monthlyTotal = o.monthly.reduce((sum, m) => sum + BigInt(m.paise), 0n);

  const context = [
    <span key="p">
      <strong className="font-semibold text-fg">{o.pendingCount}</strong> request{o.pendingCount === 1 ? "" : "s"} awaiting approval
    </span>,
    <span key="e">
      <strong className="tabular font-semibold text-fg">{formatINRCompact(exposure)}</strong> exposure
    </span>,
  ];

  return (
    <>
      <Masthead
        eyebrow="Veefin Finance · Credit operations"
        title="Credit portfolio"
        context={context}
        actions={
          <Button asChild variant="outline" className="bg-card">
            <Link href="/finance/reports">
              <FileBarChart2 className="size-4" />
              Reports
            </Link>
          </Button>
        }
      />

      <section
        aria-label="Portfolio position"
        className="surface-basalt relative animate-fade-up overflow-hidden shadow-[0_30px_60px_-30px_rgba(10, 16, 26,0.65)]"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-haze/70 to-transparent" />
          <div className="absolute -top-40 -right-24 size-[34rem] rounded-full bg-[radial-gradient(circle,rgba(255, 255, 255,0.16),transparent_62%)]" />
          <svg className="absolute -right-20 -bottom-24 size-[28rem] text-fg-muted/[0.09]" viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth="0.5">
            {Array.from({ length: 14 }, (_, i) => (
              <circle key={i} cx="100" cy="100" r={20 + i * 6} />
            ))}
          </svg>
        </div>

        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.6fr)] lg:gap-10 lg:p-10">
          <div className="min-w-0">
            <p className="text-[0.625rem] font-semibold tracking-[0.22em] text-fg-muted uppercase">Total exposure</p>
            <Money paise={exposure} size="hero" className="mt-4 block text-white" symbolClassName="text-fg-muted" />
            <p className="mt-3 max-w-sm text-[0.8125rem] leading-relaxed text-white/60">
              Builder settlements outstanding plus approved requests not yet paid out, at builder-approved value.
            </p>
            <div className="mt-6 max-w-md">
              <div className="flex h-1.5 overflow-hidden rounded-full bg-card/10" aria-hidden="true">
                <span className="bg-glass-300" style={{ width: `${outstandingShare}%` }} />
                <span className="bg-haze" style={{ width: `${exposure > 0n ? 100 - outstandingShare : 0}%` }} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <dt className="flex items-center gap-1.5 text-white/50">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-glass-300" />
                    Outstanding settlements
                  </dt>
                  <dd className="mt-1">
                    <Money paise={o.outstandingValue} compact className="text-white/90" />
                    <span className="ml-1.5 text-white/40">· {o.outstandingCount} open</span>
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-white/50">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-haze" />
                    Committed, not paid
                  </dt>
                  <dd className="mt-1">
                    <Money paise={committed} compact className="text-white/90" />
                    <span className="ml-1.5 text-white/40">· {o.queue.approved.length + o.queue.inProgress.length} in queue</span>
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="flex min-w-0 flex-col justify-between gap-8 lg:border-l lg:border-white/10 lg:pl-10">
            <div className="grid divide-y divide-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <HeroFigure label="Financed" paise={o.financedValue} hint={`${o.financedCount} approved or disbursed`} accent="bg-[#5fd3ab]" />
              <HeroFigure label="Disbursed" paise={o.disbursedValue} hint={`${o.disbursedCount} simulated payout${o.disbursedCount === 1 ? "" : "s"}`} accent="bg-[#5fd3ab]" />
              <HeroFigure
                label="Pending"
                paise={o.pendingNetValue}
                hint={o.pendingCount ? `${o.pendingCount} awaiting a decision` : "Queue is clear"}
                accent="bg-haze"
              />
            </div>
            <div className="flex flex-col gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-[0.8125rem] text-white/60">
                {o.pendingCount > 0 ? (
                  <>
                    <span className="font-medium text-white">{o.pendingCount}</span> credit decision{o.pendingCount === 1 ? "" : "s"} on your desk
                  </>
                ) : (
                  "The approval queue is clear"
                )}
              </p>
              <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center">
                <Button asChild variant="ghost" className="text-white/75 hover:bg-card/10 hover:text-white">
                  <Link href="/finance/disbursements">
                    <ArrowDownToLine className="size-4" />
                    Disbursements
                  </Link>
                </Button>
                <Button asChild variant="accent" size="lg" className="px-5 font-semibold">
                  <Link href="/finance/requests?status=PENDING_APPROVAL">
                    <ListChecks className="size-4" />
                    Review requests
                    {o.pendingCount > 0 && (
                      <span className="tabular ml-0.5 rounded-full bg-night px-1.5 py-px text-[0.6875rem] font-semibold text-fg-muted">{o.pendingCount}</span>
                    )}
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel eyebrow="Awaiting your desk" title="Work queue" description="Requests that need an action from credit operations, oldest first.">
          <div className="space-y-7 pt-1">
            <QueueLane
              index="01"
              title="Pending approval"
              items={[...o.queue.pending].reverse()}
              since={(r) => r.createdAt}
              empty="No requests are waiting for a credit decision."
              href="/finance/requests?status=PENDING_APPROVAL"
              now={now}
            />
            <QueueLane
              index="02"
              title="Ready to disburse"
              items={[...o.queue.approved].reverse()}
              since={(r) => r.decidedAt}
              empty="No approved requests are waiting for a payout."
              href="/finance/disbursements"
              now={now}
            />
            <QueueLane
              index="03"
              title="Payouts in progress"
              items={[...o.queue.inProgress].reverse()}
              since={(r) => r.disbursement?.initiatedAt}
              empty="No simulated payouts are awaiting confirmation."
              href="/finance/disbursements"
              now={now}
            />
          </div>
        </Panel>

        <Panel
          className="self-start"
          eyebrow="Builder repayments"
          title="Settlement watchlist"
          description={o.overdueCount ? `${o.overdueCount} overdue · nearest due date first` : "Open settlements, nearest due date first"}
        >
          <Watchlist items={o.watchlist} />
          {o.watchlist.length > 0 && (
            <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line-strong/10 pt-4">
              <span className="text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Total outstanding</span>
              <Money paise={o.outstandingValue} size="md" className="text-fg" />
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          eyebrow="Last six months"
          title="Disbursed volume"
          description={
            <>
              Net paid to channel partners · <span className="tabular font-medium text-fg">{formatINR(monthlyTotal)}</span> in total
            </>
          }
          actions={<SimulatedTag />}
        >
          <MonthlyVolumeChart data={o.monthly} height={240} />
        </Panel>

        <Panel eyebrow="Book of business" title="Portfolio register">
          <ul className="-mt-1 divide-y divide-border/70">
            {[
              { label: "Builders on programme", value: o.builderCount, hint: "With a Veefin facility", href: "/finance/builders" },
              { label: "Channel partners", value: o.cpCount, hint: "Empanelled with those builders", href: "/finance/partners" },
              {
                label: "Invoices approved",
                value: o.approvedInvoiceCount,
                hint: `${formatINRCompact(o.approvedInvoiceValue)} builder-approved`,
                href: "/finance/transactions",
              },
              { label: "Financing requests", value: o.requestCount, hint: "Across all statuses", href: "/finance/transactions" },
            ].map((row) => (
              <li key={row.label}>
                <Link href={row.href} className="group flex items-center gap-4 py-4">
                  <span className="tabular w-10 font-sans text-[1.625rem] leading-none font-light text-fg">{row.value}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-fg">{row.label}</span>
                    <span className="block text-xs text-muted-foreground">{row.hint}</span>
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-fg-muted" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <p className="mt-8 flex items-start gap-3 text-xs leading-relaxed text-muted-foreground">
        <span aria-hidden="true" className="mt-2 h-px w-6 shrink-0 bg-haze" />
        Discount rates are agreed with each builder and configured by the BrickFlow Super Admin; every request keeps the rate accepted by the channel partner.
      </p>
    </>
  );
}
