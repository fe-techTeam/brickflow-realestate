import type { Metadata } from "next";
import { BarChart3, Clock, Download, FileSpreadsheet, FileStack, HandCoins, Landmark, Timer } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { Button } from "@/components/ui/button";
import { formatINRCompact, sumPaise } from "@/lib/money";
import { SETTLEMENT_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { getBuilderReport } from "@/server/queries/builder";
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
      <PageHeader
        eyebrow="Finance"
        title="Reports"
        description="Invoice flow, approval speed, early-payment take-up and settlement exposure across your projects."
        actions={
          <Button asChild>
            <a href={EXPORT_URL} download>
              <Download className="size-4" />
              Export invoices (CSV)
            </a>
          </Button>
        }
      />

      <StatGrid className="mb-8 xl:grid-cols-4 2xl:grid-cols-4">
        <StatCard label="Invoices received" value={report.invoiceCount} hint={`${monthlyTotal} submitted since ${firstMonth}`} icon={FileStack} />
        <StatCard
          label="Average turnaround"
          value={formatDays(report.turnaround.averageDays)}
          hint={`Submission to decision across ${report.turnaround.decidedCount} decided ${report.turnaround.decidedCount === 1 ? "invoice" : "invoices"}`}
          icon={Timer}
          tone="slate"
        />
        <StatCard label="Median turnaround" value={formatDays(report.turnaround.medianDays)} hint="Half of decisions are made within this time" icon={Clock} tone="slate" />
        <StatCard
          label="Early-payment take-up"
          value={takeUp === null ? "—" : `${takeUp.toFixed(1)}%`}
          hint={`${formatINRCompact(financed)} of ${formatINRCompact(approved)} approved value financed`}
          icon={HandCoins}
          tone="gold"
        />
      </StatGrid>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Monthly invoice volume" description={`Value submitted by channel partners and the amount you approved, by month of submission (${firstMonth} – ${lastMonth})`}>
          {monthlyTotal === 0 ? (
            <EmptyState icon={BarChart3} title="No invoices in this period" className="py-10" />
          ) : (
            <MonthlyVolumeChart
              data={report.monthly.map((m) => ({ label: m.label, count: m.count, submitted: toRupees(m.value), approved: toRupees(m.approvedValue) }))}
            />
          )}
        </Section>

        <Section title="Approval turnaround" description="Time from submission (or latest resubmission) to your approval or rejection">
          {report.turnaround.decidedCount === 0 ? (
            <EmptyState icon={Timer} title="No decisions yet" description="Turnaround appears once invoices are approved or rejected." className="py-10" />
          ) : (
            <TurnaroundChart data={report.turnaround.distribution} />
          )}
        </Section>

        <Section title="Financed vs not financed by project" description="Approved value of accepted invoices, split by whether the partner took early payment">
          {report.financingByProject.length === 0 ? (
            <EmptyState icon={HandCoins} title="No approved invoices yet" className="py-10" />
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
        </Section>

        <Section
          title="Settlement profile"
          description={`Amounts owed to Veefin by settlement status${
            report.awaitingDisbursement.count > 0 ? ` · ${formatINRCompact(report.awaitingDisbursement.value)} more once pending disbursements complete` : ""
          }`}
        >
          {hasSettlements ? (
            <SettlementProfileChart data={settlementRows} />
          ) : (
            <EmptyState icon={Landmark} title="No settlements yet" description="Settlements arise when Veefin pays a partner early on your approved invoice." className="py-10" />
          )}
        </Section>
      </div>

      <Section className="mt-6" title="Data export" description="Download every invoice visible to your organisation for reconciliation or your ERP">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-heritage" strokeWidth={1.6} />
            <p className="max-w-2xl text-sm leading-relaxed text-slate-ink">
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
      </Section>
    </>
  );
}
