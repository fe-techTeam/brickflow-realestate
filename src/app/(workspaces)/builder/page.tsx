import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BarChart3, CheckCircle2, ClipboardCheck, FileStack, HandCoins, Inbox, Landmark } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section, Timeline, type TimelineEntry } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import type { FinancingStatus } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/format";
import { formatINR, formatINRCompact } from "@/lib/money";
import { FINANCING_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { getBuilderOverview } from "@/server/queries/builder";
import { ageInDays, formatAgeing } from "./_lib/dates";
import { ProjectValueChart } from "./_components/project-value-chart";

export const metadata: Metadata = { title: "Builder overview" };

const EVENT_TONE: Partial<Record<FinancingStatus, TimelineEntry["tone"]>> = {
  APPROVED: "success",
  DISBURSED: "success",
  REJECTED: "danger",
  PENDING_APPROVAL: "warning",
  ACCEPTED_BY_CP: "gold",
};

function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function BuilderOverviewPage() {
  const actor = await requireWorkspace("builder");
  const { totals, inbox, events, byProject } = await getBuilderOverview(actor);
  const now = new Date();

  return (
    <>
      <PageHeader
        eyebrow={actor.orgName}
        title={`${greeting(now)}, ${actor.name.split(" ")[0]}`}
        description="Approve channel partner invoices, track early payments made by Veefin on your behalf and keep an eye on what you owe and when."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/builder/reports">
                <BarChart3 className="size-4" />
                Reports
              </Link>
            </Button>
            <Button asChild>
              <Link href="/builder/approvals">
                <ClipboardCheck className="size-4" />
                Review inbox{totals.pendingCount > 0 ? ` (${totals.pendingCount})` : ""}
              </Link>
            </Button>
          </>
        }
      />

      <StatGrid className="mb-8 lg:grid-cols-6 xl:grid-cols-6 2xl:grid-cols-5">
        <div className="lg:col-span-2 2xl:col-span-1 *:h-full">
          <StatCard
            label="Total invoices"
            value={totals.invoiceCount}
            hint={`${formatINRCompact(totals.invoiceValue)} received from channel partners`}
            icon={FileStack}
            href="/builder/approvals?view=all"
          />
        </div>
        <div className="lg:col-span-2 2xl:col-span-1 *:h-full">
          <StatCard
            label="Pending approvals"
            value={totals.pendingCount}
            hint={totals.pendingCount > 0 ? `${formatINRCompact(totals.pendingValue)} awaiting your decision` : "Nothing awaiting your decision"}
            icon={ClipboardCheck}
            tone="gold"
            href="/builder/approvals"
          />
        </div>
        <div className="lg:col-span-2 2xl:col-span-1 *:h-full">
          <StatCard
            label="Approved invoice value"
            value={formatINRCompact(totals.approvedValue)}
            hint={`Approved amount across ${totals.approvedCount} accepted ${totals.approvedCount === 1 ? "invoice" : "invoices"}`}
            icon={CheckCircle2}
            tone="heritage"
            href="/builder/approved"
          />
        </div>
        <div className="lg:col-span-3 2xl:col-span-1 *:h-full">
          <StatCard
            label="Financed invoice value"
            value={formatINRCompact(totals.financedValue)}
            hint={`${totals.financedCount} ${totals.financedCount === 1 ? "invoice" : "invoices"} with early payment requested or paid (excludes rejected)`}
            icon={HandCoins}
            tone="heritage"
            href="/builder/financed"
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-3 2xl:col-span-1 *:h-full">
          <StatCard
            label="Pending settlement value"
            value={formatINRCompact(totals.pendingSettlementValue)}
            hint="Owed to Veefin on original due dates: unsettled settlements plus approved requests not yet disbursed"
            icon={Landmark}
            tone="slate"
            href="/builder/settlements"
          />
        </div>
      </StatGrid>

      <div className="grid items-start gap-6 xl:grid-cols-5">
        <Section
          className="xl:col-span-3"
          title="Approval inbox"
          description="Oldest first — invoices waiting for your decision"
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/builder/approvals">
                View all
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          }
          bodyClassName="p-0 sm:p-0"
        >
          {inbox.length === 0 ? (
            <EmptyState icon={Inbox} title="Inbox clear" description="Every submitted invoice has been decided. New submissions from channel partners will appear here." />
          ) : (
            <ul className="divide-y divide-border/70">
              {inbox.map((invoice) => {
                const age = ageInDays(invoice.submittedAt, now);
                return (
                  <li key={invoice.id}>
                    <Link
                      href={`/builder/invoices/${invoice.id}`}
                      className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-ivory/50 focus-visible:bg-ivory/60 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4 sm:px-6"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-navy">
                          {invoice.invoiceNumber}
                          <StatusBadge kind="invoice" status={invoice.status} />
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {invoice.cp.name} · {invoice.project.name}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-4 sm:block sm:text-right">
                        <p className="tabular text-sm font-semibold text-navy">{formatINR(invoice.amountPaise)}</p>
                        <p className={cn("mt-0.5 text-xs", age >= 3 ? "font-medium text-[#8a5a12]" : "text-muted-foreground")}>
                          Submitted {formatAgeing(invoice.submittedAt, now)}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          className="xl:col-span-2"
          title="Recent financing activity"
          description="Early payments on your approved invoices"
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/builder/financed">
                Financed
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          }
        >
          {events.length === 0 ? (
            <EmptyState icon={HandCoins} title="No financing activity yet" description="When a channel partner takes early payment on an approved invoice, each step appears here." className="py-8" />
          ) : (
            <Timeline
              entries={events.map((event) => ({
                id: event.id,
                tone: EVENT_TONE[event.toStatus] ?? "default",
                title: (
                  <>
                    {FINANCING_STATUS[event.toStatus].label} ·{" "}
                    <Link href={`/builder/invoices/${event.request.invoice.id}`} className="underline-offset-4 hover:underline">
                      {event.request.invoice.invoiceNumber}
                    </Link>
                  </>
                ),
                meta: (
                  <>
                    {event.request.cp.name} · {formatINRCompact(event.request.approvedAmountPaise)} · {event.actorName} · {formatDateTime(event.createdAt)}
                  </>
                ),
              }))}
            />
          )}
        </Section>
      </div>

      <Section
        className="mt-6"
        title="Invoice value by project"
        description="Approved amount of accepted invoices versus invoices still open (submitted, under review or awaiting clarification)"
      >
        {byProject.length === 0 ? (
          <EmptyState icon={BarChart3} title="No invoices yet" description="Project values appear once channel partners submit invoices." className="py-8" />
        ) : (
          <ProjectValueChart
            data={byProject.map((p) => ({ name: p.name, code: p.code, approved: Number(p.approved / 100n), awaiting: Number(p.awaiting / 100n) }))}
          />
        )}
      </Section>
    </>
  );
}
