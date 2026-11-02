import { BadgeCheck, CircleCheck, Clock3, Hourglass, Landmark, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { SettlementStatus } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { FinancingRequestDetail } from "@/server/services/financing";
import {
  ApproveRequestButton,
  ConfirmTransferButton,
  InitiateDisbursementButton,
  MarkSettledButton,
  RejectRequestButton,
  type DisbursementSummary,
  type RequestSummary,
} from "../../../_components/request-actions";

function Panel({
  tone,
  icon,
  eyebrow,
  title,
  children,
}: {
  tone: "warning" | "gold" | "navy" | "success" | "danger";
  icon: ReactNode;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  const bar = {
    warning: "before:bg-[#c48a2c]",
    gold: "before:bg-gold",
    navy: "before:bg-navy",
    success: "before:bg-heritage",
    danger: "before:bg-[#b5473a]",
  }[tone];
  const badge = {
    warning: "bg-[#fbf1df] text-[#8a5a12]",
    gold: "bg-gold-100 text-gold-600",
    navy: "bg-navy/[0.07] text-navy",
    success: "bg-sage text-heritage",
    danger: "bg-[#f8e7e4] text-[#93342a]",
  }[tone];
  return (
    <section
      aria-label="Next action"
      className={cn("surface relative animate-fade-up overflow-hidden p-5 before:absolute before:inset-y-0 before:left-0 before:w-1", bar)}
    >
      <div className="flex items-start gap-3">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", badge)}>{icon}</span>
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-0.5 font-display text-xl leading-tight font-semibold">{title}</h2>
        </div>
      </div>
      <div className="mt-4 space-y-4 text-sm text-slate-ink">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular text-right font-medium text-navy">{value}</span>
    </div>
  );
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
        <Panel tone="warning" icon={<Hourglass className="size-4" />} eyebrow="Credit decision required" title="Pending Veefin approval">
          <p className="leading-relaxed">
            Review the invoice, counterparties and the accepted offer, then approve the request for disbursement or reject it with a reason.
          </p>
          <div className="space-y-1.5 rounded-md bg-ivory/60 p-3">
            <Fact label="Net payable to CP" value={formatINR(request.netPayablePaise)} />
            <Fact label="Builder settles" value={`${formatINR(request.approvedAmountPaise)} on ${formatDate(request.invoice.dueDate)}`} />
          </div>
          <div className="flex flex-wrap gap-2">
            <ApproveRequestButton summary={summary} />
            <RejectRequestButton summary={summary} />
          </div>
        </Panel>
      );
    case "APPROVED":
      return (
        <Panel tone="gold" icon={<BadgeCheck className="size-4" />} eyebrow="Ready to disburse" title="Approved for payout">
          <div className="space-y-1.5 rounded-md bg-ivory/60 p-3">
            <Fact label="Approved by" value={decidedBy} />
            <Fact label="Approved on" value={formatDateTime(request.decidedAt)} />
            <Fact label="Amount to disburse" value={formatINR(request.netPayablePaise)} />
          </div>
          {request.decisionNote && <p className="rounded-md bg-muted/70 px-3 py-2 text-xs leading-relaxed">“{request.decisionNote}”</p>}
          <InitiateDisbursementButton summary={disbursement} className="w-full" />
          <p className="text-xs text-muted-foreground">Simulated payout — no bank integration; a demo payment reference is generated.</p>
        </Panel>
      );
    case "DISBURSEMENT_INITIATED":
      return (
        <Panel tone="navy" icon={<Clock3 className="size-4" />} eyebrow="Disbursement in progress" title="Awaiting transfer confirmation">
          <div className="space-y-1.5 rounded-md bg-ivory/60 p-3">
            <Fact label="Payment reference" value={request.disbursement?.reference ?? "—"} />
            <Fact label="Initiated" value={formatDateTime(request.disbursement?.initiatedAt)} />
            <Fact label="Amount" value={formatINR(request.disbursement?.amountPaise ?? request.netPayablePaise)} />
          </div>
          <ConfirmTransferButton
            requestId={request.id}
            paymentReference={request.disbursement?.reference ?? request.reference}
            amountPaise={(request.disbursement?.amountPaise ?? request.netPayablePaise).toString()}
          />
        </Panel>
      );
    case "DISBURSED": {
      const settled = settlementStatus === "SETTLED";
      return (
        <Panel
          tone={settled ? "success" : settlementStatus === "OVERDUE" ? "danger" : "navy"}
          icon={settled ? <CircleCheck className="size-4" /> : <Landmark className="size-4" />}
          eyebrow={settled ? "Closed" : "Disbursed · awaiting builder settlement"}
          title={settled ? "Settled by builder" : settlementStatus === "OVERDUE" ? "Settlement overdue" : "Settlement open"}
        >
          <div className="space-y-1.5 rounded-md bg-ivory/60 p-3">
            <Fact label="Disbursed (simulated)" value={formatINR(request.disbursement?.amountPaise ?? request.netPayablePaise)} />
            <Fact label="Settlement amount" value={formatINR(request.settlement?.amountPaise ?? request.approvedAmountPaise)} />
            <Fact label={settled ? "Settled on" : "Due on"} value={settled ? formatDate(request.settlement?.settledAt) : formatDate(request.settlement?.dueDate)} />
          </div>
          {!settled && request.settlement && (
            <MarkSettledButton
              requestId={request.id}
              requestReference={request.reference}
              builderName={request.builder.name}
              amountPaise={request.settlement.amountPaise.toString()}
            />
          )}
        </Panel>
      );
    }
    case "REJECTED":
      return (
        <Panel tone="danger" icon={<XCircle className="size-4" />} eyebrow="Closed" title="Request rejected">
          <div className="space-y-1.5 rounded-md bg-ivory/60 p-3">
            <Fact label="Rejected by" value={decidedBy} />
            <Fact label="Rejected on" value={formatDateTime(request.decidedAt)} />
          </div>
          {request.decisionNote && <p className="rounded-md bg-muted/70 px-3 py-2 text-xs leading-relaxed">{request.decisionNote}</p>}
          <p className="text-xs text-muted-foreground">A rejection is final for this invoice; no further financing request can be raised on it.</p>
        </Panel>
      );
    default:
      return null;
  }
}
