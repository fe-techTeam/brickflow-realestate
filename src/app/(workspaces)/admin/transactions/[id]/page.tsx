import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banknote, FileText, Landmark, MessageSquare, ShieldCheck } from "lucide-react";
import { DemoBadge, StatusBadge } from "@/components/common/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps, formatINR } from "@/lib/money";
import { FINANCING_STATUS, INVOICE_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { DomainError } from "@/server/errors";
import { effectiveSettlementStatus, getFinancingRequestDetail, parseOfferTerms } from "@/server/services/financing";
import { EventTimeline, type EventItem } from "../../_components/activity";
import { AdminHeader, Empty, FactList, Panel } from "../../_components/editorial";
import { GoldRule, Money, Rate } from "../../_components/figures";
import { RefCode } from "../../_components/ledger";

export const metadata: Metadata = { title: "Financing request" };

async function load(id: string) {
  const actor = await requireWorkspace("admin");
  try {
    return await getFinancingRequestDetail(actor, id);
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

const POSITIVE = new Set(["APPROVED", "DISBURSED", "ACCEPTED", "ACCEPTED_BY_CP"]);

function toneFor(status: string): EventItem["tone"] {
  if (status === "REJECTED") return "danger";
  if (status === "CLARIFICATION_REQUESTED" || status === "DISBURSEMENT_INITIATED" || status === "PENDING_APPROVAL") return "gold";
  if (POSITIVE.has(status)) return "heritage";
  return "navy";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function LedgerLine({ label, hint, children, total = false }: { label: string; hint?: string; children: ReactNode; total?: boolean }) {
  return (
    <div className={total ? "flex items-end justify-between gap-4 pt-5" : "flex items-baseline justify-between gap-4 py-3.5"}>
      <div>
        <p className={total ? "text-sm font-semibold text-navy" : "text-sm text-slate-ink"}>{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

const link = (href: string, label: string) => (
  <Link className="font-medium text-navy hover:underline" href={href}>
    {label}
  </Link>
);

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const request = await load(id);
  const { invoice, offer, programme, disbursement, settlement } = request;
  const terms = parseOfferTerms(offer.termsSnapshot);
  const rateChanged = programme.discountRateBps !== request.discountRateBps;

  const timeline: EventItem[] = [
    ...invoice.approvals.map((a) => ({
      id: `a-${a.id}`,
      at: a.createdAt,
      title: `Invoice · ${INVOICE_STATUS[a.toStatus].label}`,
      actor: a.actorName,
      body: a.comment ?? undefined,
      tone: toneFor(a.toStatus),
    })),
    ...request.events.map((e) => ({
      id: `e-${e.id}`,
      at: e.createdAt,
      title: `Financing · ${FINANCING_STATUS[e.toStatus].label}`,
      actor: e.actorName,
      body: e.note ?? undefined,
      tone: toneFor(e.toStatus),
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <>
      <AdminHeader
        back={{ href: "/admin/transactions", label: "All transactions" }}
        eyebrow="Financing request"
        title={<span className="font-sans text-[1.875rem] font-light tracking-[-0.02em] sm:text-[2.375rem]">{request.reference}</span>}
        lede={`${request.cp.name} → ${request.builder.name} · invoice ${invoice.invoiceNumber} (${invoice.project.name})`}
        meta={
          <>
            <StatusBadge kind="financing" status={request.status} />
            <DemoBadge />
            <span className="tabular">Accepted {formatDateTime(request.acceptedAt)}</span>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-12">
        <Panel
          className="lg:col-span-7"
          eyebrow="Frozen at acceptance"
          title="Calculation snapshot"
          description={`Recorded when the channel partner accepted offer ${offer.reference}.`}
        >
          <div className="grid gap-8 border-t border-border/70 pt-6 sm:grid-cols-[10rem_1fr]">
            <div>
              <p className="text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Agreed rate</p>
              <Rate bps={request.discountRateBps} size="xl" className="mt-2 block" />
              <GoldRule className="mt-4" />
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Programme <RefCode className="text-[0.6875rem]">{terms.programmeCode}</RefCode>
              </p>
            </div>
            <div className="divide-y divide-border/70">
              <LedgerLine
                label="Builder-approved amount"
                hint={invoice.amountPaise !== request.approvedAmountPaise ? `Invoice total ${formatINR(invoice.amountPaise)}` : "Equal to the invoice total"}
              >
                <Money paise={request.approvedAmountPaise} size="md" className="text-navy" />
              </LedgerLine>
              <LedgerLine label={`Discount at ${formatBps(request.discountRateBps)}`} hint="Agreed programme rate at acceptance">
                <Money paise={request.discountAmountPaise} size="md" sign="−" className="text-danger" />
              </LedgerLine>
              <LedgerLine label="Other charges" hint="None, by design">
                <Money paise={request.chargesPaise} size="md" className="text-navy" />
              </LedgerLine>
              <LedgerLine label="Net payable to channel partner" total>
                <Money paise={request.netPayablePaise} size="xl" className="text-heritage" />
              </LedgerLine>
            </div>
          </div>
          <div className="mt-6 flex gap-3 rounded-lg border-l-2 border-heritage bg-sage/40 px-4 py-3.5 text-xs leading-relaxed text-slate-ink">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-heritage" strokeWidth={1.6} aria-hidden="true" />
            <div>
              <p>
                {terms.programmeName} · funded by {terms.financier}.{" "}
                {rateChanged
                  ? `The programme rate is now ${formatBps(programme.discountRateBps)}. This request keeps its agreed ${formatBps(request.discountRateBps)} and is never repriced.`
                  : `The programme rate is unchanged at ${formatBps(programme.discountRateBps)}.`}
              </p>
              <p className="mt-1.5 text-muted-foreground">Terms at acceptance: {terms.terms}</p>
            </div>
          </div>
        </Panel>

        <Panel className="lg:col-span-5" eyebrow="Counterparties" title="Parties & invoice">
          <FactList
            facts={[
              { label: "Channel partner", value: link(`/admin/organisations/${request.cp.id}`, request.cp.name) },
              { label: "Builder", value: link(`/admin/organisations/${request.builder.id}`, request.builder.name) },
              { label: "Financier", value: link(`/admin/organisations/${request.financier.id}`, request.financier.name) },
              {
                label: "Invoice",
                value: (
                  <span>
                    <RefCode>{invoice.invoiceNumber}</RefCode> <span className="text-muted-foreground">· {invoice.reference}</span>
                  </span>
                ),
              },
              { label: "Invoice total", value: <Money paise={invoice.amountPaise} className="text-navy" /> },
              { label: "Invoice · due date", value: <span className="tabular">{`${formatDate(invoice.invoiceDate)} · ${formatDate(invoice.dueDate)}`}</span> },
              {
                label: "Statuses",
                value: (
                  <span className="flex flex-wrap gap-1.5">
                    <StatusBadge kind="invoice" status={invoice.status} />
                    <StatusBadge kind="financing" status={invoice.financingStatus} />
                  </span>
                ),
              },
              {
                label: "Decision",
                value: request.decidedAt ? `${formatDateTime(request.decidedAt)}${request.decisionNote ? ` · ${request.decisionNote}` : ""}` : "Awaiting Veefin decision",
              },
            ]}
          />
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel eyebrow="Payout" title="Disbursement" description="Simulated payout to the channel partner. No real funds move." actions={<DemoBadge />}>
          {disbursement ? (
            <FactList
              facts={[
                { label: "Amount", value: <Money paise={disbursement.amountPaise} size="lg" className="text-heritage" /> },
                { label: "Status", value: <StatusBadge kind="disbursement" status={disbursement.status} /> },
                { label: "Reference", value: <RefCode>{disbursement.reference}</RefCode> },
                { label: "Beneficiary", value: disbursement.beneficiaryName },
                { label: "Account · IFSC", value: <RefCode className="font-normal">{`${disbursement.beneficiaryAccount} · ${disbursement.beneficiaryIfsc}`}</RefCode> },
                { label: "UTR", value: disbursement.utr ? <RefCode>{disbursement.utr}</RefCode> : "Pending confirmation" },
                {
                  label: "Initiated · completed",
                  value: <span className="tabular">{`${formatDateTime(disbursement.initiatedAt)} · ${disbursement.completedAt ? formatDateTime(disbursement.completedAt) : "—"}`}</span>,
                },
              ]}
            />
          ) : (
            <Empty icon={Banknote} title="Not disbursed yet" description="Veefin initiates the simulated payout after approving the request." className="py-10" />
          )}
        </Panel>

        <Panel eyebrow="Repayment" title="Builder settlement" description="The builder repays the full approved amount to Veefin on the original due date.">
          {settlement ? (
            <FactList
              facts={[
                { label: "Amount", value: <Money paise={settlement.amountPaise} size="lg" className="text-navy" /> },
                { label: "Status", value: <StatusBadge kind="settlement" status={effectiveSettlementStatus(settlement)} /> },
                { label: "Due date", value: <span className="tabular">{formatDate(settlement.dueDate)}</span> },
                { label: "Settled on", value: settlement.settledAt ? <span className="tabular">{formatDateTime(settlement.settledAt)}</span> : "—" },
                { label: "Reference", value: settlement.reference ? <RefCode>{settlement.reference}</RefCode> : "—" },
                { label: "Note", value: settlement.note ?? "—" },
              ]}
            />
          ) : (
            <Empty icon={Landmark} title="No settlement yet" description="A settlement obligation opens when the disbursement is confirmed." className="py-10" />
          )}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <Panel className="lg:col-span-7" eyebrow="Chronology" title="Timeline" description="Invoice review and financing events in order.">
          {timeline.length === 0 ? <Empty title="No events recorded" className="py-10" /> : <EventTimeline events={timeline} />}
        </Panel>

        <div className="grid content-start gap-6 lg:col-span-5">
          <Panel eyebrow="Veefin" title="Internal comments" description="Notes recorded by the Veefin team.">
            {!request.comments || request.comments.length === 0 ? (
              <Empty icon={MessageSquare} title="No comments" className="py-10" />
            ) : (
              <ul className="space-y-4">
                {request.comments.map((c) => (
                  <li key={c.id} className="border-l-2 border-gold/60 pl-4">
                    <p className="text-sm leading-relaxed whitespace-pre-line text-slate-ink">{c.body}</p>
                    <p className="tabular mt-1.5 text-xs text-muted-foreground">
                      {c.authorName} · {formatDateTime(c.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel eyebrow="Evidence" title="Invoice documents">
            {invoice.documents.length === 0 ? (
              <Empty icon={FileText} title="No documents" className="py-10" />
            ) : (
              <ul className="divide-y divide-border/70 border-t border-border/70">
                {invoice.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-ivory text-gold-600 ring-1 ring-gold/25">
                        <FileText className="size-4" strokeWidth={1.5} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <a
                          href={`/api/documents/invoices/${d.id}`}
                          target="_blank"
                          rel="noopener"
                          className="block truncate text-sm font-medium text-navy hover:underline"
                        >
                          {d.fileName}
                        </a>
                        <p className="tabular text-xs text-muted-foreground">
                          {formatBytes(d.sizeBytes)} · uploaded {formatDateTime(d.createdAt)}
                        </p>
                      </div>
                    </div>
                    <a href={`/api/documents/invoices/${d.id}?download=1`} className="shrink-0 text-xs font-semibold text-navy hover:text-gold-600">
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
