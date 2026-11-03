import Link from "next/link";
import { ArrowRight, BadgeCheck, Banknote, Check, CircleDot, HandCoins, Hourglass, Landmark, Send, ShieldCheck, X, XCircle, type LucideIcon } from "lucide-react";
import { DemoBadge, StatusBadge } from "@/components/common/status-badge";
import type { FinancingStatus } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps } from "@/lib/money";
import { FINANCING_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { effectiveSettlementStatus } from "@/server/services/financing";
import type { InvoiceDetail } from "@/server/services/invoices";
import { Chronicle, type ChronicleTone } from "../../../_components/chronicle";
import { Callout, Empty, Fact, LedgerLine, Panel } from "../../../_components/kit";
import { Money } from "../../../_components/money";
import { formatDueIn } from "../../../_lib/dates";

const EVENT: Partial<Record<FinancingStatus, { icon: LucideIcon; tone: ChronicleTone }>> = {
  ACCEPTED_BY_CP: { icon: Send, tone: "kota" },
  PENDING_APPROVAL: { icon: Hourglass, tone: "amber" },
  APPROVED: { icon: ShieldCheck, tone: "leaf" },
  DISBURSEMENT_INITIATED: { icon: Banknote, tone: "basalt" },
  DISBURSED: { icon: BadgeCheck, tone: "leaf" },
  REJECTED: { icon: XCircle, tone: "rose" },
};

type StepState = "done" | "current" | "upcoming" | "failed";

interface Step {
  label: string;
  detail: string;
  state: StepState;
}

function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid gap-4 sm:grid-cols-4 sm:gap-0">
      {steps.map((step, i) => (
        <li key={step.label} className="relative flex gap-3 sm:flex-col sm:items-center sm:gap-2.5 sm:px-2 sm:text-center">
          {i > 0 && (
            <span
              aria-hidden="true"
              className={cn("absolute top-[0.8125rem] right-1/2 hidden h-px w-full sm:block", step.state === "upcoming" ? "bg-[rgba(255,255,255,0.1)]" : "bg-leaf/50")}
            />
          )}
          <span
            className={cn(
              "relative z-10 flex size-[1.625rem] shrink-0 items-center justify-center rounded-full ring-4 ring-card",
              step.state === "done" && "bg-leaf text-white",
              step.state === "current" && "bg-glass-100 text-fg-muted ring-[rgba(255,255,255,0.05)] outline-1 outline-line-strong/60",
              step.state === "upcoming" && "border border-dashed border-[#c3cdd8] bg-card text-muted-foreground",
              step.state === "failed" && "bg-[#ff7b6e] text-white",
            )}
          >
            {step.state === "done" ? (
              <Check className="size-3.5" strokeWidth={2.5} />
            ) : step.state === "failed" ? (
              <X className="size-3.5" strokeWidth={2.5} />
            ) : (
              <span className="tabular text-[0.6875rem] font-semibold">{i + 1}</span>
            )}
          </span>
          <div className="min-w-0">
            <p className={cn("text-[0.8125rem] font-medium", step.state === "upcoming" ? "text-muted-foreground" : "text-fg")}>{step.label}</p>
            <p className="mt-0.5 text-[0.6875rem] leading-snug text-muted-foreground">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Read-only view of early payment on an accepted invoice, from the builder's perspective. */
export function FinancingPanel({ invoice, originalDueDate, creditPeriodDays }: { invoice: InvoiceDetail; originalDueDate: Date; creditPeriodDays: number | null }) {
  const request = invoice.financingRequest;
  const terms = (
    <Callout icon={ShieldCheck} title="Your credit terms are unchanged">
      The original due date of {formatDate(originalDueDate)}
      {creditPeriodDays ? ` and the ${creditPeriodDays}-day credit period agreed with ${invoice.cp.name}` : ""} stay exactly as they are. Early payment only changes{" "}
      <em>who</em> you pay on that date{request && request.status !== "REJECTED" ? " — Veefin instead of the channel partner" : ""}. The discount is borne by the channel
      partner.
    </Callout>
  );

  if (!request) {
    return (
      <Panel eyebrow="Early payment" title="Financing visibility" description="Early payment by Veefin against this approved invoice">
        <Empty
          icon={HandCoins}
          title="No early payment requested"
          description={
            invoice.financingStatus === "OFFER_GENERATED"
              ? `${invoice.cp.name} has viewed an early-payment offer on this invoice but has not accepted it.`
              : `${invoice.cp.name} has not requested early payment on this invoice. If they do, Veefin pays them early and you pay Veefin the approved amount on the original due date.`
          }
          className="pt-4 pb-10"
        />
        {terms}
      </Panel>
    );
  }

  const settlement = request.settlement;
  const settlementStatus = settlement ? effectiveSettlementStatus(settlement) : null;
  const disbursement = request.disbursement;
  const rejected = request.status === "REJECTED";
  const disbursed = request.status === "DISBURSED";

  const steps: Step[] = [
    { label: "Requested by partner", detail: formatDate(request.acceptedAt), state: "done" },
    rejected
      ? { label: "Declined by Veefin", detail: formatDate(request.decidedAt), state: "failed" }
      : request.status === "PENDING_APPROVAL"
        ? { label: "Veefin credit approval", detail: "Under review", state: "current" }
        : { label: "Approved by Veefin", detail: formatDate(request.decidedAt), state: "done" },
    disbursed
      ? { label: "Paid to partner", detail: formatDate(disbursement?.completedAt ?? disbursement?.initiatedAt), state: "done" }
      : { label: "Paid to partner", detail: request.status === "DISBURSEMENT_INITIATED" ? "In progress" : rejected ? "Not applicable" : "After approval", state: request.status === "APPROVED" || request.status === "DISBURSEMENT_INITIATED" ? "current" : "upcoming" },
    settlementStatus === "SETTLED"
      ? { label: "Settled with Veefin", detail: formatDate(settlement?.settledAt), state: "done" }
      : { label: "Settled with Veefin", detail: rejected ? "No settlement" : `Due ${formatDate(settlement?.dueDate ?? originalDueDate)}`, state: settlement ? "current" : "upcoming" },
  ];

  return (
    <Panel
      eyebrow={`Early payment · ${request.financier.name}`}
      title="Financing visibility"
      description={
        <>
          Request <span className="font-mono text-[0.75rem]">{request.reference}</span> · programme {request.programme.code}
        </>
      }
      actions={<StatusBadge kind="financing" status={request.status} />}
    >
      <div className="rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.04)] px-4 py-5 sm:px-3">
        <Stepper steps={steps} />
      </div>

      <div className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-8">
        <div>
          <p className="mb-1 text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Early-payment statement</p>
          <div className="divide-y divide-[rgba(255,255,255,0.07)]">
            <LedgerLine label="Original invoice amount" hint="As submitted, incl. GST" value={<Money paise={invoice.amountPaise} />} tone="muted" />
            <LedgerLine label="Approved amount" hint="Approved by you; basis for the discount" value={<Money paise={request.approvedAmountPaise} />} />
            <LedgerLine label="Financing rate" hint="Fixed by programme" value={<span className="tabular font-sans">{formatBps(request.discountRateBps)}</span>} />
            <LedgerLine label="Discount" hint="Borne by the channel partner" value={<Money paise={request.discountAmountPaise} sign="minus" />} tone="deduct" />
            {request.chargesPaise > 0n && <LedgerLine label="Charges" value={<Money paise={request.chargesPaise} sign="minus" />} tone="deduct" />}
            <LedgerLine
              label="Net paid to channel partner"
              hint={`Paid by Veefin to ${invoice.cp.name}`}
              value={<Money paise={request.netPayablePaise} size="xl" className="font-medium" />}
              tone="total"
            />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-night p-5 text-white shadow-[0_18px_36px_-24px_rgba(10, 16, 26,0.8)] sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 whitespace-nowrap text-[0.625rem] font-semibold tracking-[0.18em] text-fg-muted uppercase">
                <Landmark className="size-3.5" />
                Settlement with Veefin
              </p>
              {settlementStatus && <StatusBadge kind="settlement" status={settlementStatus} />}
            </div>
            {settlement && settlementStatus ? (
              <>
                <Money paise={settlement.amountPaise} size="xl" className="mt-4 font-light text-white" />
                <p className="mt-2 text-[0.75rem] text-white/60">
                  {settlementStatus === "SETTLED" ? (
                    <>
                      Settled {formatDate(settlement.settledAt)}
                      {settlement.reference && <span className="font-mono"> · {settlement.reference}</span>}
                    </>
                  ) : (
                    <>
                      Due {formatDate(settlement.dueDate)} · <span className="text-fg-muted">{formatDueIn(settlement.dueDate)}</span>
                    </>
                  )}
                </p>
                {settlementStatus !== "SETTLED" && <p className="mt-3 border-t border-white/10 pt-3 text-[0.75rem] text-white/55">Recorded by Veefin once your payment is received.</p>}
              </>
            ) : rejected ? (
              <p className="mt-4 text-[0.8125rem] leading-relaxed text-white/75">No settlement arises: Veefin declined this request. Pay {invoice.cp.name} directly on your normal terms.</p>
            ) : (
              <>
                <Money paise={request.approvedAmountPaise} size="xl" className="mt-4 font-light text-white" />
                <p className="mt-2 text-[0.75rem] leading-relaxed text-white/60">
                  Will be scheduled for {formatDate(originalDueDate)} once Veefin completes the {request.status === "PENDING_APPROVAL" ? "approval and " : ""}disbursement.
                </p>
              </>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-[rgba(255,255,255,0.07)] px-5 py-4">
            <Fact label="Disbursement reference" className="col-span-2">
              {disbursement ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[0.8125rem]">{disbursement.reference}</span>
                  <DemoBadge />
                </span>
              ) : (
                <span className="text-muted-foreground">{rejected ? "Not applicable" : "Not yet disbursed"}</span>
              )}
            </Fact>
            <Fact label="UTR">{disbursement?.utr ? <span className="font-mono text-[0.8125rem]">{disbursement.utr}</span> : <span className="text-muted-foreground">—</span>}</Fact>
            <Fact label="Veefin decision">{request.decidedAt ? formatDateTime(request.decidedAt) : <span className="text-muted-foreground">Pending</span>}</Fact>
          </dl>
        </div>
      </div>

      {request.decisionNote && rejected && (
        <Callout icon={XCircle} tone="rose" title="Veefin's reason" className="mt-6">
          {request.decisionNote}
        </Callout>
      )}

      <div className="mt-6">{terms}</div>

      {request.events.length > 0 && (
        <details className="group mt-7 border-t border-[rgba(255,255,255,0.07)] pt-5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase select-none hover:text-fg">
            Financing history · {request.events.length} {request.events.length === 1 ? "event" : "events"}
            <ArrowRight className="size-3.5 transition-transform group-open:rotate-90" />
          </summary>
          <Chronicle
            className="mt-5"
            entries={request.events.map((e) => {
              const style = EVENT[e.toStatus] ?? { icon: CircleDot, tone: "muted" as const };
              return {
                id: e.id,
                icon: style.icon,
                tone: style.tone,
                title: FINANCING_STATUS[e.toStatus].label,
                when: formatDateTime(e.createdAt),
                meta: e.actorName,
                body: e.note ?? undefined,
              };
            })}
          />
        </details>
      )}
      <p className="mt-6 text-[0.75rem] text-muted-foreground">
        Settlement position across all invoices is on the{" "}
        <Link href="/builder/settlements" className="text-fg decoration-fg-muted/60 underline-offset-4 hover:underline">
          Settlements
        </Link>{" "}
        page.
      </p>
    </Panel>
  );
}
