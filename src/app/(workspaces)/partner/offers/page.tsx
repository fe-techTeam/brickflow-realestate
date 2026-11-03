import type { Metadata } from "next";
import Link from "next/link";
import { BadgePercent, CalendarClock, History, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { calculateDiscount } from "@/lib/financing";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps, sumPaise } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { toOfferDto } from "@/server/dto";
import { getPartnerOffers } from "@/server/queries/partner";
import { CompactMoney, Money } from "../_components/money";
import { OfferLauncher } from "../_components/offer-center";
import { offerInvoice } from "../_components/summaries";
import { RefCell, Table, Td, Th, Tr } from "../_components/table";
import { EmptyNote, MetricStrip, PageIntro, Panel, StatusMark } from "../_components/ui";

export const metadata: Metadata = { title: "Financing Offers" };

export default async function FinancingOffersPage() {
  const actor = await requireWorkspace("partner");
  const { open, history, eligibleWithoutOffer, eligibility } = await getPartnerOffers(actor);
  const now = new Date();

  const previews = eligibleWithoutOffer.map((invoice) => {
    const programme = eligibility.get(invoice.id)?.programme;
    return { invoice, programme, preview: programme && invoice.approvedAmountPaise ? calculateDiscount(invoice.approvedAmountPaise, programme.discountRateBps) : null };
  });
  const availableNet = sumPaise([...open.map((o) => o.netPayablePaise), ...previews.map((p) => p.preview?.netPayablePaise)]);
  const accepted = history.filter((o) => o.status === "ACCEPTED");

  return (
    <>
      <PageIntro
        eyebrow="Early payment"
        title="Financing Offers"
        description="Offers are priced at the fixed discount rate agreed between Veefin and each builder. Review an offer, give consent and receive the net amount early."
      />

      <MetricStrip
        className="mb-8"
        items={[
          { label: "Available to receive", value: <CompactMoney paise={availableNet} size="xl" />, hint: "Net of agreed discounts", accent: "gold" },
          { label: "Open offers", value: <span className="text-[1.875rem] leading-none font-normal tabular">{open.length}</span>, hint: "Awaiting your decision" },
          {
            label: "Eligible invoices",
            value: <span className="text-[1.875rem] leading-none font-normal tabular">{eligibleWithoutOffer.length}</span>,
            hint: "Builder-approved, no offer yet",
            accent: "heritage",
          },
          {
            label: "Accepted to date",
            value: <CompactMoney paise={sumPaise(accepted.map((o) => o.netPayablePaise))} size="xl" />,
            hint: `${accepted.length} ${accepted.length === 1 ? "offer" : "offers"} accepted`,
            accent: "slate",
          },
        ]}
      />

      <div className="flex flex-col gap-6">
        <Panel eyebrow="Awaiting your decision" title="Open offers" bodyClassName={open.length ? "pb-7" : undefined}>
          {open.length === 0 ? (
            <EmptyNote
              compact
              icon={BadgePercent}
              title="No open offers"
              description={eligibleWithoutOffer.length ? "Generate an offer on one of your eligible invoices below." : "Offers appear here once you request a discounted amount on an approved invoice."}
            />
          ) : (
            <ul className="grid gap-5 md:grid-cols-2">
              {open.map((offer) => (
                <li key={offer.id} className="relative flex flex-col overflow-hidden rounded-xl border border-gold/40 bg-[linear-gradient(180deg,#fcf8ef_0%,#ffffff_55%)]">
                  <div aria-hidden="true" className="h-[3px] bg-linear-to-r from-gold/30 via-gold to-gold/30" />
                  <div className="flex flex-1 flex-col p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-gold-700 uppercase">{offer.reference}</p>
                        <Link href={`/partner/invoices/${offer.invoiceId}`} className="mt-1.5 block font-display text-[1.375rem] leading-tight font-medium text-navy hover:underline">
                          {offer.invoice.invoiceNumber}
                        </Link>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {offer.invoice.builder.name} · {offer.invoice.project.name}
                        </p>
                      </div>
                      <StatusMark kind="offer" status="OFFERED" className="text-xs" />
                    </div>

                    <div className="mt-6">
                      <p className="text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Net receivable</p>
                      <Money paise={offer.netPayablePaise} size="xl" className="mt-2 block font-medium text-navy" />
                    </div>

                    <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-hairline pt-4 text-[0.8125rem]">
                      <div>
                        <dt className="text-xs text-muted-foreground">Builder-approved</dt>
                        <dd className="mt-0.5 font-medium text-navy">
                          <Money paise={offer.approvedAmountPaise} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Discount · {formatBps(offer.discountRateBps)}</dt>
                        <dd className="mt-0.5 font-medium text-danger">
                          <Money paise={offer.discountAmountPaise} sign="minus" />
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-6">
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarClock className="size-3.5 text-gold-700" />
                        Valid until {formatDateTime(offer.validUntil)}
                      </p>
                      <OfferLauncher invoice={offerInvoice(offer.invoice)} offer={toOfferDto(offer)} label="Review & accept" variant="success" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel eyebrow="Ready now" title="Eligible invoices" description="Builder-approved invoices you can discount today" bodyClassName="pb-0">
          {previews.length === 0 ? (
            <div className="-mx-5 border-t border-hairline sm:-mx-7">
              <EmptyNote
                compact
                icon={Sparkles}
                title="Nothing eligible right now"
                description="When a builder approves one of your invoices it will appear here, ready for early payment."
                action={
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/partner/invoices">View my invoices</Link>
                  </Button>
                }
              />
            </div>
          ) : (
            <Table minWidth={900}>
              <thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Builder · Project</Th>
                  <Th>Due date</Th>
                  <Th align="right">Approved</Th>
                  <Th align="right">Agreed rate</Th>
                  <Th align="right">Indicative net</Th>
                  <Th align="right">
                    <span className="sr-only">Action</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {previews.map(({ invoice, programme, preview }) => (
                  <Tr key={invoice.id}>
                    <Td>
                      <RefCell href={`/partner/invoices/${invoice.id}`} primary={invoice.invoiceNumber} secondary={invoice.reference} />
                    </Td>
                    <Td>
                      <p className="text-[0.8125rem] text-navy">{invoice.builder.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{invoice.project.name}</p>
                    </Td>
                    <Td className="text-[0.8125rem] whitespace-nowrap">{invoice.dueDate ? formatDate(invoice.dueDate) : "Credit period"}</Td>
                    <Td align="right">
                      <Money paise={invoice.approvedAmountPaise ?? 0n} className="text-navy" />
                    </Td>
                    <Td align="right" className="text-[0.8125rem]">
                      {programme ? formatBps(programme.discountRateBps) : "—"}
                    </Td>
                    <Td align="right">{preview ? <Money paise={preview.netPayablePaise} className="font-semibold text-heritage" /> : "—"}</Td>
                    <Td align="right">
                      <OfferLauncher invoice={offerInvoice(invoice)} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel eyebrow="Record" title="Offer history" description="Accepted, expired and superseded offers" bodyClassName="pb-0">
          {history.length === 0 ? (
            <div className="-mx-5 border-t border-hairline sm:-mx-7">
              <EmptyNote compact icon={History} title="No offer history yet" description="Accepted, expired and withdrawn offers will be listed here." />
            </div>
          ) : (
            <Table minWidth={960}>
              <thead>
                <tr>
                  <Th>Offer</Th>
                  <Th>Invoice</Th>
                  <Th>Generated</Th>
                  <Th align="right">Approved</Th>
                  <Th align="right">Rate</Th>
                  <Th align="right">Net payable</Th>
                  <Th>Outcome</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((offer) => {
                  const status = offer.status === "OFFERED" && offer.validUntil <= now ? "EXPIRED" : offer.status;
                  return (
                    <Tr key={offer.id}>
                      <Td>
                        <RefCell primary={offer.reference} />
                      </Td>
                      <Td>
                        <RefCell href={`/partner/invoices/${offer.invoiceId}`} primary={offer.invoice.invoiceNumber} secondary={offer.invoice.builder.name} />
                      </Td>
                      <Td className="text-[0.8125rem] whitespace-nowrap">{formatDateTime(offer.generatedAt)}</Td>
                      <Td align="right">
                        <Money paise={offer.approvedAmountPaise} />
                      </Td>
                      <Td align="right" className="text-[0.8125rem]">
                        {formatBps(offer.discountRateBps)}
                      </Td>
                      <Td align="right">
                        <Money paise={offer.netPayablePaise} className="font-medium text-navy" />
                      </Td>
                      <Td>
                        <StatusMark kind="offer" status={status} />
                        <p className="mt-1 text-xs text-muted-foreground">
                          {status === "ACCEPTED"
                            ? formatDateTime(offer.acceptedAt)
                            : status === "EXPIRED"
                              ? `Expired ${formatDateTime(offer.validUntil)}`
                              : "Replaced by a newer offer"}
                        </p>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
