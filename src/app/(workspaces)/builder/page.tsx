import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Banknote,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  HandCoins,
  Hourglass,
  Inbox,
  Send,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import type { FinancingStatus } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatINRCompact } from "@/lib/money";
import { FINANCING_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { getBuilderOverview } from "@/server/queries/builder";
import { AgeingMeter } from "./_components/ageing";
import { Chronicle, type ChronicleTone } from "./_components/chronicle";
import { Empty, Metric, MetricStrip, Monogram, Panel } from "./_components/kit";
import { Money } from "./_components/money";
import { ProjectValueBars, ProjectValueLegend } from "./_components/project-value-bars";
import { Skyline } from "./_components/skyline";
import { ageInDays, calendarDaysUntil } from "./_lib/dates";

export const metadata: Metadata = { title: "Builder overview" };

const EVENT: Partial<Record<FinancingStatus, { icon: LucideIcon; tone: ChronicleTone }>> = {
  ACCEPTED_BY_CP: { icon: Send, tone: "gold" },
  PENDING_APPROVAL: { icon: Hourglass, tone: "amber" },
  APPROVED: { icon: ShieldCheck, tone: "heritage" },
  DISBURSEMENT_INITIATED: { icon: Banknote, tone: "navy" },
  DISBURSED: { icon: BadgeCheck, tone: "heritage" },
  REJECTED: { icon: XCircle, tone: "rose" },
};

const longDate = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function BuilderOverviewPage() {
  const actor = await requireWorkspace("builder");
  const { totals, inbox, events, byProject, nextSettlement } = await getBuilderOverview(actor);
  const now = new Date();
  const oldest = inbox[0] ? ageInDays(inbox[0].submittedAt, now) : null;
  const dueIn = nextSettlement ? calendarDaysUntil(nextSettlement.dueDate, now) : null;

  return (
    <>
      <section className="relative mb-6 animate-fade-up overflow-hidden rounded-[14px] bg-navy text-white shadow-[0_30px_60px_-36px_rgba(13,30,48,0.7)] sm:mb-8">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,rgba(196,164,106,0.16),transparent_55%)]" />
        <Skyline className="absolute right-0 bottom-0 h-[78%] w-auto text-gold/[0.16] max-lg:hidden" />

        <div className="relative grid gap-8 px-6 py-8 sm:px-10 sm:py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-12 lg:py-12">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] font-semibold tracking-[0.18em] text-gold uppercase">
              <span aria-hidden="true" className="h-px w-6 bg-gold/70" />
              {longDate.format(now)}
            </p>
            <h1 className="mt-4 text-[2.5rem] leading-[1.02] font-semibold tracking-[-0.01em] text-white sm:text-[3.25rem]">
              {greeting(now)}, {actor.name.split(" ")[0]}
            </h1>
            <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-white/70">
              {totals.pendingCount > 0 ? (
                <>
                  <span className="font-medium text-white">{plural(totals.pendingCount, "invoice")} awaiting your review</span>
                  <span className="mx-2 text-gold/70">·</span>
                  <Money paise={totals.pendingValue} compact className="font-medium text-gold" /> pending
                  {oldest !== null && oldest >= 1 && (
                    <>
                      <span className="mx-2 text-gold/70">·</span>oldest waiting {plural(oldest, "day")}
                    </>
                  )}
                </>
              ) : (
                <>Your approval inbox is clear. Every invoice from your channel partners has been decided.</>
              )}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button variant="gold" size="lg" asChild className="shadow-[0_10px_24px_-12px_rgba(196,164,106,0.8)]">
                <Link href="/builder/approvals">
                  <ClipboardCheck className="size-4" />
                  Review approvals
                  {totals.pendingCount > 0 && <span className="tabular ml-1 rounded-full bg-navy/15 px-2 py-0.5 text-[0.75rem]">{totals.pendingCount}</span>}
                </Link>
              </Button>
              <Button variant="ghost" size="lg" asChild className="text-white/80 hover:bg-white/10 hover:text-white">
                <Link href="/builder/reports">
                  <BarChart3 className="size-4" />
                  Reports
                </Link>
              </Button>
            </div>
          </div>

          <dl className="grid content-end gap-px self-end overflow-hidden rounded-xl border border-white/10 bg-white/10 backdrop-blur-sm">
            <div className="bg-navy-900/55 px-5 py-5">
              <dt className="text-[0.625rem] font-semibold tracking-[0.18em] text-white/55 uppercase">Awaiting your decision</dt>
              <dd className="mt-2.5">
                <Money paise={totals.pendingValue} compact size="xl" className="font-light text-white" />
                <p className="mt-1.5 text-[0.75rem] text-white/55">
                  {totals.pendingCount > 0 ? `${plural(totals.pendingCount, "invoice")} in the inbox` : "Nothing pending"}
                </p>
              </dd>
            </div>
            <div className="bg-navy-900/55 px-5 py-5">
              <dt className="text-[0.625rem] font-semibold tracking-[0.18em] text-white/55 uppercase">Next settlement to Veefin</dt>
              <dd className="mt-2.5">
                {nextSettlement ? (
                  <>
                    <Money paise={nextSettlement.amountPaise} compact size="xl" className="font-light text-white" />
                    <p className="mt-1.5 text-[0.75rem] text-white/55">
                      Due {formatDate(nextSettlement.dueDate)}
                      {dueIn !== null && (
                        <span className={dueIn < 0 ? "text-[#f0a597]" : dueIn <= 7 ? "text-gold" : undefined}>
                          {" · "}
                          {dueIn === 0 ? "today" : dueIn > 0 ? `in ${plural(dueIn, "day")}` : `${plural(-dueIn, "day")} overdue`}
                        </span>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="text-[0.875rem] text-white/70">No open settlements</p>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <MetricStrip className="mb-6 grid-cols-1 sm:mb-8 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Invoices received"
          value={<Money paise={totals.invoiceValue} compact size="xl" className="font-normal" />}
          caption={`${plural(totals.invoiceCount, "invoice")} from channel partners`}
          href="/builder/approvals?view=all"
        />
        <Metric
          label="Approved value"
          accent="heritage"
          value={<Money paise={totals.approvedValue} compact size="xl" className="font-normal" />}
          caption={`Across ${plural(totals.approvedCount, "accepted invoice")}`}
          href="/builder/approved"
        />
        <Metric
          label="Financed by Veefin"
          accent="gold"
          value={<Money paise={totals.financedValue} compact size="xl" className="font-normal" />}
          caption={`${plural(totals.financedCount, "invoice")} paid early, excluding rejected`}
          href="/builder/financed"
        />
        <Metric
          label="Owed to Veefin"
          accent="slate"
          value={<Money paise={totals.pendingSettlementValue} compact size="xl" className="font-normal" />}
          caption="Due on original invoice dates, including approved requests not yet disbursed"
          href="/builder/settlements"
        />
      </MetricStrip>

      <div className="grid items-start gap-6 sm:gap-8 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel
          eyebrow="Approval queue"
          title="Awaiting your decision"
          description="Oldest submissions first, with days waiting"
          flush
          actions={
            <Button variant="ghost" size="sm" asChild className="text-navy">
              <Link href="/builder/approvals">
                Open inbox
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          }
        >
          {inbox.length === 0 ? (
            <Empty icon={Inbox} title="Inbox clear" description="Every submitted invoice has been decided. New submissions from channel partners will appear here." />
          ) : (
            <ul className="divide-y divide-[#f0ebe0]">
              {inbox.map((invoice) => {
                const age = ageInDays(invoice.submittedAt, now);
                return (
                  <li key={invoice.id}>
                    <Link
                      href={`/builder/invoices/${invoice.id}`}
                      className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[#fbf9f4] focus-visible:bg-[#fbf9f4] focus-visible:outline-none sm:gap-5 sm:px-7 sm:py-5"
                    >
                      <Monogram name={invoice.cp.name} className="self-start sm:self-center" />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-navy">{invoice.invoiceNumber}</span>
                          <StatusBadge kind="invoice" status={invoice.status} />
                        </p>
                        <p className="mt-1 truncate text-[0.75rem] text-muted-foreground">
                          {invoice.cp.name} · {invoice.project.name}
                        </p>
                        <AgeingMeter days={age} className="mt-2.5 sm:hidden" />
                      </div>
                      <AgeingMeter days={age} className="hidden w-28 shrink-0 sm:inline-flex" />
                      <Money paise={invoice.amountPaise} size="md" className="shrink-0 self-start font-medium text-navy sm:self-center" />
                      <ChevronRight className="hidden size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-navy sm:block" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          eyebrow="Early payment"
          title="Recent financing activity"
          description="Veefin's steps on your approved invoices"
          actions={
            <Button variant="ghost" size="sm" asChild className="text-navy">
              <Link href="/builder/financed">
                Financed
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          }
        >
          {events.length === 0 ? (
            <Empty
              icon={HandCoins}
              title="No financing activity yet"
              description="When a channel partner takes early payment on an approved invoice, each step appears here."
              className="py-8"
            />
          ) : (
            <Chronicle
              entries={events.map((event) => {
                const style = EVENT[event.toStatus] ?? { icon: CircleDot, tone: "muted" as const };
                return {
                  id: event.id,
                  icon: style.icon,
                  tone: style.tone,
                  title: (
                    <>
                      {FINANCING_STATUS[event.toStatus].label}
                      <span className="mx-1.5 text-muted-foreground/60">·</span>
                      <Link href={`/builder/invoices/${event.request.invoice.id}`} className="decoration-gold/60 underline-offset-4 hover:underline">
                        {event.request.invoice.invoiceNumber}
                      </Link>
                    </>
                  ),
                  meta: `${event.request.cp.name} · ${formatINRCompact(event.request.approvedAmountPaise)} · ${event.actorName}`,
                  when: formatDateTime(event.createdAt),
                };
              })}
            />
          )}
        </Panel>
      </div>

      <Panel
        className="mt-6 sm:mt-8"
        eyebrow="Portfolio"
        title="Invoice value by project"
        description="Approved amount of accepted invoices against value still open with you (submitted, under review or awaiting clarification)"
        actions={<ProjectValueLegend />}
      >
        {byProject.length === 0 ? (
          <Empty icon={BarChart3} title="No invoices yet" description="Project values appear once channel partners submit invoices." className="py-8" />
        ) : (
          <ProjectValueBars rows={byProject} />
        )}
      </Panel>
    </>
  );
}
