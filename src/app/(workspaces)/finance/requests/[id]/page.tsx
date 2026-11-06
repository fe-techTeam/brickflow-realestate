import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, Download, ExternalLink, FileText, Lock, MessageSquareText, ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { BrokerageParticulars, MatchAttestationSummary } from "@/components/invoice/brokerage-particulars";
import { Button } from "@/components/ui/button";
import type { ApprovalAction, FinancingStatus, SettlementStatus } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps, formatINR } from "@/lib/money";
import { FINANCING_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { getRequestEmpanelment, getRequestParticipants, maskAccountNumber } from "@/server/queries/finance";
import {
  effectiveSettlementStatus,
  getFinancingRequestDetail,
  parseOfferTerms,
  refreshSettlementStatuses,
  type FinancingRequestDetail,
} from "@/server/services/financing";
import { CaseTimeline, EmptyNote, FactList, Masthead, Money, Monogram, Panel, Rule, Seal, StatementRow, type CaseEvent } from "../../_components/ledger";
import { orNotFound } from "../../_lib/records";
import { toDisbursementSummary, toRequestSummary } from "../../_lib/summaries";
import { InternalCommentForm } from "./_components/comment-form";
import { DecisionPanel } from "./_components/decision-panel";

type Params = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Request review · Veefin Finance" };

const DAY_MS = 24 * 60 * 60 * 1000;

const APPROVAL_LABEL: Record<ApprovalAction, { title: string; tone: CaseEvent["tone"] }> = {
  SUBMITTED: { title: "Submitted by channel partner", tone: "default" },
  UNDER_REVIEW: { title: "Review started by builder", tone: "default" },
  CLARIFICATION_REQUESTED: { title: "Clarification requested", tone: "warning" },
  RESUBMITTED: { title: "Resubmitted with clarification", tone: "default" },
  APPROVED: { title: "Approved by builder", tone: "success" },
  REJECTED: { title: "Rejected by builder", tone: "danger" },
};

const EVENT_TONE: Partial<Record<FinancingStatus, CaseEvent["tone"]>> = {
  ACCEPTED_BY_CP: "kota",
  PENDING_APPROVAL: "warning",
  APPROVED: "success",
  DISBURSEMENT_INITIATED: "default",
  DISBURSED: "success",
  REJECTED: "danger",
};

const UPCOMING: Partial<Record<FinancingStatus, string[]>> = {
  PENDING_APPROVAL: ["Credit decision by Veefin", "Payout to channel partner", "Settlement by builder"],
  APPROVED: ["Payout instruction initiated", "Transfer confirmed", "Settlement by builder"],
  DISBURSEMENT_INITIATED: ["Transfer confirmed", "Settlement by builder"],
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CaseFact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 px-5 py-4 sm:px-6", className)}>
      <p className="text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">{label}</p>
      <div className="mt-1.5 truncate text-sm font-medium text-fg">{children}</div>
    </div>
  );
}

function Dossier({
  role,
  caption,
  name,
  href,
  legalName,
  tone,
  facts,
}: {
  role: string;
  caption: string;
  name: string;
  href: string;
  legalName: string;
  tone: "basalt" | "leaf";
  facts: { label: string; value: ReactNode }[];
}) {
  return (
    <article className="animate-fade-up overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_40px_-30px_rgba(8, 14, 24,0.3)]">
      <header className="flex items-center gap-4 border-b border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),#ffffff)] px-6 py-5">
        <Monogram name={name} tone={tone} size="lg" />
        <div className="min-w-0">
          <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-fg-muted uppercase">{role}</p>
          <Link href={href} className="mt-0.5 block font-display text-[1.25rem] text-balance sm:truncate sm:text-[1.375rem] leading-tight font-normal text-fg underline-offset-4 hover:underline">
            {name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{caption}</p>
        </div>
      </header>
      <div className="grid gap-x-10 px-6 pt-2 pb-4 md:grid-cols-2">
        <FactList items={[{ label: "Legal name", value: legalName }, ...facts.slice(0, Math.ceil(facts.length / 2) - 1)]} />
        <FactList items={facts.slice(Math.ceil(facts.length / 2) - 1)} />
      </div>
    </article>
  );
}

function TransferStages({ status, initiatedAt, completedAt }: { status: "INITIATED" | "SUCCESS" | "FAILED"; initiatedAt: Date; completedAt: Date | null }) {
  const stages = [
    { label: "Instruction booked", at: formatDateTime(initiatedAt), state: "done" as const },
    { label: "Submitted on demo rail", at: status === "INITIATED" ? "Processing" : "Cleared", state: status === "INITIATED" ? ("active" as const) : ("done" as const) },
    {
      label: status === "FAILED" ? "Transfer failed" : "Credited · UTR issued",
      at: completedAt ? formatDateTime(completedAt) : "Awaiting confirmation",
      state: status === "SUCCESS" ? ("done" as const) : status === "FAILED" ? ("failed" as const) : ("pending" as const),
    },
  ];
  return (
    <ol className="grid gap-4 sm:grid-cols-3 sm:gap-0">
      {stages.map((stage, i) => (
        <li key={stage.label} className="relative flex gap-3 sm:block">
          {i < stages.length - 1 && (
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-3 left-[2.25rem] hidden h-px w-[calc(100%-2.75rem)] sm:block",
                stage.state === "done" && stages[i + 1]!.state !== "pending" ? "bg-leaf/60" : "bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.14)_0_4px,transparent_4px_8px)]",
              )}
            />
          )}
          <span
            className={cn(
              "relative flex size-6 shrink-0 items-center justify-center rounded-full ring-1",
              stage.state === "done" && "bg-leaf text-white ring-leaf",
              stage.state === "active" && "bg-night text-fg-muted ring-line-strong",
              stage.state === "pending" && "bg-card text-muted-foreground ring-border",
              stage.state === "failed" && "bg-danger text-white ring-danger",
            )}
          >
            {stage.state === "active" && <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-haze/40" />}
            {stage.state === "done" ? <Check className="size-3.5" /> : <span className="tabular text-[0.625rem] font-semibold">{i + 1}</span>}
          </span>
          <div className="min-w-0 sm:mt-3 sm:pr-4">
            <p className={cn("text-[0.8125rem] font-medium", stage.state === "pending" ? "text-muted-foreground" : "text-fg")}>{stage.label}</p>
            <p className={cn("tabular mt-0.5 text-[0.6875rem]", stage.state === "active" ? "font-semibold tracking-[0.14em] text-fg-muted uppercase" : "text-muted-foreground")}>
              {stage.at}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function DisbursementAdvice({ request, nameOf }: { request: FinancingRequestDetail; nameOf: (id: string | null | undefined) => string }) {
  const d = request.disbursement!;
  return (
    <section aria-label="Disbursement" className="relative animate-fade-up overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_40px_-30px_rgba(8, 14, 24,0.3)]">
      <header className="relative flex flex-col gap-3 overflow-hidden bg-night px-6 py-5 text-white sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-haze/70 to-transparent" />
        <div>
          <p className="text-[0.625rem] font-semibold tracking-[0.22em] text-fg-muted uppercase">Payment advice · Disbursement</p>
          <h2 className="mt-1 font-display text-[1.5rem] leading-tight font-normal text-white">Transfer to channel partner</h2>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-[0.625rem] font-semibold tracking-[0.18em] text-white/50 uppercase">Payment reference</p>
          <p className="tabular mt-1 text-sm font-medium tracking-wide text-white">{d.reference}</p>
        </div>
      </header>

      <div className="relative px-6 py-6 sm:px-7">
        <Seal id="bf-seal-advice" className="absolute top-4 right-4 size-[5.5rem] opacity-90 sm:top-5 sm:right-7 sm:size-28" />
        <div className="grid gap-6 pr-24 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-start sm:pr-32">
          <div className="min-w-0">
            <p className="text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Remitter</p>
            <p className="mt-1.5 text-sm font-medium text-fg">{request.financier.name}</p>
            <p className="text-xs text-muted-foreground">Disbursement pool</p>
          </div>
          <ArrowRight className="hidden size-4 self-center text-fg-muted sm:block" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Beneficiary</p>
            <p className="mt-1.5 text-sm font-medium text-fg">{d.beneficiaryName}</p>
            <p className="tabular text-xs text-muted-foreground">
              {d.beneficiaryAccount} · {d.beneficiaryIfsc}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-1 border-y border-dashed border-line-strong/40 py-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">{d.status === "SUCCESS" ? "Amount credited" : "Amount in transfer"}</p>
            <Money paise={d.amountPaise} size="xl" className="mt-2 block text-leaf" />
          </div>
          <div className="flex items-center gap-2 sm:pb-1">
            <StatusBadge kind="disbursement" status={d.status} />
          </div>
        </div>

        <div className="mt-6">
          <TransferStages status={d.status} initiatedAt={d.initiatedAt} completedAt={d.completedAt} />
        </div>

        <div className="mt-6 grid gap-x-8 sm:grid-cols-2">
          <FactList
            items={[
              { label: "UTR", value: <span className="tabular">{d.utr ?? "Pending confirmation"}</span> },
              { label: "Initiated by", value: nameOf(d.initiatedById) },
            ]}
          />
          <FactList
            items={[
              { label: "Completed by", value: d.completedAt ? nameOf(d.completedById) : "—" },
              { label: "Mode", value: "Bank transfer" },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function SettlementCard({ request, status, now, nameOf }: { request: FinancingRequestDetail; status: SettlementStatus; now: Date; nameOf: (id: string | null | undefined) => string }) {
  const s = request.settlement!;
  const settled = status === "SETTLED";
  const start = request.disbursement?.completedAt ?? request.acceptedAt ?? s.dueDate;
  const span = Math.max(1, s.dueDate.getTime() - start.getTime());
  const progress = settled ? 100 : Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / span) * 100));
  const daysToDue = Math.round((s.dueDate.getTime() - now.getTime()) / DAY_MS);
  const dueText = settled
    ? `Settled ${formatDate(s.settledAt)}`
    : daysToDue < 0
      ? `${Math.abs(daysToDue)} day${daysToDue === -1 ? "" : "s"} overdue`
      : daysToDue === 0
        ? "Due today"
        : `${daysToDue} day${daysToDue === 1 ? "" : "s"} to due date`;

  return (
    <Panel
      eyebrow="Builder repayment"
      title="Settlement"
      description={`${request.builder.name} repays the builder-approved amount to ${request.financier.name}`}
    >
      <div className="grid gap-6 border-t border-border/70 pt-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <p className="text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Settlement amount</p>
          <Money paise={s.amountPaise} size="xl" className={cn("mt-2 block", settled ? "text-leaf" : status === "OVERDUE" ? "text-danger" : "text-fg")} />
        </div>
        <div className="sm:text-right">
          <StatusBadge kind="settlement" status={status} />
          <p className="mt-1.5 text-xs text-muted-foreground">Due {formatDate(s.dueDate)}</p>
        </div>
      </div>

      <div className="mt-6">
        <div className="relative h-1.5 rounded-full bg-glass-200" role="presentation">
          <span
            className={cn("absolute inset-y-0 left-0 rounded-full", settled ? "bg-leaf" : status === "OVERDUE" ? "bg-danger" : "bg-gradient-to-r from-night to-haze")}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between gap-3 text-[0.6875rem] text-muted-foreground">
          <span>Disbursed {formatDate(start)}</span>
          <span className={cn("font-medium", status === "OVERDUE" ? "text-danger" : settled ? "text-leaf" : "text-fg")}>{dueText}</span>
          <span>Due {formatDate(s.dueDate)}</span>
        </div>
      </div>

      {settled && (
        <div className="mt-6 grid gap-x-8 sm:grid-cols-2">
          <FactList items={[{ label: "Settlement reference", value: <span className="tabular">{s.reference ?? "—"}</span> }]} />
          <FactList items={[{ label: "Recorded by", value: nameOf(s.settledById) }]} />
        </div>
      )}
      {s.note && <p className="mt-4 border-l-2 border-line-strong/60 pl-3 text-[0.8125rem] leading-relaxed text-fg-soft italic">{s.note}</p>}
    </Panel>
  );
}

export default async function RequestReviewPage({ params }: Params) {
  const actor = await requireWorkspace("finance");
  const { id } = await params;
  const now = new Date();
  await refreshSettlementStatuses(now);
  const request = await orNotFound(getFinancingRequestDetail(actor, id));
  const [names, empanelment] = await Promise.all([getRequestParticipants(actor, request), getRequestEmpanelment(actor, request.cpId, request.builderId)]);

  const terms = parseOfferTerms(request.offer.termsSnapshot);
  const settlementStatus = request.settlement ? effectiveSettlementStatus(request.settlement, now) : null;
  const nameOf = (userId: string | null | undefined) => (userId ? (names.get(userId) ?? "—") : "—");
  const invoice = request.invoice;
  const reduced = request.approvedAmountPaise < request.offer.invoiceAmountPaise;
  const document = invoice.documents[0];
  const builderApproval = [...invoice.approvals].reverse().find((a) => a.action === "APPROVED");
  const accountMasked = maskAccountNumber(request.cp.bankAccountNumber);
  const summary = toRequestSummary(request);
  const disbursementSummary = toDisbursementSummary(request, {
    name: request.cp.legalName,
    bankName: request.cp.bankName,
    accountMasked,
    ifsc: request.cp.bankIfsc ?? "DEMO0000001",
  });

  const events: CaseEvent[] = request.events.map((e) => ({
    id: e.id,
    title: FINANCING_STATUS[e.toStatus].label,
    actor: e.actorName,
    at: formatDateTime(e.createdAt),
    body: e.note ?? undefined,
    tone: EVENT_TONE[e.toStatus] ?? "default",
  }));
  if (request.settlement?.status === "SETTLED") {
    events.push({
      id: `settlement-${request.settlement.id}`,
      title: "Settled by builder",
      actor: nameOf(request.settlement.settledById),
      at: formatDateTime(request.settlement.settledAt),
      body: `Reference ${request.settlement.reference}${request.settlement.note ? ` — ${request.settlement.note}` : ""}`,
      tone: "success",
    });
  }
  const upcoming = request.status === "DISBURSED" && settlementStatus !== "SETTLED" ? ["Settlement by builder"] : (UPCOMING[request.status] ?? []);
  for (const label of upcoming) events.push({ id: `next-${label}`, title: label, at: "Upcoming", tone: "pending" });

  const approvals: CaseEvent[] = invoice.approvals.map((a) => ({
    id: a.id,
    title: APPROVAL_LABEL[a.action].title,
    actor: a.actorName,
    at: formatDateTime(a.createdAt),
    body: a.comment ?? undefined,
    tone: APPROVAL_LABEL[a.action].tone,
  }));

  const comments = request.comments ?? [];

  return (
    <>
      <Masthead
        back={{ href: "/finance/requests", label: "Financing requests" }}
        eyebrow="Case file · Financing request"
        title={<span className="tabular">{request.reference}</span>}
        context={[
          <StatusBadge key="s" kind="financing" status={request.status} />,
          <span key="p" className="inline-flex flex-wrap items-center gap-1.5">
            <Link href={`/finance/partners/${request.cpId}`} className="font-medium text-fg underline-offset-4 hover:underline">
              {request.cp.name}
            </Link>
            <ArrowRight className="size-3.5 text-fg-muted" aria-label="to" />
            <Link href={`/finance/builders/${request.builderId}`} className="font-medium text-fg underline-offset-4 hover:underline">
              {request.builder.name}
            </Link>
          </span>,
          <span key="d" className="text-muted-foreground">
            Requested {formatDateTime(request.createdAt)}
          </span>,
        ]}
        actions={
          document ? (
            <Button asChild variant="outline" className="bg-card">
              <a href={`/api/documents/invoices/${document.id}`} target="_blank" rel="noopener noreferrer">
                <FileText className="size-4" />
                Invoice PDF
              </a>
            </Button>
          ) : undefined
        }
      />

      <div className="mb-8 grid animate-fade-up grid-cols-2 divide-border/70 overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_40px_-32px_rgba(8, 14, 24,0.3)] max-sm:divide-y sm:grid-cols-5 sm:divide-x">
        <CaseFact label="Invoice">
          <span className="tabular">{invoice.invoiceNumber}</span>
        </CaseFact>
        <CaseFact label="Programme">
          <span className="tabular">{terms.programmeCode}</span>
        </CaseFact>
        <CaseFact label="Agreed rate">
          <span className="tabular">{formatBps(request.discountRateBps)}</span>
        </CaseFact>
        <CaseFact label="Builder-approved">
          <Money paise={request.approvedAmountPaise} paiseMode="hide" />
        </CaseFact>
        <CaseFact label="Settlement due" className="max-sm:col-span-2">{formatDate(request.settlement?.dueDate ?? invoice.dueDate)}</CaseFact>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <DecisionPanel request={request} summary={summary} disbursement={disbursementSummary} settlementStatus={settlementStatus} names={names} />
        </div>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Panel
            eyebrow={`Programme ${terms.programmeCode} · ${terms.financier}`}
            title="Financing calculation"
            actions={
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong/15 bg-night/[0.04] px-2.5 py-1 text-[0.625rem] font-semibold tracking-[0.16em] text-fg uppercase">
                <Lock className="size-3" aria-hidden="true" />
                Snapshot locked
              </span>
            }
          >
            <div className="border-t border-border/70 pt-2">
              <StatementRow index="01" label="Invoice amount" hint="Gross, including GST" value={<Money paise={request.offer.invoiceAmountPaise} className="font-normal" />} />
              <StatementRow
                index="02"
                label="Builder-approved amount"
                hint={reduced ? "Builder approved a reduced amount; financing applies to this figure." : "Approved in full by the builder."}
                value={<Money paise={request.approvedAmountPaise} />}
              />
              <StatementRow index="03" label="Agreed discount rate" hint="Fixed rate agreed between Veefin and the builder" value={<span className="tabular text-sm font-medium">{formatBps(request.discountRateBps)}</span>} />
              <StatementRow index="04" label="Discount amount" tone="deduct" value={<Money paise={request.discountAmountPaise} sign="−" />} />
              <StatementRow index="05" label="Other charges" hint="No processing fees under this programme" value={<Money paise={request.chargesPaise} className="font-normal" />} />
            </div>

            <div className="relative mt-5 overflow-hidden rounded-xl bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.07))] px-6 py-6 ring-1 ring-line-strong/30 sm:px-7">
              <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-haze/0 via-haze to-haze/0" />
              <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[0.625rem] font-semibold tracking-[0.22em] text-fg-muted uppercase">Net payable to channel partner</p>
                  <Money paise={request.netPayablePaise} size="hero" className="mt-3 block text-leaf" />
                </div>
                <div className="tabular text-xs leading-relaxed text-muted-foreground sm:text-right">
                  <p>
                    {formatINR(request.approvedAmountPaise)} − {formatINR(request.discountAmountPaise)}
                    {request.chargesPaise > 0n ? ` − ${formatINR(request.chargesPaise)}` : ""}
                  </p>
                  <p className="mt-0.5">
                    Builder settles <span className="font-medium text-fg">{formatINR(request.approvedAmountPaise)}</span> on {formatDate(invoice.dueDate)}
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-5 flex gap-3 text-xs leading-relaxed text-fg-soft">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-leaf" aria-hidden="true" />
              <span>
                These figures are the snapshot accepted by the channel partner on {formatDateTime(request.acceptedAt)}. Later changes to the programme rate do not affect this
                request. The builder settles {formatINR(request.approvedAmountPaise)} with Veefin on the invoice due date.
              </span>
            </p>
          </Panel>

          {request.disbursement && <DisbursementAdvice request={request} nameOf={nameOf} />}

          {request.settlement && settlementStatus && <SettlementCard request={request} status={settlementStatus} now={now} nameOf={nameOf} />}

          <Panel
            eyebrow={`${invoice.reference} · ${invoice.project.name}`}
            title="Invoice"
            actions={
              document ? (
                <>
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/documents/invoices/${document.id}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-3.5" />
                      View PDF
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/documents/invoices/${document.id}?download=1`}>
                      <Download className="size-3.5" />
                      Download
                    </a>
                  </Button>
                </>
              ) : undefined
            }
          >
            <div className="grid gap-x-8 border-t border-border/70 pt-1 sm:grid-cols-2">
              <FactList
                items={[
                  { label: "Invoice number", value: <span className="tabular">{invoice.invoiceNumber}</span> },
                  { label: "Invoice date", value: formatDate(invoice.invoiceDate) },
                  { label: "Due date", value: invoice.dueDate ? formatDate(invoice.dueDate) : "Not stated" },
                  { label: "Invoice status", value: <StatusBadge kind="invoice" status={invoice.status} /> },
                ]}
              />
              <FactList
                items={[
                  { label: "Invoice amount", value: <Money paise={invoice.amountPaise} /> },
                  { label: "GST component", value: invoice.gstAmountPaise !== null ? <Money paise={invoice.gstAmountPaise} /> : "—" },
                  { label: "Builder-approved", value: invoice.approvedAmountPaise !== null ? <Money paise={invoice.approvedAmountPaise} /> : "—" },
                  { label: "Project RERA", value: <span className="tabular text-xs">{invoice.project.reraNumber ?? "—"}</span> },
                ]}
              />
            </div>
            {invoice.description && (
              <p className="mt-5 rounded-lg bg-glass/60 px-4 py-3 text-[0.8125rem] leading-relaxed text-fg-soft">
                <span className="mr-2 text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Description</span>
                {invoice.description}
              </p>
            )}
            {invoice.documents.length > 0 && (
              <ul className="mt-5 space-y-2">
                {invoice.documents.map((doc) => (
                  <li key={doc.id} className="flex flex-col gap-3 rounded-lg border border-border/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-11 w-9 shrink-0 items-center justify-center rounded-[4px] border border-border bg-glass text-[0.5625rem] font-bold tracking-wider text-danger">
                        PDF
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">{doc.fileName}</p>
                        <p className="truncate text-[0.6875rem] text-muted-foreground">
                          {formatBytes(doc.sizeBytes)} · uploaded {formatDateTime(doc.createdAt)} · SHA-256 <span className="tabular">{doc.sha256.slice(0, 12)}…</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button asChild size="sm" variant="ghost">
                        <a href={`/api/documents/invoices/${doc.id}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${doc.fileName}`}>
                          View
                        </a>
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <a href={`/api/documents/invoices/${doc.id}?download=1`} aria-label={`Download ${doc.fileName}`}>
                          Download
                        </a>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Rule label="Builder approval history" className="mt-7 mb-5" />
            <CaseTimeline events={approvals} />
            {builderApproval && (
              <MatchAttestationSummary
                attestation={builderApproval.attestation}
                attestedByName={builderApproval.attestedByName}
                attestedAt={builderApproval.attestedAt}
                className="mt-6"
              />
            )}
          </Panel>

          <Panel eyebrow="Booking, agreement & tax" title="Brokerage particulars" description="As stated on the invoice, with the platform's arithmetic checks">
            <BrokerageParticulars invoice={invoice} />
          </Panel>

          <div className="grid gap-6">
            <Dossier
              role="Channel partner · Beneficiary"
              caption="Receives the early payment"
              name={request.cp.name}
              href={`/finance/partners/${request.cpId}`}
              legalName={request.cp.legalName}
              tone="basalt"
              facts={[
                { label: "GSTIN", value: <span className="tabular">{request.cp.gstin ?? "—"}</span> },
                { label: "PAN", value: <span className="tabular">{request.cp.pan ?? "—"}</span> },
                { label: "RERA", value: <span className="text-xs">{request.cp.reraNumber ?? "—"}</span> },
                {
                  label: "Contact",
                  value: (
                    <>
                      {request.cp.contactName ?? "—"}
                      <span className="block text-xs text-muted-foreground">{[request.cp.contactEmail, request.cp.contactPhone].filter(Boolean).join(" · ")}</span>
                    </>
                  ),
                },
                {
                  label: "Payout account",
                  value: (
                    <>
                      <span className="tabular">{accountMasked}</span>
                      <span className="block text-xs text-muted-foreground">
                        {request.cp.bankName ?? "—"} · {request.cp.bankIfsc ?? "—"}
                      </span>
                    </>
                  ),
                },
                { label: "Empanelment", value: empanelment ? `${empanelment.empanelmentCode} · ${empanelment.creditPeriodDays}-day credit` : "—" },
              ]}
            />
            <Dossier
              role="Builder · Obligor"
              caption="Settles with Veefin on the due date"
              name={request.builder.name}
              href={`/finance/builders/${request.builderId}`}
              legalName={request.builder.legalName}
              tone="leaf"
              facts={[
                { label: "GSTIN", value: <span className="tabular">{request.builder.gstin ?? "—"}</span> },
                { label: "PAN", value: <span className="tabular">{request.builder.pan ?? "—"}</span> },
                { label: "RERA", value: <span className="text-xs">{request.builder.reraNumber ?? "—"}</span> },
                {
                  label: "Contact",
                  value: (
                    <>
                      {request.builder.contactName ?? "—"}
                      <span className="block text-xs text-muted-foreground">
                        {[request.builder.contactEmail, request.builder.contactPhone].filter(Boolean).join(" · ")}
                      </span>
                    </>
                  ),
                },
                {
                  label: "Registered address",
                  value: [request.builder.addressLine, request.builder.city, request.builder.state, request.builder.pincode].filter(Boolean).join(", ") || "—",
                },
              ]}
            />
          </div>

          <Panel eyebrow="What the channel partner agreed to" title="Offer and consent" actions={<StatusBadge kind="offer" status={request.offer.status} />}>
            <div className="grid gap-x-8 border-t border-border/70 pt-1 sm:grid-cols-2">
              <FactList
                items={[
                  { label: "Offer reference", value: <span className="tabular">{request.offer.reference}</span> },
                  { label: "Generated", value: formatDateTime(request.offer.generatedAt) },
                ]}
              />
              <FactList
                items={[
                  { label: "Valid until", value: formatDateTime(request.offer.validUntil) },
                  { label: "Accepted", value: formatDateTime(request.offer.acceptedAt ?? request.acceptedAt) },
                ]}
              />
            </div>

            <figure className="relative mt-6 rounded-xl bg-glass/60 px-6 pt-8 pb-6 sm:px-8">
              <span aria-hidden="true" className="absolute top-1 left-5 font-display text-[4.5rem] leading-none text-fg-muted/50">
                “
              </span>
              <blockquote className="font-display text-[1.1875rem] leading-relaxed text-fg italic">{request.offer.consentText ?? "No consent text recorded."}</blockquote>
              <figcaption className="mt-5 flex flex-wrap items-end justify-between gap-3 border-t border-line-strong/30 pt-3">
                <span>
                  <span className="block text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Accepted by</span>
                  <span className="mt-0.5 block text-sm font-medium text-fg">
                    {nameOf(request.offer.acceptedById ?? request.acceptedById)} · {request.cp.name}
                  </span>
                </span>
                <span className="tabular text-xs text-muted-foreground">{formatDateTime(request.offer.acceptedAt ?? request.acceptedAt)}</span>
              </figcaption>
            </figure>

            <div className="mt-6 rounded-xl border border-border/80 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-fg-muted uppercase">Programme terms snapshot</p>
                <p className="tabular text-xs text-muted-foreground">
                  {terms.programmeCode} · {formatBps(terms.discountRateBps)} · {terms.offerValidityDays}-day offer validity
                </p>
              </div>
              <p className="mt-3 font-display text-lg leading-snug font-normal text-fg">{terms.programmeName}</p>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-soft">{terms.terms}</p>
            </div>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-6 lg:col-start-2 lg:row-start-2 lg:self-start">
          <Panel eyebrow="Lifecycle" title="Case history" description="Every status change on this request, and what comes next">
            <div className="border-t border-border/70 pt-5">
              <CaseTimeline events={events} />
            </div>
          </Panel>

          <section aria-label="Internal annotations" className="animate-fade-up overflow-hidden rounded-xl border border-line-strong/30 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.05))]">
            <header className="flex items-start justify-between gap-3 px-6 pt-6 pb-4">
              <div>
                <p className="flex items-center gap-1.5 text-[0.625rem] font-semibold tracking-[0.2em] text-fg-muted uppercase">
                  <Lock className="size-3" aria-hidden="true" />
                  Private to Veefin
                </p>
                <h2 className="mt-1 font-display text-[1.5rem] leading-tight font-normal">Internal annotations</h2>
                <p className="mt-1 text-[0.8125rem] text-muted-foreground">Not visible to the channel partner or the builder.</p>
              </div>
              <span className="tabular rounded-full bg-card px-2 py-0.5 text-[0.6875rem] font-semibold text-fg ring-1 ring-line-strong/30">{comments.length}</span>
            </header>
            <div className="px-6 pb-6">
              <InternalCommentForm requestId={request.id} />
              {comments.length > 0 ? (
                <ul className="mt-6 space-y-4">
                  {comments.map((c) => (
                    <li key={c.id} className="relative rounded-lg bg-card px-4 py-4 shadow-[0_10px_24px_-20px_rgba(8, 14, 24,0.5)] ring-1 ring-border">
                      <span aria-hidden="true" className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-haze" />
                      <div className="flex items-center gap-2.5">
                        <Monogram name={c.authorName} size="sm" tone="paper" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-fg">{c.authorName}</p>
                          <p className="tabular text-[0.6875rem] text-muted-foreground">{formatDateTime(c.createdAt)}</p>
                        </div>
                      </div>
                      <p className="mt-3 text-[0.875rem] leading-relaxed whitespace-pre-line text-fg-soft">{c.body}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyNote icon={MessageSquareText} title="No annotations yet" description="Notes added here are shared only within Veefin." compact />
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
