import type { Metadata } from "next";
import { BarChart3, Download, FileSpreadsheet, HandCoins, Landmark, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatINRCompact, sumPaise } from "@/lib/money";
import { SETTLEMENT_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { getBuilderReport } from "@/server/queries/builder";
import { Empty, Figure, Masthead, Metric, MetricStrip, Panel } from "../_components/kit";
import { Money } from "../_components/money";
import { formatDays } from "../_lib/dates";
import { FinancingByProjectChart, MonthlyVolumeChart, SettlementProfileChart, TurnaroundChart } from "./_components/report-charts";

export const metadata: Metadata = { title: "Reports" };

const EXPORT_URL = "/api/builder/reports/invoices";
const toRupees = (paise: bigint) => Number(paise / 100n);

export default async function ReportsPage() {
  const actor = await requireWorkspace("builder");
  const report = await getBuilderReport(actor);

  const financed = sumPaise(report.financingByProject.map((p) => p.financed));
  const approved = financed + sumPaise(report.financingByProject.map((p) => p.notFinanced));
  const takeUp = approved > 0n ? Number((financed * 1000n) / approved) / 10 : null;
  const settlementRows = (["NOT_DUE", "DUE", "OVERDUE", "SETTLED"] as const).map((status) => ({
    status,
    label: SETTLEMENT_STATUS[status].label,
    value: toRupees(report.settlementProfile[status].value),
    count: report.settlementProfile[status].count,
  }));
  const hasSettlements = settlementRows.some((r) => r.count > 0);
  const monthlyTotal = report.monthly.reduce((n, m) => n + m.count, 0);
  const firstMonth = report.monthly[0]?.label;
  const lastMonth = report.monthly[report.monthly.length - 1]?.label;

  return (
    <>
      <Masthead
        eyebrow="Finance"
        title="Reports"
        lede="Invoice flow, approval speed, early-payment take-up and settlement exposure across your projects."
        actions={
          <Button asChild>
            <a href={EXPORT_URL} download>
              <Download className="size-4" />
              Export invoices (CSV)
            </a>
          </Button>
        }
      />

      <MetricStrip className="mb-6 grid-cols-1 sm:mb-8 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Invoices received"
          value={<Figure unit={report.invoiceCount === 1 ? "invoice" : "invoices"}>{report.invoiceCount}</Figure>}
          caption={`${monthlyTotal} submitted since ${firstMonth}`}
        />
        <Metric
          label="Average turnaround"
          accent="slate"
          value={<Figure>{formatDays(report.turnaround.averageDays)}</Figure>}
          caption={`Submission to decision across ${report.turnaround.decidedCount} decided ${report.turnaround.decidedCount === 1 ? "invoice" : "invoices"}`}
        />
        <Metric label="Median turnaround" accent="slate" value={<Figure>{formatDays(report.turnaround.medianDays)}</Figure>} caption="Half of decisions are made within this time" />
        <Metric
          label="Early-payment take-up"
          accent="kota"
          value={<Figure>{takeUp === null ? "—" : `${takeUp.toFixed(1)}%`}</Figure>}
          caption={
            <>
              <Money paise={financed} compact /> of <Money paise={approved} compact /> approved value financed
            </>
          }
        />
      </MetricStrip>

      <div className="grid gap-6 sm:gap-8 xl:grid-cols-2">
        <Panel eyebrow="Flow" title="Monthly invoice volume" description={`Value submitted by channel partners and the amount you approved, by month of submission (${firstMonth} – ${lastMonth})`}>
          {monthlyTotal === 0 ? (
            <Empty icon={BarChart3} title="No invoices in this period" className="py-10" />
          ) : (
            <MonthlyVolumeChart
              data={report.monthly.map((m) => ({ label: m.label, count: m.count, submitted: toRupees(m.value), approved: toRupees(m.approvedValue) }))}
            />
          )}
        </Panel>

        <Panel eyebrow="Speed" title="Approval turnaround" description="Time from submission (or latest resubmission) to your approval or rejection">
          {report.turnaround.decidedCount === 0 ? (
            <Empty icon={Timer} title="No decisions yet" description="Turnaround appears once invoices are approved or rejected." className="py-10" />
          ) : (
            <TurnaroundChart data={report.turnaround.distribution} />
          )}
        </Panel>

        <Panel eyebrow="Take-up" title="Financed vs not financed by project" description="Approved value of accepted invoices, split by whether the partner took early payment">
          {report.financingByProject.length === 0 ? (
            <Empty icon={HandCoins} title="No approved invoices yet" className="py-10" />
          ) : (
            <FinancingByProjectChart
              data={report.financingByProject.map((p) => ({
                name: p.name,
                financed: toRupees(p.financed),
                notFinanced: toRupees(p.notFinanced),
                financedCount: p.financedCount,
                notFinancedCount: p.notFinancedCount,
              }))}
            />
          )}
        </Panel>

        <Panel
          eyebrow="Exposure"
          title="Settlement profile"
          description={`Amounts owed to Veefin by settlement status${
            report.awaitingDisbursement.count > 0 ? ` · ${formatINRCompact(report.awaitingDisbursement.value)} more once pending disbursements complete` : ""
          }`}
        >
          {hasSettlements ? (
            <SettlementProfileChart data={settlementRows} />
          ) : (
            <Empty icon={Landmark} title="No settlements yet" description="Settlements arise when Veefin pays a partner early on your approved invoice." className="py-10" />
          )}
        </Panel>
      </div>

      <Panel className="mt-6 sm:mt-8" eyebrow="Reconciliation" title="Data export" description="Download every invoice visible to your organisation for reconciliation or your ERP">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-leaf-100 text-leaf">
              <FileSpreadsheet className="size-5" strokeWidth={1.6} />
            </span>
            <p className="max-w-2xl text-sm leading-relaxed text-fg-soft">
              CSV with one row per invoice: partner, project, dates, status, invoice / GST / approved amounts in rupees, and the early-payment and settlement position. Opens
              directly in Excel. Disbursement references are simulated.
            </p>
          </div>
          <Button variant="outline" asChild>
            <a href={EXPORT_URL} download>
              <Download className="size-4" />
              Download CSV
            </a>
          </Button>
        </div>
      </Panel>
    </>
  );
}
