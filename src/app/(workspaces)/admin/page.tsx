import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgePercent, Banknote, FileStack, HandCoins, Landmark, ListChecks, Users } from "lucide-react";
import type { FinancingStatus, InvoiceStatus } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { formatBps, formatINRCompact } from "@/lib/money";
import { FINANCING_STATUS, INVOICE_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { getAdminDashboard, getOrganisationDirectory } from "@/server/queries/admin";
import { listAuditLogs, listProgrammes } from "@/server/services/admin";
import { plural } from "./_components/labels";
import { OrgTypeBadge } from "./_components/org-type-badge";
import { VolumeChart } from "./_components/volume-chart";

export const metadata: Metadata = { title: "Admin dashboard" };

function StatusBreakdown({
  kind,
  order,
  rows,
  href,
}: {
  kind: "invoice" | "financing";
  order: string[];
  rows: { status: string; count: number; amountPaise: bigint }[];
  href: (status: string) => string;
}) {
  const byStatus = new Map(rows.map((r) => [r.status, r]));
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="divide-y divide-border/70">
      {order.map((status) => {
        const row = byStatus.get(status);
        const count = row?.count ?? 0;
        return (
          <li key={status}>
            <Link href={href(status)} className="group flex items-center gap-4 py-2.5 text-sm transition-colors hover:text-navy">
              <span className="w-48 shrink-0">
                <StatusBadge kind={kind} status={status as never} />
              </span>
              <span className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-muted sm:block" aria-hidden="true">
                <span className="block h-full rounded-full bg-navy/70" style={{ width: `${(count / max) * 100}%` }} />
              </span>
              <span className="tabular ml-auto w-10 text-right font-medium text-navy sm:ml-0">{count}</span>
              <span className="tabular hidden w-24 text-right text-xs text-muted-foreground md:block">{row ? formatINRCompact(row.amountPaise) : "—"}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function AdminDashboardPage() {
  const actor = await requireWorkspace("admin");
  const [dashboard, programmes, audit, directory] = await Promise.all([
    getAdminDashboard(actor),
    listProgrammes(actor),
    listAuditLogs(actor, { take: 10 }),
    getOrganisationDirectory(actor),
  ]);

  const { organisations, users, invoices, requests } = dashboard;
  const awaitingReview = invoices.byStatus.filter((r) => r.status === "SUBMITTED" || r.status === "UNDER_REVIEW").reduce((n, r) => n + r.count, 0);
  const pendingApproval = requests.byStatus.find((r) => r.status === "PENDING_APPROVAL")?.count ?? 0;
  const activeProgrammes = programmes.filter((p) => p.status === "ACTIVE");

  return (
    <>
      <PageHeader
        eyebrow="Super admin"
        title="Platform overview"
        description="Organisations, users, invoice flow and early-payment financing across every BrickFlow workspace. Figures are live from the demo database."
        actions={
          <Button asChild>
            <Link href="/admin/financing">
              <BadgePercent className="size-4" />
              Financing configuration
            </Link>
          </Button>
        }
      />

      <StatGrid>
        <StatCard
          label="Organisations"
          value={organisations.total}
          icon={Landmark}
          href="/admin/organisations"
          hint={`${organisations.byType.BUILDER ?? 0} builders · ${organisations.byType.CHANNEL_PARTNER ?? 0} partners · ${organisations.byType.FINANCIER ?? 0} financier`}
        />
        <StatCard label="Active users" value={users.active} icon={Users} href="/admin/users" hint={`of ${users.total} user accounts`} />
        <StatCard
          label="Invoices"
          value={invoices.total}
          icon={FileStack}
          href="/admin/transactions?view=invoices"
          hint={`${awaitingReview} awaiting builder review`}
        />
        <StatCard label="Financing requests" value={requests.total} icon={ListChecks} href="/admin/transactions" hint={`${pendingApproval} pending Veefin approval`} />
        <StatCard
          label="Financed value"
          value={formatINRCompact(requests.financedPaise)}
          icon={HandCoins}
          tone="heritage"
          hint={`${plural(requests.financedCount, "request")} approved by Veefin`}
        />
        <StatCard
          label="Disbursed (simulated)"
          value={formatINRCompact(dashboard.disbursed.amountPaise)}
          icon={Banknote}
          tone="gold"
          hint={`${plural(dashboard.disbursed.count, "payout")} · ${formatINRCompact(dashboard.outstanding.amountPaise)} due from builders`}
        />
      </StatGrid>

      <div className="mt-8 grid gap-6 xl:grid-cols-3">
        <Section
          className="xl:col-span-2"
          title="Weekly volume"
          description="Invoice value submitted by channel partners against the builder-approved value accepted for early payment, last 12 weeks."
        >
          <VolumeChart data={dashboard.weekly} />
        </Section>

        <Section
          title="Agreed discount rates"
          description="Active programme per builder. Rates are configured here only."
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/financing">
                Manage
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          }
          bodyClassName="py-2"
        >
          {activeProgrammes.length === 0 ? (
            <EmptyState icon={BadgePercent} title="No active programmes" description="Builders without an active programme cannot offer early payment." />
          ) : (
            <ul className="divide-y divide-border/70">
              {activeProgrammes.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 py-3.5">
                  <div className="min-w-0">
                    <Link href={`/admin/organisations/${p.builder.id}`} className="block truncate text-sm font-medium text-navy hover:underline">
                      {p.builder.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.code} · {p.financier.name}
                    </p>
                  </div>
                  <span className="tabular font-display text-2xl font-semibold text-heritage">{formatBps(p.discountRateBps)}</span>
                </li>
              ))}
            </ul>
          )}
          {programmes.length > activeProgrammes.length && (
            <p className="border-t border-border/70 pt-3 pb-2 text-xs text-muted-foreground">
              {programmes.length - activeProgrammes.length} further programme(s) in draft, suspended or closed status.
            </p>
          )}
        </Section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Section title="Invoices by status" description="Count and gross invoice value at each review stage." bodyClassName="py-2">
          <StatusBreakdown
            kind="invoice"
            order={Object.keys(INVOICE_STATUS) as InvoiceStatus[]}
            rows={invoices.byStatus}
            href={(s) => `/admin/transactions?view=invoices&status=${s}`}
          />
        </Section>
        <Section title="Financing requests by status" description="Count and builder-approved value at each financing stage." bodyClassName="py-2">
          <StatusBreakdown
            kind="financing"
            order={(Object.keys(FINANCING_STATUS) as FinancingStatus[]).filter((s) => !["NOT_REQUESTED", "REQUESTED", "OFFER_GENERATED"].includes(s))}
            rows={requests.byStatus.map((r) => ({ status: r.status, count: r.count, amountPaise: r.approvedPaise }))}
            href={(s) => `/admin/transactions?status=${s}`}
          />
        </Section>
      </div>

      <Section
        className="mt-6"
        title="Recent activity"
        description="The latest entries from the platform audit trail."
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/audit">
              View audit log
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        }
        bodyClassName="py-1"
      >
        {audit.length === 0 ? (
          <EmptyState title="No activity yet" description="Actions taken in any workspace will appear here." />
        ) : (
          <ol className="divide-y divide-border/70">
            {audit.map((entry) => {
              const org = entry.actorOrgId ? directory.get(entry.actorOrgId) : undefined;
              return (
                <li key={entry.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <time dateTime={entry.createdAt.toISOString()} className="tabular w-40 shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-ink">{entry.summary}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {entry.actorName}
                      {org ? ` · ${org.name}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {org && <OrgTypeBadge type={org.type} />}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-navy">{entry.action}</code>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Section>
    </>
  );
}
