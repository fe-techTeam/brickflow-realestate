import { BadgeCheck, CircleCheck, Clock3, Hourglass, Landmark, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { SettlementStatus } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FinancingRequestDetail } from "@/server/services/financing";
import { FactList, Money, SimulatedTag } from "../../../_components/ledger";
import {
  ApproveRequestButton,
  ConfirmTransferButton,
  InitiateDisbursementButton,
  MarkSettledButton,
  RejectRequestButton,
  type DisbursementSummary,
  type RequestSummary,
} from "../../../_components/request-actions";

type Tone = "warning" | "gold" | "navy" | "success" | "danger";

const BAR: Record<Tone, string> = {
  warning: "from-[#c48a2c] to-gold",
  gold: "from-gold to-[#d6bc8a]",
  navy: "from-navy to-navy-700",
  success: "from-heritage to-heritage-600",
  danger: "from-danger to-[#b5473a]",
};

const ICON: Record<Tone, string> = {
  warning: "bg-warning-soft text-warning ring-[#efd9ae]",
  gold: "bg-gold-100 text-gold-600 ring-gold/30",
  navy: "bg-navy/[0.06] text-navy ring-navy/15",
  success: "bg-sage text-heritage ring-heritage/20",
  danger: "bg-danger-soft text-danger ring-danger/25",
};

function DecisionCard({
  tone,
  icon,
  eyebrow,
  title,
  figureLabel,
  figure,
  aside,
  children,
}: {
  tone: Tone;
  icon: ReactNode;
  eyebrow: string;
  title: string;
  figureLabel?: string;
  figure?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label="Next action"
      className="relative animate-fade-up overflow-hidden rounded-xl border border-border bg-card shadow-[0_24px_48px_-30px_rgba(20,43,67,0.45)]"
    >
      <div aria-hidden="true" className={cn("h-1 bg-gradient-to-r", BAR[tone])} />
      <div className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full ring-1", ICON[tone])}>{icon}</span>
            <div className="min-w-0">
              <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-gold-600 uppercase">{eyebrow}</p>
              <h2 className="mt-1 font-display text-[1.5rem] leading-tight font-medium">{title}</h2>
            </div>
          </div>
          {aside}
        </div>
        {figure && (
          <div className="mt-6 rounded-lg bg-ivory/70 px-5 py-4 ring-1 ring-gold/20">
            <p className="text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">{figureLabel}</p>
            <div className="mt-2">{figure}</div>
          </div>
        )}
        <div className="mt-5 space-y-4 text-sm text-slate-ink">{children}</div>
      </div>
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="border-l-2 border-gold/60 pl-3 text-[0.8125rem] leading-relaxed text-slate-ink italic">{children}</p>;
}

export function DecisionPanel({
  request,
  summary,
  disbursement,
  settlementStatus,
  names,
}: {
  request: FinancingRequestDetail;
  summary: RequestSummary;
  disbursement: DisbursementSummary;
  settlementStatus: SettlementStatus | null;
  names: Map<string, string>;
}) {
  const decidedBy = request.decidedById ? (names.get(request.decidedById) ?? "Veefin user") : "—";

  switch (request.status) {
    case "PENDING_APPROVAL":
      return (
        <DecisionCard
          tone="warning"
          icon={<Hourglass className="size-4" />}
          eyebrow="Credit decision required"
          title="Pending Veefin approval"
          figureLabel="Net payable to channel partner"
          figure={<Money paise={request.netPayablePaise} size="xl" className="text-heritage" />}
        >
          <FactList
            items={[
              { label: "Builder-approved amount", value: <Money paise={request.approvedAmountPaise} /> },
              { label: "Builder settles on", value: formatDate(request.invoice.dueDate) },
            ]}
          />
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            Review the invoice, counterparties and the accepted offer, then approve the request for disbursement or reject it with a reason.
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 pt-1 [&>*:first-child_button]:h-11 [&>*:first-child_button]:w-full [&>*:last-child_button]:h-11">
            <div>
              <ApproveRequestButton summary={summary} />
            </div>
            <div>
              <RejectRequestButton summary={summary} />
            </div>
          </div>
        </DecisionCard>
      );
    case "APPROVED":
      return (
        <DecisionCard
          tone="success"
          icon={<BadgeCheck className="size-4" />}
          eyebrow="Approved · ready to disburse"
          title="Cleared for payout"
          figureLabel="Amount to disburse"
          figure={<Money paise={request.netPayablePaise} size="xl" className="text-heritage" />}
          aside={<SimulatedTag />}
        >
          <FactList
            items={[
              { label: "Approved by", value: decidedBy },
              { label: "Approved on", value: formatDateTime(request.decidedAt) },
              { label: "Beneficiary", value: disbursement.beneficiaryName },
            ]}
          />
          {request.decisionNote && <Note>“{request.decisionNote}”</Note>}
          <InitiateDisbursementButton summary={disbursement} className="h-11 w-full" />
          <p className="text-xs leading-relaxed text-muted-foreground">Simulated payout. No bank is contacted; a demo payment reference is generated.</p>
        </DecisionCard>
      );
    case "DISBURSEMENT_INITIATED":
      return (
        <DecisionCard
          tone="navy"
          icon={<Clock3 className="size-4" />}
          eyebrow="Disbursement in progress"
          title="Awaiting transfer confirmation"
          figureLabel="Amount in flight"
          figure={<Money paise={request.disbursement?.amountPaise ?? request.netPayablePaise} size="xl" className="text-navy" />}
          aside={<SimulatedTag />}
        >
          <FactList
            items={[
              { label: "Payment reference", value: <span className="tabular">{request.disbursement?.reference ?? "—"}</span> },
              { label: "Initiated", value: formatDateTime(request.disbursement?.initiatedAt) },
            ]}
          />
          <div className="[&_button]:h-11 [&_button]:w-full">
            <ConfirmTransferButton
              requestId={request.id}
              paymentReference={request.disbursement?.reference ?? request.reference}
              amountPaise={(request.disbursement?.amountPaise ?? request.netPayablePaise).toString()}
              beneficiaryName={request.disbursement?.beneficiaryName ?? disbursement.beneficiaryName}
            />
          </div>
        </DecisionCard>
      );
    case "DISBURSED": {
      const settled = settlementStatus === "SETTLED";
      const overdue = settlementStatus === "OVERDUE";
      return (
        <DecisionCard
          tone={settled ? "success" : overdue ? "danger" : "navy"}
          icon={settled ? <CircleCheck className="size-4" /> : <Landmark className="size-4" />}
          eyebrow={settled ? "Closed · fully settled" : "Disbursed · awaiting builder"}
          title={settled ? "Settled by builder" : overdue ? "Settlement overdue" : "Settlement open"}
          figureLabel={settled ? "Settled with Veefin" : "Due from builder"}
          figure={<Money paise={request.settlement?.amountPaise ?? request.approvedAmountPaise} size="xl" className={settled ? "text-heritage" : overdue ? "text-danger" : "text-navy"} />}
        >
          <FactList
            items={[
              { label: "Disbursed to CP (simulated)", value: <Money paise={request.disbursement?.amountPaise ?? request.netPayablePaise} /> },
              { label: settled ? "Settled on" : "Due on", value: settled ? formatDate(request.settlement?.settledAt) : formatDate(request.settlement?.dueDate) },
            ]}
          />
          {!settled && request.settlement && (
            <div className="[&_button]:h-11 [&_button]:w-full">
              <MarkSettledButton
                requestId={request.id}
                requestReference={request.reference}
                builderName={request.builder.name}
                amountPaise={request.settlement.amountPaise.toString()}
              />
            </div>
          )}
        </DecisionCard>
      );
    }
    case "REJECTED":
      return (
        <DecisionCard tone="danger" icon={<XCircle className="size-4" />} eyebrow="Closed" title="Request rejected">
          <FactList
            items={[
              { label: "Rejected by", value: decidedBy },
              { label: "Rejected on", value: formatDateTime(request.decidedAt) },
            ]}
          />
          {request.decisionNote && <Note>{request.decisionNote}</Note>}
          <p className="text-xs leading-relaxed text-muted-foreground">A rejection is final for this invoice; no further financing request can be raised on it.</p>
        </DecisionCard>
      );
    default:
      return null;
  }
}
