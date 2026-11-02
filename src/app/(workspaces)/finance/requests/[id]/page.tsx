import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Download, ExternalLink, FileText, Lock, MessageSquareText, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { AmountRow, DetailList, EmptyState, Section, Timeline, type TimelineEntry } from "@/components/common/panels";
import { StatusBadge, ToneBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import type { ApprovalAction, FinancingStatus } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps, formatINR } from "@/lib/money";
import { FINANCING_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { getRequestEmpanelment, getRequestParticipants, maskAccountNumber } from "@/server/queries/finance";
import { effectiveSettlementStatus, getFinancingRequestDetail, parseOfferTerms, refreshSettlementStatuses } from "@/server/services/financing";
import { orNotFound } from "../../_lib/records";
import { toDisbursementSummary, toRequestSummary } from "../../_lib/summaries";
import { MarkSettledButton } from "../../_components/request-actions";
import { InternalCommentForm } from "./_components/comment-form";
import { DecisionPanel } from "./_components/decision-panel";

type Params = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Request review · Veefin Finance" };

const APPROVAL_LABEL: Record<ApprovalAction, { title: string; tone: TimelineEntry["tone"] }> = {
  SUBMITTED: { title: "Submitted by channel partner", tone: "default" },
  UNDER_REVIEW: { title: "Review started by builder", tone: "default" },
  CLARIFICATION_REQUESTED: { title: "Clarification requested", tone: "warning" },
  RESUBMITTED: { title: "Resubmitted with clarification", tone: "default" },
  APPROVED: { title: "Approved by builder", tone: "success" },
  REJECTED: { title: "Rejected by builder", tone: "danger" },
};

const EVENT_TONE: Partial<Record<FinancingStatus, TimelineEntry["tone"]>> = {
  ACCEPTED_BY_CP: "gold",
  PENDING_APPROVAL: "warning",
  APPROVED: "success",
  DISBURSEMENT_INITIATED: "default",
  DISBURSED: "success",
  REJECTED: "danger",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Address({ parts }: { parts: (string | null)[] }) {
  const text = parts.filter(Boolean).join(", ");
  return <>{text || "—"}</>;
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
  const accountMasked = maskAccountNumber(request.cp.bankAccountNumber);
  const summary = toRequestSummary(request);
  const disbursementSummary = toDisbursementSummary(request, {
    name: request.cp.legalName,
    bankName: request.cp.bankName,
    accountMasked,
    ifsc: request.cp.bankIfsc ?? "DEMO0000001",
  });

  const events: TimelineEntry[] = request.events.map((e) => ({
    id: e.id,
    title: FINANCING_STATUS[e.toStatus].label,
    meta: `${e.actorName} · ${formatDateTime(e.createdAt)}`,
    body: e.note ?? undefined,
    tone: EVENT_TONE[e.toStatus] ?? "default",
  }));
  if (request.settlement?.status === "SETTLED") {
    events.push({
      id: `settlement-${request.settlement.id}`,
      title: "Settled by builder",
      meta: `${nameOf(request.settlement.settledById)} · ${formatDateTime(request.settlement.settledAt)}`,
      body: `Reference ${request.settlement.reference}${request.settlement.note ? ` — ${request.settlement.note}` : ""}`,
      tone: "success",
    });
  }

  const approvals: TimelineEntry[] = invoice.approvals.map((a) => ({
    id: a.id,
    title: APPROVAL_LABEL[a.action].title,
    meta: `${a.actorName} · ${formatDateTime(a.createdAt)}`,
    body: a.comment ?? undefined,
    tone: APPROVAL_LABEL[a.action].tone,
  }));

  return (
    <>
      <PageHeader
        back={{ href: "/finance/requests", label: "Financing requests" }}
        eyebrow="Financing request · Case file"
        title={<span className="tabular">{request.reference}</span>}
        description={
          <span className="flex flex-col gap-3">
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge kind="financing" status={request.status} />
              {settlementStatus && <StatusBadge kind="settlement" status={settlementStatus} />}
              {request.disbursement && <StatusBadge kind="disbursement" status={request.disbursement.status} />}
            </span>
            <span className="flex flex-wrap items-center gap-1.5 text-sm">
              <Link href={`/finance/partners/${request.cpId}`} className="font-medium text-navy hover:underline">
                {request.cp.name}
              </Link>
              <ArrowRight className="size-3.5 text-gold-600" aria-label="to" />
              <Link href={`/finance/builders/${request.builderId}`} className="font-medium text-navy hover:underline">
                {request.builder.name}
              </Link>
              <span className="text-muted-foreground">· requested {formatDateTime(request.createdAt)}</span>
            </span>
          </span>
        }
        actions={
          document ? (
            <Button asChild variant="outline">
              <a href={`/api/documents/invoices/${document.id}`} target="_blank" rel="noopener noreferrer">
                <FileText className="size-4" />
                Invoice PDF
              </a>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <DecisionPanel request={request} summary={summary} disbursement={disbursementSummary} settlementStatus={settlementStatus} names={names} />
        </div>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Section
            title="Financing calculation"
            description={`Programme ${terms.programmeCode} · ${terms.financier}`}
            actions={<ToneBadge meta={{ label: "Accepted snapshot", tone: "navy" }} />}
          >
            <div className="divide-y divide-border/60">
              <AmountRow label="Invoice amount" hint="Gross, including GST" value={formatINR(request.offer.invoiceAmountPaise)} />
              <AmountRow
                label="Builder-approved amount"
                hint={reduced ? "Builder approved a reduced amount; financing applies to this figure" : "Approved in full by the builder"}
                value={formatINR(request.approvedAmountPaise)}
              />
              <AmountRow label="Agreed discount" hint="Fixed rate agreed between Veefin and the builder" value={formatBps(request.discountRateBps)} />
              <AmountRow label="Discount amount" tone="deduct" value={`− ${formatINR(request.discountAmountPaise)}`} />
              <AmountRow label="Other charges" hint="No processing fees under this programme" value={formatINR(request.chargesPaise)} />
              <AmountRow label="Net payable to CP" tone="total" value={formatINR(request.netPayablePaise)} />
            </div>
            <p className="mt-4 rounded-md bg-ivory/70 px-4 py-3 text-xs leading-relaxed text-slate-ink">
              <ShieldCheck className="mr-1.5 inline size-3.5 -translate-y-px text-heritage" aria-hidden="true" />
              These figures are the snapshot accepted by the channel partner on {formatDateTime(request.acceptedAt)}. Later changes to the programme rate do not
              affect this request. The builder settles {formatINR(request.approvedAmountPaise)} with Veefin on the invoice due date.
            </p>
          </Section>

          {request.disbursement && (
            <Section
              title="Disbursement"
              description="Payout of the net amount to the channel partner"
              actions={<ToneBadge meta={{ label: "DEMO / SIMULATED", tone: "gold" }} />}
            >
              <DetailList
                columns={3}
                items={[
                  { label: "Payment reference", value: <span className="tabular">{request.disbursement.reference}</span> },
                  { label: "UTR", value: <span className="tabular">{request.disbursement.utr ?? "Pending confirmation"}</span> },
                  { label: "Status", value: <StatusBadge kind="disbursement" status={request.disbursement.status} /> },
                  { label: "Amount", value: <span className="tabular font-medium text-heritage">{formatINR(request.disbursement.amountPaise)}</span> },
                  { label: "Beneficiary", value: request.disbursement.beneficiaryName },
                  {
                    label: "Account",
                    value: (
                      <span className="tabular">
                        {request.disbursement.beneficiaryAccount} · {request.disbursement.beneficiaryIfsc}
                      </span>
                    ),
                  },
                  { label: "Initiated", value: `${formatDateTime(request.disbursement.initiatedAt)} · ${nameOf(request.disbursement.initiatedById)}` },
                  {
                    label: "Completed",
                    value: request.disbursement.completedAt
                      ? `${formatDateTime(request.disbursement.completedAt)} · ${nameOf(request.disbursement.completedById)}`
                      : "Awaiting confirmation",
                  },
                  { label: "Mode", value: "Demo rail — no real funds moved" },
                ]}
              />
            </Section>
          )}

          {request.settlement && settlementStatus && (
            <Section
              title="Builder settlement"
              description={`${request.builder.name} repays the builder-approved amount to Veefin`}
              actions={
                settlementStatus !== "SETTLED" ? (
                  <MarkSettledButton
                    requestId={request.id}
                    requestReference={request.reference}
                    builderName={request.builder.name}
                    amountPaise={request.settlement.amountPaise.toString()}
                    size="sm"
                  />
                ) : (
                  <StatusBadge kind="settlement" status="SETTLED" />
                )
              }
            >
              <DetailList
                columns={3}
                items={[
                  { label: "Settlement amount", value: formatINR(request.settlement.amountPaise), emphasis: true },
                  { label: "Due date", value: formatDate(request.settlement.dueDate) },
                  { label: "Status", value: <StatusBadge kind="settlement" status={settlementStatus} /> },
                  { label: "Settled on", value: formatDateTime(request.settlement.settledAt) },
                  { label: "Settlement reference", value: <span className="tabular">{request.settlement.reference ?? "—"}</span> },
                  { label: "Recorded by", value: nameOf(request.settlement.settledById) },
                ]}
              />
              {request.settlement.note && <p className="mt-4 rounded-md bg-muted/70 px-3 py-2 text-sm text-slate-ink">{request.settlement.note}</p>}
            </Section>
          )}
          <Section
            title="Invoice"
            description={`${invoice.reference} · ${invoice.project.name}`}
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
            <DetailList
              columns={3}
              items={[
                { label: "Invoice number", value: <span className="tabular">{invoice.invoiceNumber}</span> },
                { label: "Invoice date", value: formatDate(invoice.invoiceDate) },
                { label: "Due date", value: invoice.dueDate ? formatDate(invoice.dueDate) : "Not stated" },
                { label: "Invoice amount", value: <span className="tabular">{formatINR(invoice.amountPaise)}</span> },
                { label: "GST component", value: <span className="tabular">{invoice.gstAmountPaise !== null ? formatINR(invoice.gstAmountPaise) : "—"}</span> },
                { label: "Builder-approved", value: <span className="tabular">{invoice.approvedAmountPaise !== null ? formatINR(invoice.approvedAmountPaise) : "—"}</span> },
                { label: "Project", value: `${invoice.project.name} · ${invoice.project.city}` },
                { label: "Project RERA", value: invoice.project.reraNumber ?? "—" },
                { label: "Invoice status", value: <StatusBadge kind="invoice" status={invoice.status} /> },
              ]}
            />
            {invoice.description && (
              <div className="mt-5">
                <p className="eyebrow mb-1">Description</p>
                <p className="text-sm leading-relaxed text-slate-ink">{invoice.description}</p>
              </div>
            )}
            {invoice.documents.length > 0 && (
              <ul className="mt-5 divide-y divide-border/70 rounded-md border border-border">
                {invoice.documents.map((doc) => (
                  <li key={doc.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-navy/[0.06] text-navy">
                        <FileText className="size-4" strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-navy">{doc.fileName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(doc.sizeBytes)} · uploaded {formatDateTime(doc.createdAt)} · SHA-256 {doc.sha256.slice(0, 12)}…
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
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
            <div className="mt-6">
              <p className="eyebrow mb-4">Builder approval history</p>
              <Timeline entries={approvals} />
            </div>
          </Section>

          <div className="grid gap-6 xl:grid-cols-2">
            <Section title="Channel partner" description="Beneficiary of the early payment">
              <DetailList
                columns={1}
                items={[
                  { label: "Legal name", value: request.cp.legalName },
                  { label: "GSTIN", value: <span className="tabular">{request.cp.gstin ?? "—"}</span> },
                  { label: "PAN", value: <span className="tabular">{request.cp.pan ?? "—"}</span> },
                  { label: "RERA registration", value: request.cp.reraNumber ?? "—" },
                  {
                    label: "Contact",
                    value: (
                      <>
                        {request.cp.contactName ?? "—"}
                        <span className="block text-xs text-muted-foreground">
                          {[request.cp.contactEmail, request.cp.contactPhone].filter(Boolean).join(" · ")}
                        </span>
                      </>
                    ),
                  },
                  {
                    label: "Bank account",
                    value: (
                      <>
                        <span className="tabular">{accountMasked}</span>
                        <span className="block text-xs text-muted-foreground">
                          {request.cp.bankName ?? "—"} · IFSC {request.cp.bankIfsc ?? "—"}
                        </span>
                      </>
                    ),
                  },
                  {
                    label: "Empanelment",
                    value: empanelment ? `${empanelment.empanelmentCode} · ${empanelment.creditPeriodDays}-day credit period` : "—",
                  },
                ]}
              />
            </Section>
            <Section title="Builder" description="Obligor for settlement on the due date">
              <DetailList
                columns={1}
                items={[
                  { label: "Legal name", value: request.builder.legalName },
                  { label: "GSTIN", value: <span className="tabular">{request.builder.gstin ?? "—"}</span> },
                  { label: "PAN", value: <span className="tabular">{request.builder.pan ?? "—"}</span> },
                  { label: "RERA registration", value: request.builder.reraNumber ?? "—" },
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
                    value: <Address parts={[request.builder.addressLine, request.builder.city, request.builder.state, request.builder.pincode]} />,
                  },
                ]}
              />
            </Section>
          </div>

          <Section title="Offer and consent" description="What the channel partner saw and agreed to">
            <DetailList
              columns={3}
              items={[
                { label: "Offer reference", value: <span className="tabular">{request.offer.reference}</span> },
                { label: "Offer status", value: <StatusBadge kind="offer" status={request.offer.status} /> },
                { label: "Valid until", value: formatDateTime(request.offer.validUntil) },
                { label: "Generated", value: formatDateTime(request.offer.generatedAt) },
                { label: "Accepted", value: formatDateTime(request.offer.acceptedAt ?? request.acceptedAt) },
                { label: "Accepted by", value: `${nameOf(request.offer.acceptedById ?? request.acceptedById)} · ${request.cp.name}` },
              ]}
            />
            <div className="mt-5">
              <p className="eyebrow mb-2">Consent text</p>
              <blockquote className="border-l-2 border-gold bg-ivory/60 px-4 py-3 text-sm leading-relaxed text-slate-ink italic">
                {request.offer.consentText ?? "No consent text recorded."}
              </blockquote>
            </div>
            <div className="mt-5 rounded-md border border-border p-4">
              <p className="eyebrow mb-3">Programme terms snapshot</p>
              <DetailList
                columns={3}
                items={[
                  { label: "Programme", value: `${terms.programmeCode}` },
                  { label: "Agreed discount", value: formatBps(terms.discountRateBps) },
                  { label: "Offer validity", value: `${terms.offerValidityDays} days` },
                ]}
              />
              <p className="mt-4 text-sm font-medium text-navy">{terms.programmeName}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-ink">{terms.terms}</p>
            </div>
          </Section>

        </div>

        <aside className="min-w-0 space-y-6 lg:col-start-2 lg:row-start-2 lg:self-start">
          <Section title="Lifecycle" description="Every status change on this request">
            <Timeline entries={events} />
          </Section>

          <Section
            title="Internal comments"
            description={
              <span className="inline-flex items-center gap-1">
                <Lock className="size-3" aria-hidden="true" />
                Internal — not visible to CP or builder
              </span>
            }
          >
            <InternalCommentForm requestId={request.id} />
            {request.comments && request.comments.length > 0 ? (
              <ul className="mt-5 space-y-4">
                {request.comments.map((c) => (
                  <li key={c.id} className="rounded-md border border-border bg-ivory/40 px-4 py-3">
                    <p className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                      <span className="font-semibold text-navy">{c.authorName}</span>
                      <span className="text-muted-foreground">{formatDateTime(c.createdAt)}</span>
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-slate-ink">{c.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={MessageSquareText} title="No comments yet" description="Notes added here are shared only within Veefin." className="py-8" />
            )}
          </Section>
        </aside>
      </div>
    </>
  );
}
