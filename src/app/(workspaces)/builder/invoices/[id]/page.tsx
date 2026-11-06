import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, ChevronLeft, Eye, FileUp, MessageSquareText, MessageSquareWarning, Send, ShieldCheck, XCircle, type LucideIcon } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { BrokerageParticulars, MatchAttestationSummary } from "@/components/invoice/brokerage-particulars";
import { DuplicateFlagList } from "@/components/invoice/duplicate-flags";
import { describeMatchItems } from "@/lib/invoice-integrity/match";
import type { ApprovalAction } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireWorkspace, type Actor } from "@/server/auth/session";
import { DomainError } from "@/server/errors";
import { getBuilderEmpanelment } from "@/server/queries/builder";
import { getMatchPolicy, listDuplicateFlags, toDuplicateFlagDtos } from "@/server/services/invoice-integrity";
import { getInvoiceDetail, type InvoiceDetail } from "@/server/services/invoices";
import { AgeingMeter } from "../../_components/ageing";
import { Chronicle, type ChronicleTone } from "../../_components/chronicle";
import { CARD, Eyebrow, Fact, LedgerLine, Monogram, Panel } from "../../_components/kit";
import { Money } from "../../_components/money";
import { ageInDays, formatAgeing } from "../../_lib/dates";
import { DocumentViewer } from "./_components/document-viewer";
import { FinancingPanel } from "./_components/financing-panel";
import { ReviewActions } from "./_components/review-actions";

export const metadata: Metadata = { title: "Invoice review" };

const DAY_MS = 24 * 60 * 60 * 1000;

const HISTORY: Record<ApprovalAction, { title: string; icon: LucideIcon; tone: ChronicleTone }> = {
  SUBMITTED: { title: "Submitted by channel partner", icon: Send, tone: "muted" },
  UNDER_REVIEW: { title: "Review started", icon: Eye, tone: "basalt" },
  CLARIFICATION_REQUESTED: { title: "Clarification requested", icon: MessageSquareWarning, tone: "amber" },
  RESUBMITTED: { title: "Clarification provided", icon: FileUp, tone: "kota" },
  APPROVED: { title: "Approved", icon: BadgeCheck, tone: "leaf" },
  REJECTED: { title: "Rejected", icon: XCircle, tone: "rose" },
};

async function loadInvoice(actor: Actor, id: string): Promise<InvoiceDetail> {
  try {
    return await getInvoiceDetail(actor, id);
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

function Quote({ children, className }: { children: ReactNode; className?: string }) {
  return <blockquote className={cn("border-l-2 border-line-strong/60 pl-3.5 font-display text-[1.0625rem] leading-snug text-fg-soft italic", className)}>{children}</blockquote>;
}

function DecisionSummary({ invoice }: { invoice: InvoiceDetail }) {
  const decision = [...invoice.approvals].reverse().find((a) => a.action === "APPROVED" || a.action === "REJECTED");
  const decidedBy = decision?.actorName;

  if (invoice.status === "ACCEPTED") {
    const approved = invoice.approvedAmountPaise ?? invoice.amountPaise;
    const shortfall = invoice.amountPaise - approved;
    return (
      <div>
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-leaf text-white ring-4 ring-leaf-100">
            <BadgeCheck className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <p className="font-display text-[1.375rem] leading-none font-normal text-leaf">Approved</p>
            <p className="mt-1 text-[0.75rem] text-muted-foreground">
              {formatDate(invoice.decidedAt)}
              {decidedBy ? ` · ${decidedBy}` : ""}
            </p>
          </div>
        </div>
        <div className="mt-5 rounded-lg border border-leaf/15 bg-leaf-100/40 px-4 py-4">
          <p className="text-[0.625rem] font-semibold tracking-[0.16em] text-leaf/80 uppercase">Approved amount</p>
          <Money paise={approved} size="xl" className="mt-2 font-medium text-leaf" />
          {shortfall > 0n && (
            <p className="mt-2 text-[0.75rem] text-leaf/80">
              Partial approval · <Money paise={shortfall} className="text-[0.75rem]" /> less than invoiced
            </p>
          )}
        </div>
        {invoice.latestReviewNote && <Quote className="mt-5">{invoice.latestReviewNote}</Quote>}
        {decision?.action === "APPROVED" && (
          <MatchAttestationSummary attestation={decision.attestation} attestedByName={decision.attestedByName} attestedAt={decision.attestedAt} className="mt-5" />
        )}
        <p className="mt-5 text-[0.75rem] leading-relaxed text-muted-foreground">Eligible for early payment from Veefin while the due date is in the future.</p>
      </div>
    );
  }
  if (invoice.status === "REJECTED") {
    return (
      <div>
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-[#ff7b6e] text-white ring-4 ring-[rgba(255,123,110,0.14)]">
            <XCircle className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <p className="font-display text-[1.375rem] leading-none font-normal text-[#ff8c80]">Rejected</p>
            <p className="mt-1 text-[0.75rem] text-muted-foreground">
              {formatDate(invoice.decidedAt)}
              {decidedBy ? ` · ${decidedBy}` : ""}
            </p>
          </div>
        </div>
        {invoice.latestReviewNote && <Quote className="mt-5">{invoice.latestReviewNote}</Quote>}
        <p className="mt-5 text-[0.75rem] leading-relaxed text-muted-foreground">The channel partner has been shown your reason.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-[rgba(255,179,107,0.14)] text-[#ffb36b] ring-4 ring-[rgba(255,255,255,0.05)]">
          <MessageSquareText className="size-5" strokeWidth={1.75} />
        </span>
        <div>
          <p className="font-display text-[1.375rem] leading-none font-normal text-fg">With the partner</p>
          <p className="mt-1 text-[0.75rem] text-muted-foreground">Waiting for {invoice.cp.name}</p>
        </div>
      </div>
      {invoice.latestReviewNote && (
        <div className="mt-5">
          <p className="mb-2 text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Your request</p>
          <Quote>{invoice.latestReviewNote}</Quote>
        </div>
      )}
      <p className="mt-5 text-[0.75rem] leading-relaxed text-muted-foreground">The invoice returns to your inbox when the partner responds. No action is needed until then.</p>
    </div>
  );
}

export default async function InvoiceReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireWorkspace("builder");
  const { id } = await params;
  const invoice = await loadInvoice(actor, id);
  const [empanelment, flags, policy] = await Promise.all([
    getBuilderEmpanelment(actor, invoice.cpId),
    listDuplicateFlags(actor, { invoiceId: invoice.id }),
    getMatchPolicy(invoice.builderId),
  ]);
  const openFlags = flags.filter((f) => f.status === "OPEN").length;
  const now = new Date();

  const creditPeriodDays = empanelment?.creditPeriodDays ?? null;
  const originalDueDate = invoice.dueDate ?? new Date(invoice.invoiceDate.getTime() + (creditPeriodDays ?? 60) * DAY_MS);
  const reviewable = invoice.status === "SUBMITTED" || invoice.status === "UNDER_REVIEW";
  const clarifications = invoice.approvals.filter((a) => a.action === "CLARIFICATION_REQUESTED" || a.action === "RESUBMITTED");
  const back = invoice.status === "ACCEPTED" ? { href: "/builder/approved", label: "Approved invoices" } : { href: "/builder/approvals", label: "Invoice approvals" };
  const taxable = invoice.gstAmountPaise !== null ? invoice.amountPaise - invoice.gstAmountPaise : null;

  return (
    <>
      <header className="mb-6 animate-fade-up sm:mb-8">
        <Link href={back.href} className="mb-5 inline-flex items-center gap-1 text-[0.75rem] font-medium tracking-wide text-muted-foreground transition-colors hover:text-fg">
          <ChevronLeft className="size-3.5" />
          {back.label}
        </Link>
        <div className="flex flex-col gap-6 border-b border-[rgba(255,255,255,0.1)] pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <Eyebrow className="mb-3">
              Invoice review <span className="font-mono tracking-normal normal-case">{invoice.reference}</span>
            </Eyebrow>
            <h1 className="text-[2.25rem] leading-[1.05] font-semibold text-fg sm:text-[2.875rem]">{invoice.invoiceNumber}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge kind="invoice" status={invoice.status} />
              {invoice.status === "ACCEPTED" && <StatusBadge kind="financing" status={invoice.financingStatus} />}
            </div>
          </div>
          <div className="lg:text-right">
            <p className="text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Invoice amount · incl. GST</p>
            <Money paise={invoice.amountPaise} size="hero" className="mt-2 font-light text-fg" />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 pt-6 sm:grid-cols-3 xl:grid-cols-6">
          <div className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-1 xl:col-span-2">
            <Monogram name={invoice.cp.name} />
            <Fact label="Channel partner">{invoice.cp.name}</Fact>
          </div>
          <Fact label="Project">
            {invoice.project.name}
            <span className="block text-[0.75rem] text-muted-foreground">{invoice.project.city}</span>
          </Fact>
          <Fact label="Invoice date">{formatDate(invoice.invoiceDate)}</Fact>
          <Fact label="Original due date">
            {formatDate(originalDueDate)}
            {!invoice.dueDate && <span className="block text-[0.75rem] text-muted-foreground">{creditPeriodDays ?? 60}-day credit period</span>}
          </Fact>
          <Fact label="Submitted">
            {formatAgeing(invoice.submittedAt, now)}
            {reviewable && <AgeingMeter days={ageInDays(invoice.submittedAt, now)} label={false} className="mt-1.5 flex" />}
          </Fact>
        </dl>
      </header>

      <div className="grid gap-6 sm:gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
        <aside className="space-y-6 sm:space-y-8 xl:sticky xl:top-24 xl:col-start-2 xl:row-start-1 xl:self-start">
          <section className={cn(CARD, "animate-fade-up overflow-hidden")} aria-labelledby="decision-title">
            <div className={cn("h-1", reviewable ? "bg-gradient-to-r from-haze/40 via-haze to-haze/40" : invoice.status === "ACCEPTED" ? "bg-leaf" : invoice.status === "REJECTED" ? "bg-[#ff7b6e]" : "bg-[#ffb36b]")} />
            <div className="px-5 py-6 sm:px-7">
              <p className="text-[0.625rem] font-semibold tracking-[0.18em] text-fg-muted uppercase">Your decision</p>
              {reviewable ? (
                <>
                  <h2 id="decision-title" className="mt-1.5 text-[1.625rem] leading-tight font-semibold text-fg">
                    Review &amp; decide
                  </h2>
                  <p className="mt-1 text-[0.75rem] text-muted-foreground">Submitted {formatDateTime(invoice.submittedAt)}</p>
                  <div className="my-6 border-y border-[rgba(255,255,255,0.07)] py-4">
                    <LedgerLine label="For approval" hint={`${invoice.cp.name}`} value={<Money paise={invoice.amountPaise} size="lg" className="font-medium" />} className="py-0" />
                  </div>
                  <ReviewActions
                    invoiceId={invoice.id}
                    invoiceNumber={invoice.invoiceNumber}
                    cpName={invoice.cp.name}
                    amountPaise={invoice.amountPaise.toString()}
                    status={invoice.status as "SUBMITTED" | "UNDER_REVIEW"}
                    matchItems={describeMatchItems(invoice)}
                    matchRequired={policy.required}
                    openDuplicates={openFlags}
                  />
                  <p className="mt-5 flex gap-2.5 rounded-lg bg-glass/80 px-3.5 py-3 text-[0.75rem] leading-relaxed text-fg-soft/80">
                    <ShieldCheck className="mt-px size-4 shrink-0 text-leaf" />
                    Approval makes this invoice eligible for early payment from Veefin. Your due date and credit terms do not change.
                  </p>
                </>
              ) : (
                <div className="mt-4">
                  <h2 id="decision-title" className="sr-only">
                    Decision
                  </h2>
                  <DecisionSummary invoice={invoice} />
                </div>
              )}
            </div>
          </section>

          {clarifications.length > 0 && (
            <Panel eyebrow="Correspondence" title="Clarifications" description="Your questions and the channel partner's responses">
              <ol className="space-y-4">
                {clarifications.map((entry) => {
                  const fromBuilder = entry.action === "CLARIFICATION_REQUESTED";
                  return (
                    <li key={entry.id} className={fromBuilder ? "mr-8" : "ml-8"}>
                      <div className={cn("rounded-xl px-4 py-3", fromBuilder ? "rounded-tl-sm bg-[rgba(255,179,107,0.14)]/80" : "rounded-tr-sm bg-leaf-100/70")}>
                        <p className="text-[0.8125rem] leading-relaxed text-fg-soft">{entry.comment ?? "—"}</p>
                      </div>
                      <p className={cn("mt-1.5 text-[0.6875rem] text-muted-foreground", !fromBuilder && "text-right")}>
                        {fromBuilder ? "You asked" : `${invoice.cp.name} responded`} · {entry.actorName} · {formatDateTime(entry.createdAt)}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </Panel>
          )}

          <Panel eyebrow="Audit trail" title="Approval history">
            <Chronicle
              entries={invoice.approvals.map((a) => ({
                id: a.id,
                icon: HISTORY[a.action].icon,
                tone: HISTORY[a.action].tone,
                title:
                  a.action === "APPROVED" && invoice.approvedAmountPaise ? (
                    <>
                      {HISTORY[a.action].title} · <Money paise={invoice.approvedAmountPaise} className="font-medium text-leaf" />
                    </>
                  ) : (
                    HISTORY[a.action].title
                  ),
                when: formatDateTime(a.createdAt),
                meta: a.actorName,
                body: a.comment ?? undefined,
              }))}
            />
          </Panel>
        </aside>

        <div className="min-w-0 space-y-6 sm:space-y-8 xl:col-start-1 xl:row-start-1">
          {flags.length > 0 && (
            <Panel
              eyebrow="Integrity"
              title="Possible duplicates"
              description={openFlags ? "Review each match before you decide. Flags never block approval on their own." : "All matches have been reviewed."}
              flush
            >
              <DuplicateFlagList flags={toDuplicateFlagDtos(flags)} canResolve linkBase="/builder/invoices" />
            </Panel>
          )}

          <DocumentViewer documents={invoice.documents} invoiceNumber={invoice.invoiceNumber} />

          <Panel eyebrow="As submitted" title="Invoice particulars" description="Details captured from the channel partner's submission">
            <div className="grid gap-8 2xl:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] 2xl:gap-10">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:gap-x-8 lg:grid-cols-3 2xl:grid-cols-2">
                <Fact label="Channel partner">
                  {invoice.cp.name}
                  {invoice.cp.legalName !== invoice.cp.name && <span className="block text-[0.75rem] text-muted-foreground">{invoice.cp.legalName}</span>}
                </Fact>
                <Fact label="Partner GSTIN">{invoice.cp.gstin ? <span className="font-mono text-[0.8125rem]">{invoice.cp.gstin}</span> : "Not recorded"}</Fact>
                <Fact label="Project">
                  {invoice.project.name} <span className="font-mono text-[0.75rem] text-muted-foreground">{invoice.project.code}</span>
                  <span className="block text-[0.75rem] text-muted-foreground">
                    {[invoice.project.location, invoice.project.city].filter(Boolean).join(", ")}
                    {invoice.project.reraNumber ? ` · RERA ${invoice.project.reraNumber}` : ""}
                  </span>
                </Fact>
                <Fact label="Empanelment">
                  {empanelment ? (
                    <>
                      <span className="font-mono text-[0.8125rem]">{empanelment.empanelmentCode}</span>
                      <span className="block text-[0.75rem] text-muted-foreground">{empanelment.creditPeriodDays}-day credit period</span>
                    </>
                  ) : (
                    "Not empanelled"
                  )}
                </Fact>
                <Fact label="Invoice number">{invoice.invoiceNumber}</Fact>
                <Fact label="BrickFlow reference">
                  <span className="font-mono text-[0.8125rem]">{invoice.reference}</span>
                </Fact>
                <Fact label="Invoice date">{formatDate(invoice.invoiceDate)}</Fact>
                <Fact label="Due date">
                  {invoice.dueDate ? (
                    formatDate(invoice.dueDate)
                  ) : (
                    <>
                      {formatDate(originalDueDate)}
                      <span className="block text-[0.75rem] text-muted-foreground">Not stated; {creditPeriodDays ?? 60}-day credit period applies</span>
                    </>
                  )}
                </Fact>
                <Fact label="Submitted at" className="sm:col-span-2 lg:col-span-1 2xl:col-span-2">
                  {formatDateTime(invoice.submittedAt)} <span className="text-muted-foreground">({formatAgeing(invoice.submittedAt, now)})</span>
                </Fact>
              </dl>

              <div className="self-start rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.04)] px-5 py-2">
                <div className="divide-y divide-[rgba(255,255,255,0.07)]">
                  <LedgerLine label="Taxable value" value={taxable !== null ? <Money paise={taxable} /> : <span className="text-muted-foreground">—</span>} tone="muted" />
                  <LedgerLine label="GST" value={invoice.gstAmountPaise !== null ? <Money paise={invoice.gstAmountPaise} /> : <span className="text-[0.8125rem] text-muted-foreground">Not stated</span>} tone="muted" />
                  <LedgerLine label="Invoice total" value={<Money paise={invoice.amountPaise} size="lg" className="font-medium" />} />
                  <LedgerLine
                    label="Approved amount"
                    value={
                      invoice.approvedAmountPaise !== null ? (
                        <Money paise={invoice.approvedAmountPaise} size="lg" className="font-medium" />
                      ) : (
                        <span className="text-[0.8125rem] text-muted-foreground">{invoice.status === "REJECTED" ? "Rejected" : "Pending decision"}</span>
                      )
                    }
                    tone={invoice.approvedAmountPaise !== null ? "total" : "muted"}
                  />
                </div>
              </div>
            </div>
            {invoice.description && (
              <div className="mt-7 border-t border-[rgba(255,255,255,0.07)] pt-6">
                <p className="mb-2 text-[0.625rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Description</p>
                <p className="max-w-3xl font-display text-[1.1875rem] leading-snug text-fg-soft">{invoice.description}</p>
              </div>
            )}
          </Panel>

          <Panel eyebrow="Booking, agreement & tax" title="Brokerage particulars" description="As stated on the invoice, with the platform's arithmetic checks">
            <BrokerageParticulars invoice={invoice} />
          </Panel>

          {invoice.status === "ACCEPTED" && <FinancingPanel invoice={invoice} originalDueDate={originalDueDate} creditPeriodDays={creditPeriodDays} />}
        </div>
      </div>
    </>
  );
}
