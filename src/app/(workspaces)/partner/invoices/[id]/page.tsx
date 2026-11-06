import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  BadgePercent,
  Check,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  MessageSquareWarning,
  RotateCcw,
  Send,
  X,
  XCircle,
} from "lucide-react";
import type { ApprovalAction, FinancingStatus } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/format";
import { describeRate } from "@/lib/key-facts";
import { formatBps } from "@/lib/money";
import { FINANCING_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { toOfferDto } from "@/server/dto";
import { DomainError } from "@/server/errors";
import { effectiveSettlementStatus, getEligibility } from "@/server/services/financing";
import { getInvoiceDetail, type InvoiceDetail } from "@/server/services/invoices";
import { Money } from "../../_components/money";
import { OfferLauncher } from "../../_components/offer-center";
import { offerInvoice } from "../../_components/summaries";
import { Chronicle, type ChronicleEntry, FacadePattern, Facts, Label, LedgerLine, PageIntro, Panel, StatusMark, StatusPill } from "../../_components/ui";
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

const APPROVAL_MARK: Record<ApprovalAction, Pick<ChronicleEntry, "tone" | "icon">> = {
  SUBMITTED: { tone: "default", icon: Send },
  UNDER_REVIEW: { tone: "default", icon: Eye },
  CLARIFICATION_REQUESTED: { tone: "warning", icon: MessageSquareWarning },
  RESUBMITTED: { tone: "kota", icon: RotateCcw },
  APPROVED: { tone: "success", icon: Check },
  REJECTED: { tone: "danger", icon: X },
};

function eventTone(status: FinancingStatus): ChronicleEntry["tone"] {
  if (status === "REJECTED") return "danger";
  if (status === "APPROVED" || status === "DISBURSED") return "success";
  if (status === "PENDING_APPROVAL") return "warning";
  return "kota";
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
      <PageIntro
        back={{ href: "/partner/invoices", label: "My Invoices" }}
        eyebrow={`Brokerage invoice · ${invoice.reference}`}
        title={invoice.invoiceNumber}
        description={`${invoice.builder.name} · ${invoice.project.name}, ${invoice.project.city}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <StatusPill kind="invoice" status={invoice.status} label="Invoice" />
            <StatusPill kind="financing" status={invoice.financingStatus} label="Early payment" />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <ReviewCallout invoice={invoice} reviewer={reviewEntry ? { name: reviewEntry.actorName, at: reviewEntry.createdAt } : null} partial={partial} />

          {invoice.status === "CLARIFICATION_REQUESTED" && (
            <Panel id="respond" className="scroll-mt-24" eyebrow="Your response" title="Respond to clarification" description="Your response returns the invoice to the builder's approval inbox.">
              <ClarificationResponse invoiceId={invoice.id} builderName={invoice.builder.name} />
            </Panel>
          )}

          <InvoiceDocument invoice={invoice} partial={partial} />

          {request && <FinancingRequestPanel invoice={invoice} request={request} />}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          {!request &&
            (eligibility.eligible && eligibility.programme ? (
              <section className="surface-basalt relative isolate animate-fade-up overflow-hidden p-6 sm:p-7">
                <FacadePattern className="inset-y-0 right-0 -z-10 h-full w-full text-fg-muted/[0.12]" />
                <p className="text-[0.625rem] font-semibold tracking-[0.22em] text-fg-muted uppercase">{openOffer ? `Open offer · ${openOffer.reference}` : "Eligible for early payment"}</p>
                <p className="mt-4 text-xs text-white/55">Receive now</p>
                <Money
                  paise={openOffer?.netPayablePaise ?? eligibility.quote?.result.quote.netPayablePaise ?? 0n}
                  size="hero"
                  className="mt-1 block font-light text-[#e3ddd2]"
                />
                <p className="mt-3 text-[0.8125rem] leading-relaxed text-white/65">
                  {describeRate(openOffer?.pricingMode ?? eligibility.programme.pricingMode, openOffer?.discountRateBps ?? eligibility.programme.discountRateBps)} agreed
                  discount on the approved{" "}
                  <Money paise={invoice.approvedAmountPaise!} className="text-white" />
                  {openOffer ? ` · valid until ${formatDateTime(openOffer.validUntil)}` : ""}
                </p>
                <OfferLauncher
                  invoice={offerInvoice(invoice)}
                  offer={openOffer ? toOfferDto(openOffer) : undefined}
                  label={openOffer ? "Review offer" : "Get discounted amount"}
                  size="lg"
                  className="mt-6 w-full"
                />
                <p className="mt-4 border-t border-white/10 pt-4 text-[0.6875rem] leading-relaxed text-white/45">
                  The rate is fixed by the programme agreed between {eligibility.programme.financier.name} and {invoice.builder.name}. Your credit terms with the builder
                  do not change.
                </p>
              </section>
            ) : (
              <Panel eyebrow="Early payment" bodyClassName="pt-1">
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-glass-100 text-muted-foreground ring-1 ring-border">
                    <BadgePercent className="size-4" strokeWidth={1.75} />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-fg">Not available yet</p>
                    <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-muted-foreground">{eligibility.reason}</p>
                  </div>
                </div>
              </Panel>
            ))}

          <Panel eyebrow="Source document" title="Invoice PDF" bodyClassName="pb-5">
            <ul className="grid gap-3">
              {invoice.documents.map((doc, index) => (
                <li key={doc.id} className={cn("rounded-lg border p-4", index === 0 ? "border-border bg-glass-100" : "border-dashed border-border")}>
                  <div className="flex items-start gap-3.5">
                    <span className="relative flex h-12 w-10 shrink-0 flex-col items-center justify-end rounded-[4px] border border-line bg-card pb-1.5 shadow-[0_2px_0_rgba(255,255,255,0.08)]">
                      <span aria-hidden="true" className="absolute top-0 right-0 size-2.5 rounded-bl-[3px] border-b border-l border-line bg-glass-100" />
                      <FileText className="mb-0.5 size-3.5 text-fg/60" strokeWidth={1.5} />
                      <span className="text-[0.5rem] font-bold tracking-wider text-danger">PDF</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg" title={doc.fileName}>
                        {doc.fileName}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatBytes(doc.sizeBytes)} · {formatDate(doc.createdAt)}
                      </p>
                      <p className={cn("mt-1 text-[0.625rem] font-semibold tracking-[0.14em] uppercase", index === 0 ? "text-leaf" : "text-muted-foreground")}>
                        {index === 0 ? "Current version" : "Previous version"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3.5 grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" asChild className="bg-card">
                      <a href={`/api/documents/invoices/${doc.id}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${doc.fileName}`}>
                        <Eye />
                        View
                      </a>
                    </Button>
                    <Button variant="outline" size="sm" asChild className="bg-card">
                      <a href={`/api/documents/invoices/${doc.id}?download=1`} download aria-label={`Download ${doc.fileName}`}>
                        <Download />
                        Download
                      </a>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel eyebrow="Audit trail" title="Approval history" description="Every action taken on this invoice">
            <Chronicle
              entries={invoice.approvals.map((a) => ({
                id: a.id,
                title: APPROVAL_TITLE[a.action],
                actor: a.actorName,
                at: formatDateTime(a.createdAt),
                note: a.comment ?? undefined,
                ...APPROVAL_MARK[a.action],
              }))}
            />
          </Panel>

          {invoice.offers.length > 0 && (
            <Panel eyebrow="Pricing" title="Offer history" bodyClassName="pb-2">
              <ul className="-mx-5 divide-y divide-hairline border-t border-hairline sm:-mx-7">
                {invoice.offers.map((offer) => (
                  <li key={offer.id} className="flex items-start justify-between gap-3 px-5 py-3.5 sm:px-7">
                    <div className="min-w-0">
                      <p className="text-[0.8125rem] font-medium text-fg">{offer.reference}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBps(offer.discountRateBps)} · {formatDate(offer.generatedAt)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Money paise={offer.netPayablePaise} className="text-[0.8125rem] font-medium text-fg" />
                      <StatusMark kind="offer" status={offer.status === "OFFERED" && offer.validUntil <= now ? "EXPIRED" : offer.status} className="text-xs" />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}

function InvoiceDocument({ invoice, partial }: { invoice: InvoiceDetail; partial: boolean }) {
  const taxable = invoice.gstAmountPaise !== null ? invoice.amountPaise - invoice.gstAmountPaise : null;
  return (
    <section className="relative animate-fade-up overflow-hidden surface">
      <div aria-hidden="true" className="h-[3px] bg-linear-to-r from-night via-night to-haze" />
      <div className="flex flex-col gap-6 border-b border-hairline px-5 py-6 sm:flex-row sm:items-start sm:justify-between sm:px-8 sm:py-7">
        <div>
          <Label className="text-fg-muted">Tax invoice · brokerage services</Label>
          <p className="mt-2 font-display text-[1.75rem] leading-none font-normal text-fg">{invoice.invoiceNumber}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Dated {formatDate(invoice.invoiceDate)} · Submitted {formatDateTime(invoice.submittedAt)}
          </p>
        </div>
        <div className="sm:text-right">
          <Label>Invoice total · incl. GST</Label>
          <Money paise={invoice.amountPaise} size="xl" className="mt-2 block font-medium text-fg" />
        </div>
      </div>

      <div className="grid sm:grid-cols-2">
        <div className="border-b border-hairline px-5 py-6 sm:border-r sm:border-b-0 sm:px-8">
          <Label>From</Label>
          <p className="mt-2 font-medium text-fg">{invoice.cp.legalName ?? invoice.cp.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">GSTIN {invoice.cp.gstin ?? "not on file"}</p>
        </div>
        <div className="px-5 py-6 sm:px-8">
          <Label>Bill to</Label>
          <p className="mt-2 font-medium text-fg">{invoice.builder.legalName ?? invoice.builder.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">GSTIN {invoice.builder.gstin ?? "not on file"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {invoice.project.name} ({invoice.project.code}) · {invoice.project.city}
          </p>
        </div>
      </div>

      <div className="border-t border-hairline bg-glass-100 px-5 py-6 sm:px-8">
        <Facts
          columns={3}
          items={[
            { label: "Invoice date", value: formatDate(invoice.invoiceDate) },
            { label: "Due date", value: invoice.dueDate ? formatDate(invoice.dueDate) : "Per empanelment credit period" },
            { label: "BrickFlow reference", value: invoice.reference },
          ]}
        />
      </div>

      <div className="grid gap-8 px-5 py-7 sm:px-8 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div>
          <Label>Description</Label>
          <p className="mt-2 text-sm leading-relaxed text-fg-soft">{invoice.description ?? "No description provided."}</p>
        </div>
        <div>
          <LedgerLine label="Taxable value" value={taxable !== null ? <Money paise={taxable} /> : "—"} />
          <LedgerLine label="GST" value={invoice.gstAmountPaise !== null ? <Money paise={invoice.gstAmountPaise} /> : "Not stated"} tone={invoice.gstAmountPaise === null ? "muted" : "default"} />
          <div className="mt-1 border-t-[3px] border-double border-line-strong/20">
            <LedgerLine label="Invoice total" value={<Money paise={invoice.amountPaise} />} tone="strong" />
          </div>
          <div className={cn("mt-2 flex items-baseline justify-between gap-3 rounded-[8px] px-3 py-2.5", invoice.approvedAmountPaise !== null ? "bg-leaf-50" : "bg-glass-100")}>
            <span className={cn("text-[0.8125rem]", invoice.approvedAmountPaise !== null ? "font-medium text-leaf" : "text-muted-foreground")}>
              {partial ? "Builder-approved (partial)" : "Builder-approved"}
            </span>
            {invoice.approvedAmountPaise !== null ? (
              <Money paise={invoice.approvedAmountPaise} className="font-semibold text-leaf" />
            ) : (
              <span className="text-[0.8125rem] text-muted-foreground">Awaiting decision</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ReviewCallout({ invoice, reviewer, partial }: { invoice: InvoiceDetail; reviewer: { name: string; at: Date } | null; partial: boolean }) {
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
      <Callout tone="success" icon={CheckCircle2} title={partial ? "Approved at a revised amount" : "Approved by the builder"} meta={by}>
        {invoice.latestReviewNote ?? "The builder approved a different amount from the invoice total."}
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
    danger: { bar: "bg-[#ff7b6e]", icon: "bg-danger-soft text-danger", title: "text-danger" },
    warning: { bar: "bg-[#ffb36b]", icon: "bg-warning-soft text-warning", title: "text-warning" },
    success: { bar: "bg-leaf", icon: "bg-leaf-50 text-leaf", title: "text-leaf" },
  }[tone];
  return (
    <div
      role={tone === "success" ? "status" : "alert"}
      className="relative animate-fade-up overflow-hidden surface py-5 pr-5 pl-6 sm:pr-7 sm:pl-8"
    >
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-1", styles.bar)} />
      <div className="flex items-start gap-4">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", styles.icon)}>
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className={cn("font-display text-[1.25rem] leading-tight font-normal", styles.title)}>{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>
          <p className="mt-3 font-accent text-[1.125rem] leading-relaxed text-fg-soft italic">&ldquo;{children}&rdquo;</p>
        </div>
      </div>
    </div>
  );
}

function FinancingRequestPanel({ invoice, request }: { invoice: InvoiceDetail; request: NonNullable<InvoiceDetail["financingRequest"]> }) {
  const disbursement = request.disbursement;
  const settlement = request.settlement;
  return (
    <Panel
      id="financing"
      eyebrow={`Early payment · ${request.reference}`}
      title="Financing"
      description={`${request.financier.name} · ${request.programme.code} · accepted ${formatDateTime(request.acceptedAt)}`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill kind="financing" status={request.status} />
        </div>
      }
    >
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <Label>Settlement statement</Label>
          <div className="mt-1">
            <LedgerLine label="Original invoice value" value={<Money paise={invoice.amountPaise} />} />
            <LedgerLine label="Builder-approved" value={<Money paise={request.approvedAmountPaise} />} />
            <LedgerLine label={`Agreed discount · ${formatBps(request.discountRateBps)}`} value={<Money paise={request.discountAmountPaise} sign="minus" />} tone="deduct" />
            <LedgerLine label="Other charges" value={<Money paise={request.chargesPaise} />} tone="muted" />
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t-[3px] border-double border-line-strong/20 pt-4">
            <span className="text-sm font-semibold text-fg">Net payment</span>
            <Money paise={request.netPayablePaise} size="lg" className="font-medium text-leaf" />
          </div>
          {request.status === "REJECTED" && request.decisionNote && (
            <div role="alert" className="mt-5 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
              <p className="font-medium">Veefin declined this request</p>
              <p className="mt-1 text-fg-soft">{request.decisionNote}</p>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-glass-100 p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <Label className="text-fg">Payout</Label>
            {disbursement ? <StatusMark kind="disbursement" status={disbursement.status} className="text-xs" /> : <span className="text-xs text-muted-foreground">{FINANCING_STATUS[request.status].label}</span>}
          </div>
          <Facts
            className="gap-x-6 gap-y-4 [&_dd]:text-[0.8125rem] [&_dd]:[overflow-wrap:anywhere]"
            items={[
              { label: "Paid amount", value: disbursement ? <Money paise={disbursement.amountPaise} className="font-semibold text-leaf" /> : "—" },
              { label: "Transaction date", value: disbursement ? formatDateTime(disbursement.completedAt ?? disbursement.initiatedAt) : "—" },
              {
                label: "Payment reference",
                value: disbursement?.reference ?? (request.status === "REJECTED" ? "Not applicable" : "Issued when Veefin initiates the payout"),
              },
              { label: "UTR", value: disbursement?.utr ?? "Pending" },
              { label: "Beneficiary account", value: disbursement ? `${disbursement.beneficiaryAccount} · ${disbursement.beneficiaryIfsc}` : "Registered bank account" },
              {
                label: "Builder settlement",
                value: settlement ? (
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 break-normal">
                    <StatusMark kind="settlement" status={effectiveSettlementStatus(settlement)} className="text-xs" />
                    <span className="text-xs text-muted-foreground">due {formatDate(settlement.dueDate)}</span>
                  </span>
                ) : (
                  "Opens after disbursement"
                ),
              },
            ]}
          />
        </div>
      </div>

      <div className="mt-8 border-t border-hairline pt-6">
        <Label>Request timeline</Label>
        <Chronicle
          className="mt-5"
          entries={request.events.map((e) => ({
            id: e.id,
            title: FINANCING_STATUS[e.toStatus].label,
            actor: e.actorName,
            at: formatDateTime(e.createdAt),
            note: e.note ?? undefined,
            tone: eventTone(e.toStatus),
          }))}
        />
      </div>
    </Panel>
  );
}
