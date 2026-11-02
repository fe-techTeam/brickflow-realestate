import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BadgeCheck, Building2, Landmark, Wallet } from "lucide-react";
import { DataTable, Td, Th, Tr } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { StatusBadge, ToneBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatBps, formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { listFinanceBuilders } from "@/server/queries/finance";

export const metadata: Metadata = { title: "Builders · Veefin Finance" };

export default async function BuildersPage() {
  const actor = await requireWorkspace("finance");
  const builders = await listFinanceBuilders(actor);
  const overdue = builders.filter((b) => b.overdueCount > 0).length;

  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Builders"
        description="Developers with a Veefin early-payment programme, with their approved invoice book, financed value and settlement position."
      />

      <StatGrid className="xl:grid-cols-4 2xl:grid-cols-4">
        <StatCard label="Builders" value={builders.length} hint={`${builders.filter((b) => b.programme.status === "ACTIVE").length} with an active programme`} icon={Building2} />
        <StatCard label="Approved invoices" value={formatINRCompact(sumPaise(builders.map((b) => b.approvedInvoiceValue)))} hint="Builder-approved CP invoices" icon={BadgeCheck} tone="slate" />
        <StatCard label="Financed" value={formatINRCompact(sumPaise(builders.map((b) => b.financedValue)))} hint="Approved or disbursed requests" icon={Wallet} tone="heritage" />
        <StatCard
          label="Outstanding settlements"
          value={formatINRCompact(sumPaise(builders.map((b) => b.outstandingValue)))}
          hint={overdue ? `${overdue} builder${overdue === 1 ? "" : "s"} overdue` : "No builder overdue"}
          icon={overdue ? AlertTriangle : Landmark}
          tone={overdue ? "gold" : "navy"}
        />
      </StatGrid>

      <Section className="mt-6" title="Builder portfolio" description={`${builders.length} builder${builders.length === 1 ? "" : "s"}`}>
        {builders.length === 0 ? (
          <EmptyState icon={Building2} title="No builders yet" description="Builders appear here once the Super Admin configures a Veefin programme for them." />
        ) : (
          <DataTable minWidth={1040}>
            <thead>
              <tr>
                <Th>Builder</Th>
                <Th>Programme</Th>
                <Th>Status</Th>
                <Th align="right">Projects</Th>
                <Th align="right">Approved invoices</Th>
                <Th align="right">Financed</Th>
                <Th align="right">Outstanding settlement</Th>
                <Th align="right">
                  <span className="sr-only">Action</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {builders.map((b) => (
                <Tr key={b.id}>
                  <Td>
                    <Link href={`/finance/builders/${b.id}`} className="font-medium text-navy hover:underline">
                      {b.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{[b.city, b.state].filter(Boolean).join(", ")}</p>
                  </Td>
                  <Td>
                    <span className="tabular font-medium text-navy">{b.programme.code}</span>
                    <p className="text-xs text-muted-foreground">
                      <span className="tabular font-semibold text-heritage">{formatBps(b.programme.discountRateBps)}</span> agreed discount
                    </p>
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge kind="programme" status={b.programme.status} />
                      {b.status !== "ACTIVE" && <StatusBadge kind="record" status={b.status} />}
                    </div>
                  </Td>
                  <Td align="right">{b.projectCount}</Td>
                  <Td align="right">
                    {formatINR(b.approvedInvoiceValue)}
                    <p className="text-xs text-muted-foreground">{b.approvedInvoiceCount} invoices</p>
                  </Td>
                  <Td align="right">
                    {formatINR(b.financedValue)}
                    <p className="text-xs text-muted-foreground">{b.financedCount} requests</p>
                  </Td>
                  <Td align="right">
                    <span className={b.overdueCount ? "font-medium text-[#93342a]" : undefined}>{formatINR(b.outstandingValue)}</span>
                    <div className="mt-1 flex justify-end">
                      {b.overdueCount > 0 ? (
                        <ToneBadge meta={{ label: `${b.overdueCount} overdue`, tone: "danger" }} />
                      ) : b.outstandingValue > 0n ? (
                        <span className="text-xs text-muted-foreground">On schedule</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Nothing open</span>
                      )}
                    </div>
                  </Td>
                  <Td align="right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/finance/builders/${b.id}`} aria-label={`View ${b.name}`}>
                        View
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
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
