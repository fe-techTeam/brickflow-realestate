import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, MessageSquareWarning, XCircle } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DetailList, Section, Timeline, type TimelineEntry } from "@/components/common/panels";
import { StatusBadge } from "@/components/common/status-badge";
import type { ApprovalAction } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatINR } from "@/lib/money";
import { requireWorkspace, type Actor } from "@/server/auth/session";
import { DomainError } from "@/server/errors";
import { getBuilderEmpanelment } from "@/server/queries/builder";
import { getInvoiceDetail, type InvoiceDetail } from "@/server/services/invoices";
import { formatAgeing } from "../../_lib/dates";
import { DocumentViewer } from "./_components/document-viewer";
import { FinancingPanel } from "./_components/financing-panel";
import { ReviewActions } from "./_components/review-actions";

export const metadata: Metadata = { title: "Invoice review" };

const DAY_MS = 24 * 60 * 60 * 1000;

const HISTORY: Record<ApprovalAction, { title: string; tone: TimelineEntry["tone"] }> = {
  SUBMITTED: { title: "Submitted by channel partner", tone: "default" },
  UNDER_REVIEW: { title: "Review started", tone: "default" },
  CLARIFICATION_REQUESTED: { title: "Clarification requested", tone: "warning" },
  RESUBMITTED: { title: "Clarification provided", tone: "gold" },
  APPROVED: { title: "Approved", tone: "success" },
  REJECTED: { title: "Rejected", tone: "danger" },
};

async function loadInvoice(actor: Actor, id: string): Promise<InvoiceDetail> {
  try {
    return await getInvoiceDetail(actor, id);
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

function DecisionSummary({ invoice }: { invoice: InvoiceDetail }) {
  if (invoice.status === "ACCEPTED") {
    const approved = invoice.approvedAmountPaise ?? invoice.amountPaise;
    const shortfall = invoice.amountPaise - approved;
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-heritage" />
          <div>
            <p className="text-sm font-medium text-navy">Approved on {formatDate(invoice.decidedAt)}</p>
            <p className="text-xs text-muted-foreground">Eligible for early payment while the due date is in the future.</p>
          </div>
        </div>
        <div className="rounded-md bg-sage/60 px-4 py-3">
          <p className="eyebrow text-heritage/80">Approved amount</p>
          <p className="tabular mt-1 font-display text-2xl font-semibold text-heritage">{formatINR(approved)}</p>
          {shortfall > 0n && <p className="mt-1 text-xs text-heritage/80">Partial approval · {formatINR(shortfall)} less than invoiced</p>}
        </div>
        {invoice.latestReviewNote && <p className="rounded-md bg-muted/70 px-3 py-2 text-sm text-slate-ink">{invoice.latestReviewNote}</p>}
      </div>
    );
  }
  if (invoice.status === "REJECTED") {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <XCircle className="mt-0.5 size-5 shrink-0 text-[#93342a]" />
          <div>
            <p className="text-sm font-medium text-navy">Rejected on {formatDate(invoice.decidedAt)}</p>
            <p className="text-xs text-muted-foreground">The channel partner has been shown your reason.</p>
          </div>
        </div>
        {invoice.latestReviewNote && <p className="rounded-md bg-[#f8e7e4]/70 px-3 py-2 text-sm text-slate-ink">{invoice.latestReviewNote}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <MessageSquareWarning className="mt-0.5 size-5 shrink-0 text-[#8a5a12]" />
        <div>
          <p className="text-sm font-medium text-navy">Waiting for {invoice.cp.name}</p>
          <p className="text-xs text-muted-foreground">The invoice returns to your inbox when the partner responds. No action is needed until then.</p>
        </div>
      </div>
      {invoice.latestReviewNote && (
        <p className="rounded-md bg-[#fbf1df]/80 px-3 py-2 text-sm text-slate-ink">
          <span className="font-medium text-navy">Your request: </span>
          {invoice.latestReviewNote}
        </p>
      )}
    </div>
  );
}

export default async function InvoiceReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireWorkspace("builder");
  const { id } = await params;
  const invoice = await loadInvoice(actor, id);
  const empanelment = await getBuilderEmpanelment(actor, invoice.cpId);
  const now = new Date();

  const creditPeriodDays = empanelment?.creditPeriodDays ?? null;
  const originalDueDate = invoice.dueDate ?? new Date(invoice.invoiceDate.getTime() + (creditPeriodDays ?? 60) * DAY_MS);
  const reviewable = invoice.status === "SUBMITTED" || invoice.status === "UNDER_REVIEW";
  const clarifications = invoice.approvals.filter((a) => a.action === "CLARIFICATION_REQUESTED" || a.action === "RESUBMITTED");
  const back = invoice.status === "ACCEPTED" ? { href: "/builder/approved", label: "Approved invoices" } : { href: "/builder/approvals", label: "Invoice approvals" };

  return (
    <>
      <PageHeader
        back={back}
        eyebrow={`Invoice review · ${invoice.reference}`}
        title={invoice.invoiceNumber}
        description={`${invoice.cp.name} · ${invoice.project.name}, ${invoice.project.city} · ${formatINR(invoice.amountPaise)}`}
        actions={
          <>
            <StatusBadge kind="invoice" status={invoice.status} />
            {invoice.status === "ACCEPTED" && <StatusBadge kind="financing" status={invoice.financingStatus} />}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <aside className="space-y-6 xl:col-start-2 xl:row-start-1">
          <Section title="Decision" description={reviewable ? "Approve, request clarification or reject" : undefined}>
            {reviewable ? (
              <>
                <div className="mb-5 flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="size-3.5" />
                  Submitted {formatAgeing(invoice.submittedAt, now)} · {formatDateTime(invoice.submittedAt)}
                </div>
                <ReviewActions
                  invoiceId={invoice.id}
                  invoiceNumber={invoice.invoiceNumber}
                  cpName={invoice.cp.name}
                  amountPaise={invoice.amountPaise.toString()}
                  status={invoice.status as "SUBMITTED" | "UNDER_REVIEW"}
                />
              </>
            ) : (
              <DecisionSummary invoice={invoice} />
            )}
          </Section>

          {clarifications.length > 0 && (
            <Section title="Clarifications" description="Your questions and the channel partner's responses">
              <ol className="space-y-3">
                {clarifications.map((entry) => {
                  const fromBuilder = entry.action === "CLARIFICATION_REQUESTED";
                  return (
                    <li key={entry.id} className={fromBuilder ? "mr-6" : "ml-6"}>
                      <div className={fromBuilder ? "rounded-md rounded-tl-none bg-[#fbf1df]/80 px-3 py-2.5" : "rounded-md rounded-tr-none bg-sage/70 px-3 py-2.5"}>
                        <p className="text-sm text-slate-ink">{entry.comment ?? "—"}</p>
                      </div>
                      <p className={fromBuilder ? "mt-1 text-[0.6875rem] text-muted-foreground" : "mt-1 text-right text-[0.6875rem] text-muted-foreground"}>
                        {fromBuilder ? "You asked" : `${invoice.cp.name} responded`} · {entry.actorName} · {formatDateTime(entry.createdAt)}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </Section>
          )}

          <Section title="Approval history">
            <Timeline
              entries={invoice.approvals.map((a) => ({
                id: a.id,
                tone: HISTORY[a.action].tone,
                title: a.action === "APPROVED" && invoice.approvedAmountPaise ? `${HISTORY[a.action].title} · ${formatINR(invoice.approvedAmountPaise)}` : HISTORY[a.action].title,
                meta: `${a.actorName} · ${formatDateTime(a.createdAt)}`,
                body: a.comment ?? undefined,
              }))}
            />
          </Section>
        </aside>

        <div className="min-w-0 space-y-6 xl:col-start-1 xl:row-start-1">
          <DocumentViewer documents={invoice.documents} invoiceNumber={invoice.invoiceNumber} />

          <Section title="Invoice details" description="As submitted by the channel partner">
            <DetailList
              items={[
                {
                  label: "Channel partner",
                  value: (
                    <>
                      {invoice.cp.name}
                      {invoice.cp.legalName !== invoice.cp.name && <span className="block text-xs text-muted-foreground">{invoice.cp.legalName}</span>}
                    </>
                  ),
                },
                { label: "CP GSTIN", value: invoice.cp.gstin ? <span className="font-mono text-xs">{invoice.cp.gstin}</span> : "Not recorded" },
                {
                  label: "Project",
                  value: (
                    <>
                      {invoice.project.name} ({invoice.project.code})
                      <span className="block text-xs text-muted-foreground">
                        {[invoice.project.location, invoice.project.city].filter(Boolean).join(", ")}
                        {invoice.project.reraNumber ? ` · RERA ${invoice.project.reraNumber}` : ""}
                      </span>
                    </>
                  ),
                },
                { label: "Invoice number", value: invoice.invoiceNumber },
                { label: "BrickFlow reference", value: <span className="font-mono text-xs">{invoice.reference}</span> },
                { label: "Invoice date", value: formatDate(invoice.invoiceDate) },
                {
                  label: "Due date",
                  value: invoice.dueDate ? (
                    formatDate(invoice.dueDate)
                  ) : (
                    <>
                      {formatDate(originalDueDate)}
                      <span className="block text-xs text-muted-foreground">Not stated; {creditPeriodDays ?? 60}-day credit period applies</span>
                    </>
                  ),
                },
                {
                  label: "Empanelment",
                  value: empanelment ? `${empanelment.empanelmentCode} · ${empanelment.creditPeriodDays}-day credit period` : "Not empanelled",
                },
                { label: "Invoice amount (incl. GST)", value: formatINR(invoice.amountPaise), emphasis: true },
                { label: "GST component", value: invoice.gstAmountPaise !== null ? formatINR(invoice.gstAmountPaise) : "Not stated" },
                { label: "Submitted at", value: `${formatDateTime(invoice.submittedAt)} (${formatAgeing(invoice.submittedAt, now)})` },
                {
                  label: "Approved amount",
                  value: invoice.approvedAmountPaise !== null ? formatINR(invoice.approvedAmountPaise) : invoice.status === "REJECTED" ? "Rejected" : "Pending decision",
                },
              ]}
            />
            {invoice.description && (
              <div className="mt-6 border-t border-border/70 pt-5">
                <p className="eyebrow mb-1">Description</p>
                <p className="text-sm leading-relaxed text-slate-ink">{invoice.description}</p>
              </div>
            )}
          </Section>

          {invoice.status === "ACCEPTED" && <FinancingPanel invoice={invoice} originalDueDate={originalDueDate} creditPeriodDays={creditPeriodDays} />}
        </div>
      </div>
    </>
  );
}
