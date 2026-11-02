import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, ArrowRight, BadgePercent, CheckCircle2, Clock3, FileStack, FileUp, HandCoins, Sparkles, Wallet } from "lucide-react";
import { DataTable, Td, Th, Tr } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps, formatINR, formatINRCompact } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { toOfferDto } from "@/server/dto";
import { getPartnerOverview } from "@/server/queries/partner";
import { InvoiceValueChart } from "./_components/invoice-value-chart";
import { OfferLauncher } from "./_components/offer-center";
import { offerInvoice } from "./_components/summaries";

export const metadata: Metadata = { title: "Overview" };

function rateLabel(bps: number | undefined): string {
  return bps === undefined ? "" : ` · ${formatBps(bps)} agreed rate`;
}

export default async function PartnerOverviewPage() {
  const actor = await requireWorkspace("partner");
  const overview = await getPartnerOverview(actor);
  const { stats } = overview;
  const firstName = actor.name.split(/\s+/)[0];
  const actionCount = overview.clarifications.length + overview.openOffers.length + overview.eligibleWithoutOffer.length;

  return (
    <>
      <PageHeader
        eyebrow="Channel partner overview"
        title={`Welcome back, ${firstName}`}
        description="Track brokerage invoices from submission to builder approval, and turn approved invoices into early payment at your builder's agreed rate."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/partner/offers">
                <BadgePercent />
                Financing offers
              </Link>
            </Button>
            <Button asChild>
              <Link href="/partner/invoices/new">
                <FileUp />
                Upload invoice
              </Link>
            </Button>
          </>
        }
      />

      <StatGrid className="mb-8">
        <StatCard label="Total invoice amount" value={formatINRCompact(stats.totalInvoiceAmount)} hint={`${stats.invoiceCount} invoices submitted`} icon={FileStack} href="/partner/invoices" />
        <StatCard
          label="Pending approvals"
          value={stats.pendingCount}
          hint={`${formatINRCompact(stats.pendingAmount)} awaiting builder decision`}
          icon={Clock3}
          tone="slate"
          href="/partner/invoices?status=pending"
        />
        <StatCard
          label="Approved invoices"
          value={stats.approvedCount}
          hint={`${formatINRCompact(stats.approvedAmount)} approved by builders`}
          icon={CheckCircle2}
          tone="heritage"
          href="/partner/invoices?status=ACCEPTED"
        />
        <StatCard
          label="Eligible for early payment"
          value={formatINRCompact(stats.eligibleAmount)}
          hint={`${stats.eligibleCount} ${stats.eligibleCount === 1 ? "invoice" : "invoices"} ready to discount`}
          icon={Sparkles}
          tone="gold"
          href="/partner/offers"
        />
        <StatCard label="Total financed" value={formatINRCompact(stats.financedAmount)} hint={`${stats.financedCount} financing requests`} icon={HandCoins} href="/partner/transactions" />
        <StatCard
          label="Total received"
          value={formatINRCompact(stats.receivedAmount)}
          hint={`${stats.receivedCount} simulated ${stats.receivedCount === 1 ? "payout" : "payouts"}`}
          icon={Wallet}
          tone="heritage"
          href="/partner/disbursements"
        />
      </StatGrid>

      <div className="mb-8 grid gap-6 xl:grid-cols-5">
        <Section
          className="xl:col-span-2"
          title="Action needed"
          description={actionCount ? `${actionCount} ${actionCount === 1 ? "item needs" : "items need"} your attention` : "Nothing waiting on you"}
          bodyClassName="p-0"
        >
          {actionCount === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="You're all caught up"
              description="New clarification requests and early payment opportunities will appear here."
              action={
                <Button variant="outline" size="sm" asChild>
                  <Link href="/partner/invoices/new">Upload an invoice</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border/70">
              {overview.clarifications.map((invoice) => (
                <li key={invoice.id} className="flex items-start gap-3 px-5 py-4 sm:px-6">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#fbf1df] text-[#8a5a12]">
                    <AlertCircle className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-navy">Clarification requested · {invoice.invoiceNumber}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{invoice.latestReviewNote ?? `${invoice.builder.name} has asked for more information.`}</p>
                    <Button variant="outline" size="sm" asChild className="mt-3">
                      <Link href={`/partner/invoices/${invoice.id}#respond`}>Respond</Link>
                    </Button>
                  </div>
                </li>
              ))}
              {overview.openOffers.map((offer) => (
                <li key={offer.id} className="flex items-start gap-3 px-5 py-4 sm:px-6">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-gold-100 text-gold-600">
                    <BadgePercent className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-navy">
                      Open offer · {offer.invoice.invoiceNumber} · <span className="tabular text-heritage">{formatINR(offer.netPayablePaise)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatBps(offer.discountRateBps)} discount · valid until {formatDateTime(offer.validUntil)}
                    </p>
                    <OfferLauncher invoice={offerInvoice(offer.invoice)} offer={toOfferDto(offer)} label="Review offer" variant="outline" className="mt-3" />
                  </div>
                </li>
              ))}
              {overview.eligibleWithoutOffer.map((invoice) => (
                <li key={invoice.id} className="flex items-start gap-3 px-5 py-4 sm:px-6">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sage text-heritage">
                    <Sparkles className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-navy">Eligible for early payment · {invoice.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {invoice.builder.name} approved <span className="tabular">{formatINR(invoice.approvedAmountPaise ?? 0n)}</span>
                      {rateLabel(overview.eligibility.get(invoice.id)?.programme?.discountRateBps)}
                    </p>
                    <OfferLauncher invoice={offerInvoice(invoice)} className="mt-3" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section className="xl:col-span-3" title="Invoice value by month" description="By invoice date, last six months">
          <InvoiceValueChart data={overview.monthly} />
        </Section>
      </div>

      <Section
        title="Recent invoices"
        description="Your latest submissions and their status"
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/partner/invoices">
              View all
              <ArrowRight />
            </Link>
          </Button>
        }
        bodyClassName="py-0"
      >
        {overview.recentInvoices.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title="No invoices yet"
            description="Upload your first brokerage invoice to send it to the builder for approval."
            action={
              <Button asChild size="sm">
                <Link href="/partner/invoices/new">Upload invoice</Link>
              </Button>
            }
          />
        ) : (
          <DataTable minWidth={760}>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Builder · Project</Th>
                <Th>Invoice date</Th>
                <Th align="right">Amount</Th>
                <Th>Invoice status</Th>
                <Th>Financing</Th>
              </tr>
            </thead>
            <tbody>
              {overview.recentInvoices.map((invoice) => (
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
                  <Td className="whitespace-nowrap">{formatDate(invoice.invoiceDate)}</Td>
                  <Td align="right">{formatINR(invoice.amountPaise)}</Td>
                  <Td>
                    <StatusBadge kind="invoice" status={invoice.status} />
                  </Td>
                  <Td>
                    <StatusBadge kind="financing" status={invoice.financingStatus} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>
    </>
  );
}
