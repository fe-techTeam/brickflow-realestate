import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, BadgePercent, ScrollText, SlidersHorizontal } from "lucide-react";
import type { FinancingStatus, InvoiceStatus } from "@/generated/prisma/enums";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { sumPaise } from "@/lib/money";
import { FINANCING_STATUS, INVOICE_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { getAdminDashboard, getOrganisationDirectory, getProgrammeConfigContext } from "@/server/queries/admin";
import { listAuditLogs, listProgrammes } from "@/server/services/admin";
import { ActivityTimeline } from "./_components/activity";
import { AdminHeader, Empty, Monogram, Panel } from "./_components/editorial";
import { Count, GoldRule, Money, Rate } from "./_components/figures";
import { plural } from "./_components/labels";
import { VolumeChart } from "./_components/volume-chart";

export const metadata: Metadata = { title: "Admin dashboard" };

const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

function Pipeline({
  title,
  kind,
  order,
  rows,
  href,
}: {
  title: string;
  kind: "invoice" | "financing";
  order: string[];
  rows: { status: string; count: number }[];
  href: (status: string) => string;
}) {
  const byStatus = new Map(rows.map((r) => [r.status, r.count]));
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      <p className="mb-2 text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">{title}</p>
      <ul>
        {order.map((status) => {
          const count = byStatus.get(status) ?? 0;
          return (
            <li key={status}>
              <Link href={href(status)} className="group grid grid-cols-[1fr_4.5rem_1.75rem] items-center gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <StatusBadge kind={kind} status={status as never} />
                </span>
                <span aria-hidden="true" className="h-[3px] overflow-hidden rounded-full bg-ivory-200">
                  <span
                    className={cn("block h-full rounded-full transition-colors", count ? "bg-navy/70 group-hover:bg-gold" : "bg-transparent")}
                    style={{ width: `${(count / max) * 100}%` }}
                  />
                </span>
                <span className={cn("tabular text-right font-medium", count ? "text-navy" : "text-muted-foreground/60")}>{count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default async function AdminDashboardPage() {
  const actor = await requireWorkspace("admin");
  const [dashboard, programmes, audit, directory, context] = await Promise.all([
    getAdminDashboard(actor),
    listProgrammes(actor),
    listAuditLogs(actor, { take: 40 }),
    getOrganisationDirectory(actor),
    getProgrammeConfigContext(actor),
  ]);

  const { organisations, users, invoices, requests } = dashboard;
  const activity = audit.filter((e) => !e.action.startsWith("session.")).slice(0, 7);
  const awaitingReview = invoices.byStatus.filter((r) => r.status === "SUBMITTED" || r.status === "UNDER_REVIEW").reduce((n, r) => n + r.count, 0);
  const pendingApproval = requests.byStatus.find((r) => r.status === "PENDING_APPROVAL")?.count ?? 0;
  const activeByBuilder = new Map(programmes.filter((p) => p.status === "ACTIVE").map((p) => [p.builder.id, p]));
  const board = context.builders.map((b) => ({ builder: b, programme: activeByBuilder.get(b.id) }));
  const invoiced12 = sumPaise(dashboard.weekly.map((w) => BigInt(w.invoicedPaise)));
  const financed12 = sumPaise(dashboard.weekly.map((w) => BigInt(w.financedPaise)));

  const contextLine = [
    `${plural(activeByBuilder.size, "programme")} live across ${plural(context.builders.length, "builder")}`,
    pendingApproval ? `${plural(pendingApproval, "request")} awaiting Veefin approval` : "no requests awaiting Veefin",
    `${plural(awaitingReview, "invoice")} with builders for review`,
  ];

  const metrics = [
    {
      label: "Organisations",
      value: organisations.total,
      hint: `${organisations.byType.BUILDER ?? 0} builders · ${organisations.byType.CHANNEL_PARTNER ?? 0} partners · ${organisations.byType.FINANCIER ?? 0} financier`,
      href: "/admin/organisations",
    },
    { label: "Active users", value: users.active, hint: `of ${plural(users.total, "account")}`, href: "/admin/users" },
    { label: "Invoices", value: invoices.total, hint: `${awaitingReview} awaiting builder review`, href: "/admin/transactions?view=invoices" },
    { label: "Financing requests", value: requests.total, hint: `${pendingApproval} pending Veefin approval`, href: "/admin/transactions" },
  ];

  return (
    <>
      <AdminHeader
        eyebrow={`Super admin · ${today.format(new Date())}`}
        title="Platform overview"
        lede={
          <>
            Good to see you, {actor.name.split(" ")[0]}. {contextLine.join(" · ")}.
          </>
        }
        actions={
          <>
            <Button variant="outline" size="lg" asChild className="bg-card">
              <Link href="/admin/audit">
                <ScrollText className="size-4" strokeWidth={1.75} />
                Audit log
              </Link>
            </Button>
            <Button size="lg" asChild className="shadow-[0_10px_24px_-12px_rgba(20,43,67,0.6)]">
              <Link href="/admin/financing">
                <SlidersHorizontal className="size-4 text-gold" strokeWidth={1.75} />
                Configure financing
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-12">
        <section
          aria-label="Financing totals"
          className="relative flex animate-fade-up flex-col overflow-hidden rounded-xl bg-navy px-6 py-7 text-white shadow-[0_30px_60px_-34px_rgba(13,30,48,0.85)] sm:px-8 sm:py-8 lg:col-span-7"
        >
          <span aria-hidden="true" className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full bg-gold/10 blur-3xl" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
          <p className="text-[0.625rem] font-semibold tracking-[0.24em] text-gold uppercase">Financed through BrickFlow</p>
          <div className="mt-5 flex flex-wrap items-end gap-x-5 gap-y-2">
            <Money paise={requests.financedPaise} compact size="hero" className="text-white" />
            <p className="pb-1.5 text-sm text-white/60">{plural(requests.financedCount, "request")} approved by Veefin</p>
          </div>
          <GoldRule className="mt-6 mb-8 w-16" />
          <dl className="mt-auto grid grid-cols-2 gap-6 border-t border-white/10 pt-6 sm:grid-cols-3">
            <div>
              <dt className="text-[0.6875rem] text-white/55">Paid out early (simulated)</dt>
              <dd className="mt-1.5">
                <Money paise={dashboard.disbursed.amountPaise} compact size="md" className="text-white" />
              </dd>
              <dd className="mt-0.5 text-[0.6875rem] text-white/45">{plural(dashboard.disbursed.count, "payout")}</dd>
            </div>
            <div>
              <dt className="text-[0.6875rem] text-white/55">Due from builders</dt>
              <dd className="mt-1.5">
                <Money paise={dashboard.outstanding.amountPaise} compact size="md" className="text-white" />
              </dd>
              <dd className="mt-0.5 text-[0.6875rem] text-white/45">{plural(dashboard.outstanding.count, "open settlement")}</dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-[0.6875rem] text-white/55">Live programmes</dt>
              <dd className="mt-1.5">
                <Count value={`${activeByBuilder.size} of ${context.builders.length}`} size="md" className="text-white" />
              </dd>
              <dd className="mt-0.5 text-[0.6875rem] text-white/45">builders with an agreed rate</dd>
            </div>
          </dl>
        </section>

        <dl className="grid animate-fade-up grid-cols-2 overflow-hidden rounded-xl border border-border/90 bg-card shadow-[0_18px_40px_-30px_rgba(20,43,67,0.25)] lg:col-span-5">
          {metrics.map((m, i) => (
            <Link
              key={m.label}
              href={m.href}
              className={cn(
                "group flex flex-col gap-5 px-5 py-6 transition-colors hover:bg-ivory/60 sm:px-6",
                i % 2 === 1 && "border-l border-border/80",
                i >= 2 && "border-t border-border/80",
              )}
            >
              <dt className="flex items-center justify-between gap-2 text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                {m.label}
                <ArrowUpRight className="size-3.5 text-gold-600 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
              </dt>
              <div>
                <dd>
                  <Count value={m.value} size="xl" />
                </dd>
                <dd className="mt-2 text-xs leading-snug text-muted-foreground">{m.hint}</dd>
              </div>
            </Link>
          ))}
        </dl>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <Panel
          className="lg:col-span-5"
          eyebrow="Rate board"
          title="Agreed discount rates"
          description="One fixed rate per builder, agreed off-platform with Veefin."
          bodyClassName="pb-5"
        >
          {board.length === 0 ? (
            <Empty icon={BadgePercent} title="No builders yet" description="Builders appear here once they are onboarded." className="py-10" />
          ) : (
            <ul className="divide-y divide-border/70 border-t border-border/70">
              {board.map(({ builder, programme }) => (
                <li key={builder.id} className="flex items-center gap-4 py-4">
                  <Monogram name={builder.name} tone={programme ? "navy" : "muted"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/organisations/${builder.id}`} className="block text-sm leading-snug font-medium text-navy hover:underline">
                      {builder.name}
                    </Link>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {programme ? `${programme.financier.name} · since ${formatDate(programme.effectiveFrom)}` : "No active programme: early payment unavailable"}
                    </p>
                  </div>
                  {programme ? (
                    <Rate bps={programme.discountRateBps} size="lg" />
                  ) : (
                    <Link href="/admin/financing" className="text-xs font-medium whitespace-nowrap text-gold-600 hover:text-navy">
                      Configure
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/70 pt-4">
            <p className="text-xs text-muted-foreground">
              {programmes.length > activeByBuilder.size
                ? `${programmes.length - activeByBuilder.size} further programme${programmes.length - activeByBuilder.size === 1 ? "" : "s"} in draft, suspended or closed.`
                : "Every configured programme is live."}
            </p>
            <Link href="/admin/financing" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-navy hover:text-gold-600">
              Manage rates
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </Panel>

        <Panel
          className="lg:col-span-7"
          eyebrow="Twelve-week flow"
          title="Invoices and early payment"
          actions={
            <dl className="flex gap-6 text-right">
              <div>
                <dt className="text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Submitted</dt>
                <dd className="mt-1">
                  <Money paise={invoiced12} compact size="md" className="text-navy" />
                </dd>
              </div>
              <div>
                <dt className="text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Accepted early</dt>
                <dd className="mt-1">
                  <Money paise={financed12} compact size="md" className="text-gold-600" />
                </dd>
              </div>
            </dl>
          }
        >
          <VolumeChart data={dashboard.weekly} />
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <Panel
          className="lg:col-span-7"
          eyebrow="Audit trail"
          title="Recent activity"
          actions={
            <Link href="/admin/audit" className="inline-flex items-center gap-1 text-xs font-semibold text-navy hover:text-gold-600">
              Full audit log
              <ArrowRight className="size-3.5" />
            </Link>
          }
          bodyClassName="pt-2"
        >
          {activity.length === 0 ? (
            <Empty icon={ScrollText} title="No activity yet" description="Actions taken in any workspace will appear here." className="py-10" />
          ) : (
            <ActivityTimeline entries={activity} directory={directory} />
          )}
        </Panel>

        <Panel className="lg:col-span-5" eyebrow="Pipeline" title="Where things stand" description="Select a stage to open the matching transactions.">
          <div className="grid gap-7 border-t border-border/70 pt-5">
            <Pipeline
              title="Invoices"
              kind="invoice"
              order={(Object.keys(INVOICE_STATUS) as InvoiceStatus[]).filter((s) => s !== "DRAFT")}
              rows={invoices.byStatus}
              href={(s) => `/admin/transactions?view=invoices&status=${s}`}
            />
            <Pipeline
              title="Financing requests"
              kind="financing"
              order={(Object.keys(FINANCING_STATUS) as FinancingStatus[]).filter((s) => !["NOT_REQUESTED", "REQUESTED", "OFFER_GENERATED"].includes(s))}
              rows={requests.byStatus}
              href={(s) => `/admin/transactions?status=${s}`}
            />
          </div>
        </Panel>
      </div>
    </>
  );
}
