import Link from "next/link";
import { HandCoins, Info } from "lucide-react";
import { AmountRow, DetailList, EmptyState, Section, Timeline, type TimelineEntry } from "@/components/common/panels";
import { DemoBadge, StatusBadge } from "@/components/common/status-badge";
import type { FinancingStatus } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps, formatINR } from "@/lib/money";
import { FINANCING_STATUS } from "@/lib/status";
import { effectiveSettlementStatus } from "@/server/services/financing";
import type { InvoiceDetail } from "@/server/services/invoices";
import { formatDueIn } from "../../../_lib/dates";

const EVENT_TONE: Partial<Record<FinancingStatus, TimelineEntry["tone"]>> = {
  APPROVED: "success",
  DISBURSED: "success",
  REJECTED: "danger",
  PENDING_APPROVAL: "warning",
  ACCEPTED_BY_CP: "gold",
};

/** Read-only view of early payment on an accepted invoice, from the builder's perspective. */
export function FinancingPanel({ invoice, originalDueDate, creditPeriodDays }: { invoice: InvoiceDetail; originalDueDate: Date; creditPeriodDays: number | null }) {
  const request = invoice.financingRequest;
  const unchangedNote = (
    <div className="flex gap-3 rounded-md bg-sage/70 px-4 py-3 text-sm text-heritage">
      <Info className="mt-0.5 size-4 shrink-0" />
      <p className="leading-relaxed">
        <span className="font-semibold">Your commercial terms are unchanged.</span> The original due date of {formatDate(originalDueDate)}
        {creditPeriodDays ? ` and the ${creditPeriodDays}-day credit period agreed with ${invoice.cp.name}` : ""} stay exactly as they are. Early payment only changes{" "}
        <em>who</em> you pay on that date{request && request.status !== "REJECTED" ? " — Veefin instead of the channel partner" : ""}. The discount is borne by the
        channel partner.
      </p>
    </div>
  );

  if (!request) {
    return (
      <Section title="Early payment" description="Financing by Veefin against this approved invoice">
        <EmptyState
          icon={HandCoins}
          title="No early payment requested"
          description={
            invoice.financingStatus === "OFFER_GENERATED"
              ? `${invoice.cp.name} has viewed an early-payment offer on this invoice but has not accepted it.`
              : `${invoice.cp.name} has not requested early payment on this invoice. If they do, Veefin pays them early and you pay Veefin the approved amount on the original due date.`
          }
          className="py-8"
        />
        {unchangedNote}
      </Section>
    );
  }

  const settlement = request.settlement;
  const settlementStatus = settlement ? effectiveSettlementStatus(settlement) : null;
  const disbursement = request.disbursement;
  const approvalStatus: FinancingStatus = request.status === "PENDING_APPROVAL" || request.status === "REJECTED" ? request.status : "APPROVED";

  return (
    <Section
      title="Early payment"
      description={`Financing request ${request.reference} · ${request.financier.name} · programme ${request.programme.code}`}
      actions={<StatusBadge kind="financing" status={request.status} />}
    >
      <div className="grid gap-8">
        <div className="max-w-2xl">
          <p className="eyebrow mb-1">Amounts</p>
          <div className="divide-y divide-border/70">
            <AmountRow label="Original invoice amount" value={formatINR(invoice.amountPaise)} hint="As submitted, incl. GST" />
            <AmountRow label="Approved amount" value={formatINR(request.approvedAmountPaise)} hint="Approved by you; basis for the discount" />
            <AmountRow label={`Discount at ${formatBps(request.discountRateBps)}`} value={`− ${formatINR(request.discountAmountPaise)}`} tone="deduct" hint="Borne by the channel partner" />
            {request.chargesPaise > 0n && <AmountRow label="Charges" value={`− ${formatINR(request.chargesPaise)}`} tone="deduct" />}
            <AmountRow label="Net paid to channel partner" value={formatINR(request.netPayablePaise)} tone="total" hint={`Paid by Veefin to ${invoice.cp.name}`} />
          </div>
        </div>
        <div className="space-y-6">
          <DetailList
            columns={3}
            items={[
              { label: "Channel partner", value: invoice.cp.name },
              { label: "Financing %", value: formatBps(request.discountRateBps) },
              {
                label: "Financing approval",
                value: (
                  <span className="flex flex-col items-start gap-1">
                    <StatusBadge kind="financing" status={approvalStatus} />
                    {request.decidedAt && <span className="text-xs text-muted-foreground">Decided by Veefin {formatDateTime(request.decidedAt)}</span>}
                  </span>
                ),
              },
              { label: "Requested", value: formatDateTime(request.acceptedAt) },
              {
                label: "Disbursement reference",
                value: disbursement ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{disbursement.reference}</span>
                    <DemoBadge />
                  </span>
                ) : (
                  "Not yet disbursed"
                ),
              },
              {
                label: "UTR",
                value: disbursement?.utr ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{disbursement.utr}</span>
                    <DemoBadge />
                  </span>
                ) : (
                  "—"
                ),
              },
            ]}
          />
          {request.decisionNote && request.status === "REJECTED" && (
            <p className="rounded-md bg-muted/70 px-3 py-2 text-sm text-slate-ink">
              <span className="font-medium text-navy">Veefin&apos;s reason: </span>
              {request.decisionNote}
            </p>
          )}
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-border bg-ivory/50 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="font-display text-lg font-semibold text-navy">Settlement with Veefin</p>
          {settlementStatus && <StatusBadge kind="settlement" status={settlementStatus} />}
        </div>
        {settlement && settlementStatus ? (
          <DetailList
            columns={3}
            items={[
              { label: "Amount due to Veefin", value: formatINR(settlement.amountPaise), emphasis: true },
              {
                label: "Due date",
                value: (
                  <>
                    {formatDate(settlement.dueDate)}
                    {settlementStatus !== "SETTLED" && <span className="block text-xs text-muted-foreground">{formatDueIn(settlement.dueDate)}</span>}
                  </>
                ),
              },
              {
                label: settlementStatus === "SETTLED" ? "Settled" : "Recorded by",
                value:
                  settlementStatus === "SETTLED" ? (
                    <>
                      {formatDate(settlement.settledAt)}
                      {settlement.reference && <span className="block font-mono text-xs text-muted-foreground">{settlement.reference}</span>}
                    </>
                  ) : (
                    "Veefin, once your payment is received"
                  ),
              },
            ]}
          />
        ) : request.status === "REJECTED" ? (
          <p className="text-sm text-slate-ink">No settlement arises: Veefin rejected this request. Pay {invoice.cp.name} directly on your normal terms.</p>
        ) : (
          <p className="text-sm text-slate-ink">
            A settlement of <span className="tabular font-semibold text-navy">{formatINR(request.approvedAmountPaise)}</span> will be scheduled for{" "}
            {formatDate(originalDueDate)} once Veefin completes the {request.status === "PENDING_APPROVAL" ? "approval and " : ""}disbursement.
          </p>
        )}
        <div className="mt-5">{unchangedNote}</div>
      </div>

      {request.events.length > 0 && (
        <div className="mt-8">
          <p className="eyebrow mb-4">Financing history</p>
          <Timeline
            entries={request.events.map((e) => ({
              id: e.id,
              tone: EVENT_TONE[e.toStatus] ?? "default",
              title: FINANCING_STATUS[e.toStatus].label,
              meta: `${e.actorName} · ${formatDateTime(e.createdAt)}`,
              body: e.note ?? undefined,
            }))}
          />
        </div>
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        Settlement summary across all invoices is on the{" "}
        <Link href="/builder/settlements" className="text-navy underline-offset-4 hover:underline">
          Settlements
        </Link>{" "}
        page.
      </p>
    </Section>
  );
}
