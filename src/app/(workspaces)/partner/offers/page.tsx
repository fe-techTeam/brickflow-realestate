import type { Metadata } from "next";
import Link from "next/link";
import { BadgePercent, CalendarClock, History, Sparkles } from "lucide-react";
import { DataTable, Td, Th, Tr } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { calculateDiscount } from "@/lib/financing";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps, formatINR } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { toOfferDto } from "@/server/dto";
import { getPartnerOffers } from "@/server/queries/partner";
import { OfferLauncher } from "../_components/offer-center";
import { offerInvoice } from "../_components/summaries";

export const metadata: Metadata = { title: "Financing Offers" };

export default async function FinancingOffersPage() {
  const actor = await requireWorkspace("partner");
  const { open, history, eligibleWithoutOffer, eligibility } = await getPartnerOffers(actor);
  const now = new Date();

  return (
    <>
      <PageHeader
        eyebrow="Early payment"
        title="Financing Offers"
        description="Offers are priced at the fixed discount rate agreed between Veefin and each builder. Review an offer, give consent and receive the net amount early."
      />

      <div className="flex flex-col gap-6">
        <Section title="Open offers" description="Awaiting your decision" bodyClassName={open.length ? "p-0" : undefined}>
          {open.length === 0 ? (
            <EmptyState
              icon={BadgePercent}
              title="No open offers"
              description={eligibleWithoutOffer.length ? "Generate an offer on one of your eligible invoices below." : "Offers appear here once you request a discounted amount on an approved invoice."}
            />
          ) : (
            <ul className="grid gap-px bg-border/70 md:grid-cols-2">
              {open.map((offer) => (
                <li key={offer.id} className="flex flex-col gap-4 bg-card p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="eyebrow text-gold-600">{offer.reference}</p>
                      <Link href={`/partner/invoices/${offer.invoiceId}`} className="mt-1 block font-display text-xl font-semibold text-navy hover:underline">
                        {offer.invoice.invoiceNumber}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {offer.invoice.builder.name} · {offer.invoice.project.name}
                      </p>
                    </div>
                    <StatusBadge kind="offer" status="OFFERED" />
                  </div>
                  <dl className="grid grid-cols-3 gap-3 rounded-md bg-ivory/60 p-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Approved</dt>
                      <dd className="tabular mt-0.5 font-medium text-navy">{formatINR(offer.approvedAmountPaise)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Discount ({formatBps(offer.discountRateBps)})</dt>
                      <dd className="tabular mt-0.5 font-medium text-[#93342a]">− {formatINR(offer.discountAmountPaise)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Net payable</dt>
                      <dd className="tabular mt-0.5 font-semibold text-heritage">{formatINR(offer.netPayablePaise)}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarClock className="size-3.5" />
                      Valid until {formatDateTime(offer.validUntil)}
                    </p>
                    <OfferLauncher invoice={offerInvoice(offer.invoice)} offer={toOfferDto(offer)} label="Review & accept" variant="success" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Eligible invoices" description="Builder-approved invoices you can discount now" bodyClassName="py-0">
          {eligibleWithoutOffer.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No eligible invoices without an offer"
              description="When a builder approves one of your invoices it will appear here, ready for early payment."
              action={
                <Button variant="outline" size="sm" asChild>
                  <Link href="/partner/invoices">View my invoices</Link>
                </Button>
              }
            />
          ) : (
            <DataTable minWidth={880}>
              <thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Builder · Project</Th>
                  <Th>Due date</Th>
                  <Th align="right">Approved amount</Th>
                  <Th align="right">Agreed rate</Th>
                  <Th align="right">Indicative net</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {eligibleWithoutOffer.map((invoice) => {
                  const programme = eligibility.get(invoice.id)?.programme;
                  const preview = programme && invoice.approvedAmountPaise ? calculateDiscount(invoice.approvedAmountPaise, programme.discountRateBps) : null;
                  return (
                    <Tr key={invoice.id}>
                      <Td>
                        <Link href={`/partner/invoices/${invoice.id}`} className="font-medium text-navy hover:underline">
                          {invoice.invoiceNumber}
                        </Link>
                        <p className="text-xs whitespace-nowrap text-muted-foreground">{invoice.reference}</p>
                      </Td>
                      <Td>
                        <p>{invoice.builder.name}</p>
                        <p className="text-xs text-muted-foreground">{invoice.project.name}</p>
                      </Td>
                      <Td className="whitespace-nowrap">{invoice.dueDate ? formatDate(invoice.dueDate) : "Credit period"}</Td>
                      <Td align="right">{formatINR(invoice.approvedAmountPaise ?? 0n)}</Td>
                      <Td align="right">{programme ? formatBps(programme.discountRateBps) : "—"}</Td>
                      <Td align="right" className="font-medium text-heritage">
                        {preview ? formatINR(preview.netPayablePaise) : "—"}
                      </Td>
                      <Td align="right">
                        <OfferLauncher invoice={offerInvoice(invoice)} />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </Section>

        <Section title="Offer history" description="Accepted, expired and superseded offers" bodyClassName="py-0">
          {history.length === 0 ? (
            <EmptyState icon={History} title="No offer history yet" description="Accepted, expired and withdrawn offers will be listed here." />
          ) : (
            <DataTable minWidth={960}>
              <thead>
                <tr>
                  <Th>Offer</Th>
                  <Th>Invoice</Th>
                  <Th>Generated</Th>
                  <Th align="right">Approved</Th>
                  <Th align="right">Rate</Th>
                  <Th align="right">Net payable</Th>
                  <Th>Status</Th>
                  <Th>Outcome</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((offer) => {
                  const status = offer.status === "OFFERED" && offer.validUntil <= now ? "EXPIRED" : offer.status;
                  return (
                    <Tr key={offer.id}>
                      <Td className="font-medium whitespace-nowrap text-navy">{offer.reference}</Td>
                      <Td>
                        <Link href={`/partner/invoices/${offer.invoiceId}`} className="text-navy hover:underline">
                          {offer.invoice.invoiceNumber}
                        </Link>
                        <p className="text-xs text-muted-foreground">{offer.invoice.builder.name}</p>
                      </Td>
                      <Td className="whitespace-nowrap">{formatDateTime(offer.generatedAt)}</Td>
                      <Td align="right">{formatINR(offer.approvedAmountPaise)}</Td>
                      <Td align="right">{formatBps(offer.discountRateBps)}</Td>
                      <Td align="right">{formatINR(offer.netPayablePaise)}</Td>
                      <Td>
                        <StatusBadge kind="offer" status={status} />
                      </Td>
                      <Td className="text-xs text-muted-foreground">
                        {status === "ACCEPTED"
                          ? `Accepted ${formatDateTime(offer.acceptedAt)}`
                          : status === "EXPIRED"
                            ? `Expired ${formatDateTime(offer.validUntil)}`
                            : "Replaced by a newer offer"}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </Section>
      </div>
    </>
  );
}
