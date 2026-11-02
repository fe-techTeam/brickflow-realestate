import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { AmountRow, DetailList, EmptyState, Section, Timeline, type TimelineEntry } from "@/components/common/panels";
import { DemoBadge, StatusBadge } from "@/components/common/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps, formatINR } from "@/lib/money";
import { FINANCING_STATUS, INVOICE_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { DomainError } from "@/server/errors";
import { effectiveSettlementStatus, getFinancingRequestDetail, parseOfferTerms } from "@/server/services/financing";

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

function toneFor(status: string): TimelineEntry["tone"] {
  if (status === "REJECTED") return "danger";
  if (status === "CLARIFICATION_REQUESTED") return "warning";
  if (POSITIVE.has(status)) return "success";
  if (status === "DISBURSEMENT_INITIATED" || status === "PENDING_APPROVAL") return "gold";
  return "default";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const request = await load(id);
  const { invoice, offer, programme, disbursement, settlement } = request;
  const terms = parseOfferTerms(offer.termsSnapshot);
  const rateChanged = programme.discountRateBps !== request.discountRateBps;

  const timeline: (TimelineEntry & { at: number })[] = [
    ...invoice.approvals.map((a) => ({
      id: `a-${a.id}`,
      at: a.createdAt.getTime(),
      title: `Invoice · ${INVOICE_STATUS[a.toStatus].label}`,
      meta: `${a.actorName} · ${formatDateTime(a.createdAt)}`,
      body: a.comment ?? undefined,
      tone: toneFor(a.toStatus),
    })),
    ...request.events.map((e) => ({
      id: `e-${e.id}`,
      at: e.createdAt.getTime(),
      title: `Financing · ${FINANCING_STATUS[e.toStatus].label}`,
      meta: `${e.actorName} · ${formatDateTime(e.createdAt)}`,
      body: e.note ?? undefined,
      tone: toneFor(e.toStatus),
    })),
  ].sort((a, b) => a.at - b.at);

  return (
    <>
      <PageHeader
        back={{ href: "/admin/transactions", label: "All transactions" }}
        eyebrow="Financing request"
        title={<span className="font-mono text-[1.75rem] sm:text-[2rem]">{request.reference}</span>}
        description={`${request.cp.name} → ${request.builder.name} · invoice ${invoice.invoiceNumber} (${invoice.project.name})`}
        actions={
          <>
            <StatusBadge kind="financing" status={request.status} />
            <DemoBadge />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Section
          className="lg:col-span-3"
          title="Calculation snapshot"
          description={`Frozen when the channel partner accepted offer ${offer.reference} on ${formatDateTime(request.acceptedAt)}.`}
        >
          <div className="divide-y divide-border/70">
            <AmountRow
              label="Builder-approved amount"
              value={formatINR(request.approvedAmountPaise)}
              hint={invoice.amountPaise !== request.approvedAmountPaise ? `Invoice total ${formatINR(invoice.amountPaise)}` : "Equal to the invoice total"}
            />
            <AmountRow label={`Discount at ${formatBps(request.discountRateBps)}`} value={`−${formatINR(request.discountAmountPaise)}`} tone="deduct" hint="Agreed programme rate at acceptance" />
            <AmountRow label="Other charges" value={formatINR(request.chargesPaise)} />
            <AmountRow label="Net payable to channel partner" value={formatINR(request.netPayablePaise)} tone="total" />
          </div>
          <div className="mt-4 rounded-md bg-muted/60 px-4 py-3 text-xs leading-relaxed text-slate-ink">
            <p>
              Programme <span className="font-mono font-medium text-navy">{terms.programmeCode}</span> · {terms.programmeName} · funded by {terms.financier}.
            </p>
            <p className="mt-1">
              {rateChanged
                ? `The programme rate is now ${formatBps(programme.discountRateBps)}. This request keeps its agreed ${formatBps(request.discountRateBps)} and is never repriced.`
                : `The programme rate is unchanged at ${formatBps(programme.discountRateBps)}.`}
            </p>
            <p className="mt-2 text-muted-foreground">Terms at acceptance: {terms.terms}</p>
          </div>
        </Section>

        <Section className="lg:col-span-2" title="Parties & invoice">
          <DetailList
            columns={1}
            items={[
              { label: "Channel partner", value: <Link className="text-navy hover:underline" href={`/admin/organisations/${request.cp.id}`}>{request.cp.name}</Link> },
              { label: "Builder", value: <Link className="text-navy hover:underline" href={`/admin/organisations/${request.builder.id}`}>{request.builder.name}</Link> },
              { label: "Financier", value: <Link className="text-navy hover:underline" href={`/admin/organisations/${request.financier.id}`}>{request.financier.name}</Link> },
              {
                label: "Invoice",
                value: (
                  <span>
                    <span className="font-mono text-xs">{invoice.invoiceNumber}</span> · {invoice.reference}
                  </span>
                ),
              },
              { label: "Invoice date · due date", value: `${formatDate(invoice.invoiceDate)} · ${formatDate(invoice.dueDate)}` },
              {
                label: "Statuses",
                value: (
                  <span className="flex flex-wrap gap-1.5">
                    <StatusBadge kind="invoice" status={invoice.status} />
                    <StatusBadge kind="financing" status={invoice.financingStatus} />
                  </span>
                ),
              },
              { label: "Decision", value: request.decidedAt ? `${formatDateTime(request.decidedAt)}${request.decisionNote ? ` · ${request.decisionNote}` : ""}` : "Awaiting Veefin decision" },
            ]}
          />
        </Section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Section title="Disbursement" description="Simulated payout to the channel partner. No real funds move." actions={<DemoBadge />}>
          {disbursement ? (
            <DetailList
              items={[
                { label: "Reference", value: <span className="font-mono text-xs">{disbursement.reference}</span> },
                { label: "Status", value: <StatusBadge kind="disbursement" status={disbursement.status} /> },
                { label: "Amount", value: formatINR(disbursement.amountPaise), emphasis: true },
                { label: "Mode", value: "Simulated transfer (demo)" },
                { label: "Beneficiary", value: disbursement.beneficiaryName },
                { label: "Account · IFSC", value: <span className="font-mono text-xs">{`${disbursement.beneficiaryAccount} · ${disbursement.beneficiaryIfsc}`}</span> },
                { label: "UTR", value: disbursement.utr ? <span className="font-mono text-xs">{disbursement.utr}</span> : "Pending confirmation" },
                { label: "Initiated · completed", value: `${formatDateTime(disbursement.initiatedAt)} · ${disbursement.completedAt ? formatDateTime(disbursement.completedAt) : "—"}` },
              ]}
            />
          ) : (
            <EmptyState title="Not disbursed yet" description="Veefin initiates the simulated payout after approving the request." className="py-8" />
          )}
        </Section>

        <Section title="Builder settlement" description="The builder repays the full approved amount to Veefin on the original due date.">
          {settlement ? (
            <DetailList
              items={[
                { label: "Status", value: <StatusBadge kind="settlement" status={effectiveSettlementStatus(settlement)} /> },
                { label: "Amount", value: formatINR(settlement.amountPaise), emphasis: true },
                { label: "Due date", value: formatDate(settlement.dueDate) },
                { label: "Settled on", value: settlement.settledAt ? formatDateTime(settlement.settledAt) : "—" },
                { label: "Reference", value: settlement.reference ? <span className="font-mono text-xs">{settlement.reference}</span> : "—" },
                { label: "Note", value: settlement.note ?? "—" },
              ]}
            />
          ) : (
            <EmptyState title="No settlement yet" description="A settlement obligation opens when the disbursement is confirmed." className="py-8" />
          )}
        </Section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Section className="lg:col-span-3" title="Timeline" description="Invoice review and financing events in order.">
          {timeline.length === 0 ? <EmptyState title="No events recorded" className="py-8" /> : <Timeline entries={timeline} />}
        </Section>

        <div className="grid content-start gap-6 lg:col-span-2">
          <Section title="Internal comments" description="Notes recorded by the Veefin team.">
            {!request.comments || request.comments.length === 0 ? (
              <EmptyState icon={MessageSquare} title="No comments" className="py-8" />
            ) : (
              <ul className="space-y-4">
                {request.comments.map((c) => (
                  <li key={c.id} className="rounded-md border border-border/70 bg-ivory/40 px-4 py-3">
                    <p className="text-sm whitespace-pre-line text-slate-ink">{c.body}</p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {c.authorName} · {formatDateTime(c.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Invoice documents">
            {invoice.documents.length === 0 ? (
              <EmptyState icon={FileText} title="No documents" className="py-8" />
            ) : (
              <ul className="divide-y divide-border/70">
                {invoice.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <a href={`/api/documents/invoices/${d.id}`} target="_blank" rel="noopener" className="block truncate text-sm font-medium text-navy hover:underline">
                        {d.fileName}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(d.sizeBytes)} · uploaded {formatDateTime(d.createdAt)}
                      </p>
                    </div>
                    <a href={`/api/documents/invoices/${d.id}?download=1`} className="shrink-0 text-xs font-medium text-navy hover:underline">
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
