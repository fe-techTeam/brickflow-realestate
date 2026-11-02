import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertTriangle, BadgePercent, CheckCircle2, Download, ExternalLink, FileText, FlaskConical, Info, MessageSquareWarning, XCircle } from "lucide-react";
import type { ApprovalAction, FinancingStatus } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/common/page-header";
import { AmountRow, DetailList, Section, Timeline, type TimelineEntry } from "@/components/common/panels";
import { DemoBadge, StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { calculateDiscount } from "@/lib/financing";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps, formatINR } from "@/lib/money";
import { FINANCING_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { toOfferDto } from "@/server/dto";
import { DomainError } from "@/server/errors";
import { effectiveSettlementStatus, getEligibility } from "@/server/services/financing";
import { getInvoiceDetail, type InvoiceDetail } from "@/server/services/invoices";
import { OfferLauncher } from "../../_components/offer-center";
import { offerInvoice } from "../../_components/summaries";
import { ClarificationResponse } from "./_components/clarification-response";

export const metadata: Metadata = { title: "Invoice" };

const APPROVAL_TITLE: Record<ApprovalAction, string> = {
  SUBMITTED: "Submitted for approval",
  UNDER_REVIEW: "Review started",
  CLARIFICATION_REQUESTED: "Clarification requested",
  RESUBMITTED: "Clarification provided and resubmitted",
  APPROVED: "Approved by builder",
  REJECTED: "Rejected by builder",
};

const APPROVAL_TONE: Record<ApprovalAction, TimelineEntry["tone"]> = {
  SUBMITTED: "default",
  UNDER_REVIEW: "default",
  CLARIFICATION_REQUESTED: "warning",
  RESUBMITTED: "gold",
  APPROVED: "success",
  REJECTED: "danger",
};

function eventTone(status: FinancingStatus): TimelineEntry["tone"] {
  if (status === "REJECTED") return "danger";
  if (status === "APPROVED" || status === "DISBURSED") return "success";
  if (status === "PENDING_APPROVAL") return "warning";
  return "gold";
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadInvoice(id: string) {
  const actor = await requireWorkspace("partner");
  try {
    return await getInvoiceDetail(actor, id);
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await loadInvoice(id);
  if (!invoice) notFound();

  const now = new Date();
  const eligibility = await getEligibility(invoice, now);
  const request = invoice.financingRequest;
  const openOffer = invoice.offers.find((o) => o.status === "OFFERED" && o.validUntil > now);
  const reviewEntry = [...invoice.approvals].reverse().find((a) => ["APPROVED", "REJECTED", "CLARIFICATION_REQUESTED"].includes(a.action));
  const partial = invoice.approvedAmountPaise !== null && invoice.approvedAmountPaise !== invoice.amountPaise;

  return (
    <>
      <PageHeader
        back={{ href: "/partner/invoices", label: "My Invoices" }}
        eyebrow={`Invoice · ${invoice.reference}`}
        title={invoice.invoiceNumber}
        description={`${invoice.builder.name} · ${invoice.project.name}, ${invoice.project.city}`}
        actions={
          <>
            <StatusBadge kind="invoice" status={invoice.status} className="text-xs" />
            <StatusBadge kind="financing" status={invoice.financingStatus} className="text-xs" />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <ReviewCallout invoice={invoice} reviewer={reviewEntry ? { name: reviewEntry.actorName, at: reviewEntry.createdAt } : null} partial={partial} />

          {invoice.status === "CLARIFICATION_REQUESTED" && (
            <div id="respond" className="scroll-mt-24">
              <Section title="Respond to clarification" description="Your response returns the invoice to the builder's approval inbox.">
                <ClarificationResponse invoiceId={invoice.id} builderName={invoice.builder.name} />
              </Section>
            </div>
          )}

          <Section
            title="Early payment"
            description={request ? `Financing request ${request.reference}` : "Receive the approved amount now, less the agreed discount"}
            actions={request ? <DemoBadge /> : undefined}
          >
            {request ? (
              <FinancingRequestPanel invoice={invoice} request={request} />
            ) : eligibility.eligible && eligibility.programme ? (
              <div className="flex flex-col gap-5">
                <div className="grid gap-4 rounded-lg border border-gold/30 bg-gradient-to-br from-gold-100/70 to-ivory p-5 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <p className="eyebrow text-gold-600">{openOffer ? `Open offer · ${openOffer.reference}` : "Eligible for early payment"}</p>
                    <p className="mt-2 font-display text-2xl font-semibold text-navy">
                      Receive{" "}
                      <span className="tabular text-heritage">
                        {formatINR(
                          openOffer?.netPayablePaise ?? calculateDiscount(invoice.approvedAmountPaise!, eligibility.programme.discountRateBps).netPayablePaise,
                        )}
                      </span>{" "}
                      now
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatBps(openOffer?.discountRateBps ?? eligibility.programme.discountRateBps)} agreed discount on the builder-approved amount of{" "}
                      {formatINR(invoice.approvedAmountPaise!)} · {eligibility.programme.name}
                      {openOffer ? ` · valid until ${formatDateTime(openOffer.validUntil)}` : ""}
                    </p>
                  </div>
                  <OfferLauncher
                    invoice={offerInvoice(invoice)}
                    offer={openOffer ? toOfferDto(openOffer) : undefined}
                    label={openOffer ? "Review offer" : "Get discounted amount"}
                    size="lg"
                  />
                </div>
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  The rate is fixed by the programme agreed between {eligibility.programme.financier.name} and {invoice.builder.name}. Your credit terms with the builder do
                  not change.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-lg bg-muted/60 px-4 py-4 text-sm">
                <BadgePercent className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium text-navy">Not available yet</p>
                  <p className="mt-0.5 text-muted-foreground">{eligibility.reason}</p>
                </div>
              </div>
            )}
          </Section>

          <Section title="Invoice details">
            <DetailList
              items={[
                { label: "Invoice amount (incl. GST)", value: formatINR(invoice.amountPaise), emphasis: true },
                {
                  label: "Builder-approved amount",
                  value: invoice.approvedAmountPaise !== null ? formatINR(invoice.approvedAmountPaise) : "Awaiting approval",
                  emphasis: invoice.approvedAmountPaise !== null,
                },
                { label: "GST amount", value: invoice.gstAmountPaise !== null ? formatINR(invoice.gstAmountPaise) : "Not stated" },
                { label: "Taxable value", value: invoice.gstAmountPaise !== null ? formatINR(invoice.amountPaise - invoice.gstAmountPaise) : "—" },
                { label: "Invoice date", value: formatDate(invoice.invoiceDate) },
                { label: "Due date", value: invoice.dueDate ? formatDate(invoice.dueDate) : "As per empanelment credit period" },
                { label: "Builder", value: invoice.builder.name },
                { label: "Project", value: `${invoice.project.name} (${invoice.project.code}) · ${invoice.project.city}` },
                { label: "BrickFlow reference", value: invoice.reference },
                { label: "Submitted", value: formatDateTime(invoice.submittedAt) },
              ]}
            />
            {invoice.description && (
              <div className="mt-6 border-t border-border/70 pt-5">
                <p className="eyebrow mb-1">Description</p>
                <p className="text-sm leading-relaxed text-slate-ink">{invoice.description}</p>
              </div>
            )}
          </Section>

          <Section title="Approval history" description="Every action taken on this invoice">
            <Timeline
              entries={invoice.approvals.map((a) => ({
                id: a.id,
                title: APPROVAL_TITLE[a.action],
                meta: `${a.actorName} · ${formatDateTime(a.createdAt)}`,
                body: a.comment ?? undefined,
                tone: APPROVAL_TONE[a.action],
              }))}
            />
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Section title="Documents" description={`${invoice.documents.length} ${invoice.documents.length === 1 ? "file" : "files"}`} bodyClassName="p-0">
            <ul className="divide-y divide-border/70">
              {invoice.documents.map((doc, index) => (
                <li key={doc.id} className="px-5 py-4 sm:px-6">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-navy/[0.06] text-navy">
                      <FileText className="size-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-navy" title={doc.fileName}>
                        {doc.fileName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(doc.sizeBytes)} · {formatDateTime(doc.createdAt)}
                      </p>
                      <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">{index === 0 ? "Current version" : "Previous version"}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2 pl-12">
                    <Button variant="outline" size="sm" asChild>
                      <a href={`/api/documents/invoices/${doc.id}`} target="_blank" rel="noopener noreferrer">
                        <ExternalLink />
                        View
                      </a>
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <a href={`/api/documents/invoices/${doc.id}?download=1`} download>
                        <Download />
                        Download
                      </a>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          {invoice.offers.length > 0 && (
            <Section title="Offer history" bodyClassName="p-0">
              <ul className="divide-y divide-border/70">
                {invoice.offers.map((offer) => (
                  <li key={offer.id} className="flex items-start justify-between gap-3 px-5 py-3.5 sm:px-6">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-navy">{offer.reference}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBps(offer.discountRateBps)} · generated {formatDate(offer.generatedAt)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StatusBadge kind="offer" status={offer.status === "OFFERED" && offer.validUntil <= now ? "EXPIRED" : offer.status} />
                      <span className="tabular text-xs text-slate-ink">{formatINR(offer.netPayablePaise)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="rounded-lg border border-border bg-ivory/70 p-5 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-1 flex items-center gap-1.5 font-semibold text-navy">
              <FlaskConical className="size-3.5 text-gold-600" />
              Demonstration environment
            </p>
            Financing, disbursement and settlement on BrickFlow are simulated. No real funds move and payment references are generated for demonstration only.
          </div>
        </div>
      </div>
    </>
  );
}

function ReviewCallout({
  invoice,
  reviewer,
  partial,
}: {
  invoice: InvoiceDetail;
  reviewer: { name: string; at: Date } | null;
  partial: boolean;
}) {
  const by = reviewer ? `${reviewer.name}, ${invoice.builder.name} · ${formatDateTime(reviewer.at)}` : invoice.builder.name;
  if (invoice.status === "REJECTED") {
    return (
      <Callout tone="danger" icon={XCircle} title="Rejected by the builder" meta={by}>
        {invoice.latestReviewNote ?? "No reason was recorded."}
      </Callout>
    );
  }
  if (invoice.status === "CLARIFICATION_REQUESTED") {
    return (
      <Callout tone="warning" icon={MessageSquareWarning} title="The builder needs a clarification" meta={by}>
        {invoice.latestReviewNote ?? "Please respond with the requested information."}
      </Callout>
    );
  }
  if (invoice.status === "ACCEPTED" && (invoice.latestReviewNote || partial)) {
    return (
      <Callout tone="success" icon={CheckCircle2} title={partial ? `Approved at ${formatINR(invoice.approvedAmountPaise!)}` : "Approved by the builder"} meta={by}>
        {invoice.latestReviewNote ?? `The builder approved ${formatINR(invoice.approvedAmountPaise!)} of ${formatINR(invoice.amountPaise)} invoiced.`}
      </Callout>
    );
  }
  return null;
}

function Callout({
  tone,
  icon: Icon,
  title,
  meta,
  children,
}: {
  tone: "danger" | "warning" | "success";
  icon: typeof AlertTriangle;
  title: string;
  meta: string;
  children: React.ReactNode;
}) {
  const styles = {
    danger: "border-[#ecc6bf] bg-[#f8e7e4] text-[#93342a]",
    warning: "border-[#efd9ae] bg-[#fbf1df] text-[#8a5a12]",
    success: "border-heritage/20 bg-sage text-heritage",
  }[tone];
  return (
    <div role={tone === "success" ? "status" : "alert"} className={cn("animate-fade-up rounded-lg border px-5 py-4 sm:px-6", styles)}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
        <div className="min-w-0">
          <p className="font-display text-lg leading-tight font-semibold">{title}</p>
          <p className="mt-0.5 text-xs opacity-80">{meta}</p>
          <p className="mt-3 text-sm leading-relaxed text-slate-ink">&ldquo;{children}&rdquo;</p>
        </div>
      </div>
    </div>
  );
}

function FinancingRequestPanel({ invoice, request }: { invoice: InvoiceDetail; request: NonNullable<InvoiceDetail["financingRequest"]> }) {
  const disbursement = request.disbursement;
  const settlement = request.settlement;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-gold/30 bg-gold-100/60 px-3 py-2 text-xs font-semibold tracking-wide text-gold-600 uppercase">
        <FlaskConical className="size-3.5" />
        Demo / simulated — no real funds move
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="divide-y divide-border/70">
          <AmountRow label="Original invoice amount" value={formatINR(invoice.amountPaise)} />
          <AmountRow label="Builder-approved amount" value={formatINR(request.approvedAmountPaise)} />
          <AmountRow label={`Discount (${formatBps(request.discountRateBps)})`} value={`− ${formatINR(request.discountAmountPaise)}`} tone="deduct" />
          <AmountRow label="Other charges" value={formatINR(request.chargesPaise)} hint="No additional charges" />
          <AmountRow label="Net payment" value={formatINR(request.netPayablePaise)} tone="total" />
        </div>
        <DetailList
          columns={1}
          className="gap-y-4"
          items={[
            { label: "Request reference", value: request.reference },
            { label: "Financing status", value: <StatusBadge kind="financing" status={request.status} /> },
            { label: "Financier · programme", value: `${request.financier.name} · ${request.programme.code}` },
            { label: "Accepted on", value: formatDateTime(request.acceptedAt) },
            ...(request.decidedAt
              ? [{ label: request.status === "REJECTED" ? "Rejected on" : "Approved on", value: formatDateTime(request.decidedAt) }]
              : []),
          ]}
        />
      </div>

      {request.status === "REJECTED" && request.decisionNote && (
        <div role="alert" className="rounded-lg border border-[#ecc6bf] bg-[#f8e7e4] px-4 py-3 text-sm text-[#93342a]">
          <p className="font-medium">Veefin declined this request</p>
          <p className="mt-1 text-slate-ink">{request.decisionNote}</p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-ivory/50 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">Simulated payout</p>
          {disbursement ? <StatusBadge kind="disbursement" status={disbursement.status} /> : <DemoBadge />}
        </div>
        <DetailList
          columns={3}
          items={[
            { label: "Payment reference", value: disbursement?.reference ?? (request.status === "REJECTED" ? "Not applicable" : "Issued when Veefin initiates the payout") },
            { label: "UTR (simulated)", value: disbursement?.utr ?? "Pending" },
            {
              label: "Disbursement status",
              value: disbursement ? (
                <StatusBadge kind="disbursement" status={disbursement.status} />
              ) : (
                FINANCING_STATUS[request.status].label
              ),
            },
            { label: "Transaction date", value: disbursement ? formatDateTime(disbursement.completedAt ?? disbursement.initiatedAt) : "—" },
            { label: "Beneficiary account", value: disbursement ? `${disbursement.beneficiaryAccount} · ${disbursement.beneficiaryIfsc}` : "Registered bank account" },
            {
              label: "Builder settlement",
              value: settlement ? (
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge kind="settlement" status={effectiveSettlementStatus(settlement)} />
                  <span className="text-xs text-muted-foreground">due {formatDate(settlement.dueDate)}</span>
                </span>
              ) : (
                "Opens after disbursement"
              ),
            },
          ]}
        />
      </div>

      <div>
        <p className="eyebrow mb-4">Request timeline</p>
        <Timeline
          entries={request.events.map((e) => ({
            id: e.id,
            title: FINANCING_STATUS[e.toStatus].label,
            meta: `${e.actorName} · ${formatDateTime(e.createdAt)}`,
            body: e.note ?? undefined,
            tone: eventTone(e.toStatus),
          }))}
        />
      </div>
    </div>
  );
}
