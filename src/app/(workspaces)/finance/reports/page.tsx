import type { Metadata } from "next";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBps, formatINR, formatINRCompact } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { getFinanceReports } from "@/server/queries/finance";
import { BuilderValueChart, ExposureChart, MonthlyVolumeChart, SettlementAgeingChart } from "../_components/charts";
import { KeyFigures, Masthead, Money, Panel, SimulatedTag } from "../_components/ledger";

export const metadata: Metadata = { title: "Reports · Veefin Finance" };

export default async function ReportsPage() {
  const actor = await requireWorkspace("finance");
  const report = await getFinanceReports(actor);
  const monthlyTotal = report.monthly.reduce((sum, m) => sum + BigInt(m.paise), 0n);

  return (
    <>
      <Masthead
        eyebrow="Operations · Portfolio analytics"
        title="Reports"
        context={[
          <span key="d">
            <strong className="tabular font-semibold text-basalt">{formatINRCompact(report.disbursedValue)}</strong> disbursed
          </span>,
          <span key="o">
            <strong className="tabular font-semibold text-basalt">{formatINRCompact(report.outstandingValue)}</strong> outstanding
          </span>,
          <span key="n" className="text-muted-foreground">
            Amounts in Indian rupees · payouts simulated
          </span>,
        ]}
        actions={
          <Button asChild variant="outline" className="bg-card">
            <a href="/api/finance/reports/requests" download>
              <Download className="size-4" />
              Export requests (CSV)
            </a>
          </Button>
        }
      />

      <KeyFigures
        items={[
          {
            label: "Total disbursed",
            value: <Money paise={report.disbursedValue} compact size="lg" className="text-leaf" />,
            hint: `${report.disbursedCount} simulated payout${report.disbursedCount === 1 ? "" : "s"}`,
            accent: "leaf",
          },
          {
            label: "Discount earned",
            value: <Money paise={report.discountEarned} compact size="lg" />,
            hint: report.weightedRateBps !== null ? `Weighted average ${formatBps(report.weightedRateBps)}` : "No disbursements yet",
            accent: "kota",
          },
          {
            label: "Outstanding settlements",
            value: <Money paise={report.outstandingValue} compact size="lg" />,
            hint: `${report.outstandingCount} open with builders`,
            accent: "basalt",
          },
          { label: "Settled", value: <Money paise={report.settledValue} compact size="lg" />, hint: `${report.settledCount} repaid by builders` },
        ]}
      />

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <Panel
          eyebrow="Last twelve months"
          title="Disbursed volume by month"
          description={
            <>
              Net paid to channel partners · <span className="tabular font-medium text-basalt">{formatINR(monthlyTotal)}</span>
            </>
          }
          actions={<SimulatedTag />}
        >
          <MonthlyVolumeChart data={report.monthly} />
        </Panel>

        <Panel eyebrow="Concentration" title="Exposure by builder" description="Disbursed and awaiting settlement, plus approved but not yet disbursed">
          <ExposureChart data={report.builders.map((b) => ({ name: b.name, outstanding: b.outstanding.toString(), committed: b.committed.toString() }))} />
        </Panel>

        <Panel eyebrow="Yield" title="Discount earned by builder" description="Sum of discount amounts on disbursed requests">
          <BuilderValueChart
            data={report.builders.map((b) => ({ name: b.name, paise: b.discount.toString() }))}
            seriesLabel="Discount earned"
            emptyText="No discount earned yet. Nothing has been disbursed."
          />
        </Panel>

        <Panel eyebrow="Credit risk" title="Settlement ageing" description="Open builder settlements by days to or past the due date">
          <SettlementAgeingChart data={report.ageing} />
        </Panel>
      </div>
    </>
  );
}
