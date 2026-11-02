import type { Metadata } from "next";
import { BadgePercent, Download, Landmark, Scale, Wallet } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { DemoBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatBps, formatINR, formatINRCompact } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { getFinanceReports } from "@/server/queries/finance";
import { BuilderValueChart, ExposureChart, MonthlyVolumeChart, SettlementAgeingChart } from "../_components/charts";

export const metadata: Metadata = { title: "Reports · Veefin Finance" };

export default async function ReportsPage() {
  const actor = await requireWorkspace("finance");
  const report = await getFinanceReports(actor);
  const monthlyTotal = report.monthly.reduce((sum, m) => sum + BigInt(m.paise), 0n);

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Reports"
        description="Portfolio analytics for the Veefin early-payment book. Amounts are in Indian rupees; payouts are simulated in this environment."
        actions={
          <Button asChild variant="outline">
            <a href="/api/finance/reports/requests" download>
              <Download className="size-4" />
              Export requests (CSV)
            </a>
          </Button>
        }
      />

      <StatGrid className="xl:grid-cols-4 2xl:grid-cols-4">
        <StatCard
          label="Total disbursed"
          value={formatINRCompact(report.disbursedValue)}
          hint={`${report.disbursedCount} simulated payout${report.disbursedCount === 1 ? "" : "s"}`}
          icon={Wallet}
          tone="heritage"
        />
        <StatCard
          label="Discount earned"
          value={formatINRCompact(report.discountEarned)}
          hint={report.weightedRateBps !== null ? `Weighted average ${formatBps(report.weightedRateBps)}` : "No disbursements yet"}
          icon={BadgePercent}
          tone="gold"
        />
        <StatCard
          label="Outstanding settlements"
          value={formatINRCompact(report.outstandingValue)}
          hint={`${report.outstandingCount} open with builders`}
          icon={Scale}
        />
        <StatCard label="Settled" value={formatINRCompact(report.settledValue)} hint={`${report.settledCount} repaid by builders`} icon={Landmark} tone="slate" />
      </StatGrid>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Section
          title="Disbursed volume by month"
          description={`Net paid to channel partners · last 12 months · ${formatINR(monthlyTotal)}`}
          actions={<DemoBadge />}
        >
          <MonthlyVolumeChart data={report.monthly} />
        </Section>

        <Section title="Exposure by builder" description="Disbursed and awaiting settlement, plus approved but not yet disbursed">
          <ExposureChart
            data={report.builders.map((b) => ({ name: b.name, outstanding: b.outstanding.toString(), committed: b.committed.toString() }))}
          />
        </Section>

        <Section title="Discount earned by builder" description="Sum of discount amounts on disbursed requests">
          <BuilderValueChart
            data={report.builders.map((b) => ({ name: b.name, paise: b.discount.toString() }))}
            seriesLabel="Discount earned"
            emptyText="No discount earned yet — nothing has been disbursed."
          />
        </Section>

        <Section title="Settlement ageing" description="Open builder settlements by days to or past the due date">
          <SettlementAgeingChart data={report.ageing} />
        </Section>
      </div>
    </>
  );
}
