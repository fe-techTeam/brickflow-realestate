import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine, BadgeCheck, CircleCheck, Clock3, FlaskConical } from "lucide-react";
import { DataTable, Td, Th, Tr } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { DemoBadge, StatusBadge } from "@/components/common/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { getBeneficiaries } from "@/server/queries/finance";
import { effectiveSettlementStatus, listFinancingRequests, refreshSettlementStatuses } from "@/server/services/financing";
import { ConfirmTransferButton, InitiateDisbursementButton } from "../_components/request-actions";
import { RequestActionLink } from "../_components/request-table";
import { toDisbursementSummary } from "../_lib/summaries";

export const metadata: Metadata = { title: "Disbursements · Veefin Finance" };

function Party({ id, cp, builder, reference }: { id: string; cp: string; builder: string; reference: string }) {
  return (
    <>
      <Link href={`/finance/requests/${id}`} className="font-medium text-navy hover:underline">
        {cp}
      </Link>
      <p className="text-xs text-muted-foreground">{builder}</p>
      <p className="tabular text-xs whitespace-nowrap text-muted-foreground">{reference}</p>
    </>
  );
}

export default async function DisbursementsPage() {
  const actor = await requireWorkspace("finance");
  const now = new Date();
  await refreshSettlementStatuses(now);
  const requests = await listFinancingRequests(actor, { status: ["APPROVED", "DISBURSEMENT_INITIATED", "DISBURSED"] });
  const ready = requests.filter((r) => r.status === "APPROVED").sort((a, b) => (a.decidedAt?.getTime() ?? 0) - (b.decidedAt?.getTime() ?? 0));
  const inProgress = requests.filter((r) => r.status === "DISBURSEMENT_INITIATED");
  const completed = requests
    .filter((r) => r.status === "DISBURSED" && r.disbursement)
    .sort((a, b) => (b.disbursement!.completedAt?.getTime() ?? 0) - (a.disbursement!.completedAt?.getTime() ?? 0));
  const beneficiaries = await getBeneficiaries(
    actor,
    ready.map((r) => r.cpId),
  );

  const readyValue = sumPaise(ready.map((r) => r.netPayablePaise));
  const inProgressValue = sumPaise(inProgress.map((r) => r.disbursement?.amountPaise ?? r.netPayablePaise));
  const completedValue = sumPaise(completed.map((r) => r.disbursement!.amountPaise));

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Disbursements"
        description="Pay approved requests to channel partners in two steps: initiate the payout instruction, then confirm the transfer. All payouts in this environment are simulated."
        actions={
          <span className="inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold-100 px-3 py-2 text-xs font-medium text-gold-600">
            <FlaskConical className="size-3.5" aria-hidden="true" />
            Simulated payouts — no real funds move
          </span>
        }
      />

      <StatGrid className="xl:grid-cols-4 2xl:grid-cols-4">
        <StatCard label="Ready to disburse" value={ready.length} hint={`${formatINRCompact(readyValue)} net payable`} icon={BadgeCheck} tone="gold" />
        <StatCard label="In progress" value={inProgress.length} hint={`${formatINRCompact(inProgressValue)} awaiting confirmation`} icon={Clock3} />
        <StatCard label="Completed" value={completed.length} hint="Simulated payouts confirmed" icon={CircleCheck} tone="heritage" />
        <StatCard label="Total disbursed" value={formatINRCompact(completedValue)} hint="Net paid to channel partners (simulated)" icon={ArrowDownToLine} tone="heritage" />
      </StatGrid>

      <div className="mt-6 space-y-6">
        <Section title="Ready to disburse" description="Approved by Veefin — oldest approval first" actions={<DemoBadge />}>
          {ready.length === 0 ? (
            <EmptyState icon={BadgeCheck} title="Nothing to disburse" description="Approved requests appear here until a payout is initiated." className="py-10" />
          ) : (
            <DataTable minWidth={900}>
              <thead>
                <tr>
                  <Th>Channel partner</Th>
                  <Th>Invoice no.</Th>
                  <Th>Beneficiary account</Th>
                  <Th align="right">Net payable</Th>
                  <Th>Approved</Th>
                  <Th align="right">
                    <span className="sr-only">Action</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {ready.map((r) => {
                  const beneficiary = beneficiaries.get(r.cpId);
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <Party id={r.id} cp={r.cp.name} builder={r.builder.name} reference={r.reference} />
                      </Td>
                      <Td className="tabular whitespace-nowrap">{r.invoice.invoiceNumber}</Td>
                      <Td>
                        <span className="tabular">{beneficiary?.accountMasked ?? "—"}</span>
                        <p className="text-xs text-muted-foreground">{beneficiary?.bankName ?? "—"}</p>
                      </Td>
                      <Td align="right" className="font-medium text-heritage">
                        {formatINR(r.netPayablePaise)}
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(r.decidedAt)}</Td>
                      <Td align="right">
                        <InitiateDisbursementButton summary={toDisbursementSummary(r, beneficiary)} size="sm" />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </Section>

        <Section title="In progress" description="Payout instruction booked — confirm the simulated transfer to complete" actions={<DemoBadge />}>
          {inProgress.length === 0 ? (
            <EmptyState icon={Clock3} title="No payouts in flight" description="Initiated disbursements wait here for transfer confirmation." className="py-10" />
          ) : (
            <DataTable minWidth={900}>
              <thead>
                <tr>
                  <Th>Payment reference</Th>
                  <Th>Channel partner</Th>
                  <Th>Beneficiary</Th>
                  <Th align="right">Amount</Th>
                  <Th>Initiated</Th>
                  <Th align="right">
                    <span className="sr-only">Action</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {inProgress.map((r) => (
                  <Tr key={r.id}>
                    <Td className="tabular font-medium whitespace-nowrap text-navy">{r.disbursement?.reference ?? "—"}</Td>
                    <Td>
                      <Party id={r.id} cp={r.cp.name} builder={r.builder.name} reference={r.reference} />
                    </Td>
                    <Td>
                      {r.disbursement?.beneficiaryName ?? "—"}
                      <p className="tabular text-xs text-muted-foreground">
                        {r.disbursement?.beneficiaryAccount} · {r.disbursement?.beneficiaryIfsc}
                      </p>
                    </Td>
                    <Td align="right" className="font-medium text-heritage">
                      {formatINR(r.disbursement?.amountPaise ?? r.netPayablePaise)}
                    </Td>
                    <Td className="whitespace-nowrap">{formatDateTime(r.disbursement?.initiatedAt)}</Td>
                    <Td align="right">
                      <ConfirmTransferButton
                        requestId={r.id}
                        paymentReference={r.disbursement?.reference ?? r.reference}
                        amountPaise={(r.disbursement?.amountPaise ?? r.netPayablePaise).toString()}
                        size="sm"
                      />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Section>

        <Section title="Completed" description="Confirmed simulated payouts, most recent first" actions={<DemoBadge />}>
          {completed.length === 0 ? (
            <EmptyState icon={CircleCheck} title="No completed payouts yet" className="py-10" />
          ) : (
            <DataTable minWidth={1000}>
              <thead>
                <tr>
                  <Th>Payment reference</Th>
                  <Th>UTR</Th>
                  <Th>Channel partner</Th>
                  <Th align="right">Amount</Th>
                  <Th>Disbursed</Th>
                  <Th>Settlement</Th>
                  <Th align="right">
                    <span className="sr-only">Action</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {completed.map((r) => (
                  <Tr key={r.id}>
                    <Td className="tabular font-medium whitespace-nowrap text-navy">{r.disbursement!.reference}</Td>
                    <Td className="tabular text-xs">{r.disbursement!.utr ?? "—"}</Td>
                    <Td>
                      <Party id={r.id} cp={r.cp.name} builder={r.builder.name} reference={r.reference} />
                    </Td>
                    <Td align="right" className="font-medium text-heritage">
                      {formatINR(r.disbursement!.amountPaise)}
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(r.disbursement!.completedAt)}</Td>
                    <Td>{r.settlement ? <StatusBadge kind="settlement" status={effectiveSettlementStatus(r.settlement, now)} /> : "—"}</Td>
                    <Td align="right">
                      <RequestActionLink id={r.id} status={r.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Section>
      </div>
    </>
  );
}
