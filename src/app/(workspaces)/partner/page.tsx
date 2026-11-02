import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, BadgePercent, CheckCircle2, FileStack, FileUp, MessageSquareWarning, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { calculateDiscount } from "@/lib/financing";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBps, formatINRCompact, sumPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { toOfferDto } from "@/server/dto";
import { getPartnerOverview } from "@/server/queries/partner";
import { InvoiceValueChart } from "./_components/invoice-value-chart";
import { CompactMoney, Money } from "./_components/money";
import { OfferLauncher } from "./_components/offer-center";
import { offerInvoice } from "./_components/summaries";
import { RefCell, Table, Td, Th, Tr } from "./_components/table";
import { EmptyNote, FacadePattern, PageIntro, Panel, StatusMark } from "./_components/ui";

export const metadata: Metadata = { title: "Overview" };

type Overview = Awaited<ReturnType<typeof getPartnerOverview>>;

function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export default async function PartnerOverviewPage() {
  const actor = await requireWorkspace("partner");
  const overview = await getPartnerOverview(actor);
  const { stats } = overview;
  const now = new Date();
  const firstName = actor.name.split(/\s+/)[0];
  const actionCount = overview.clarifications.length + overview.openOffers.length + overview.eligibleWithoutOffer.length;
  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(now);

  const opportunityCount = overview.openOffers.length + overview.eligibleWithoutOffer.length;

  return (
    <>
      <PageIntro
        eyebrow={today}
        title={`${greeting(now)}, ${firstName}`}
        description={
          <>
            Your portfolio holds {plural(stats.invoiceCount, "invoice")} worth <span className="font-medium whitespace-nowrap text-navy tabular">{formatINRCompact(stats.totalInvoiceAmount)}</span> across{" "}
            {plural(stats.builderCount, "builder")}
            {opportunityCount > 0
              ? `, with ${plural(opportunityCount, "invoice")} ready for early payment.`
              : overview.clarifications.length > 0
                ? `, and ${plural(overview.clarifications.length, "clarification")} awaiting your response.`
                : "."}
          </>
        }
        actions={
          <>
            <Button variant="outline" asChild className="h-10 bg-card px-4">
              <Link href="/partner/invoices">
                <FileStack />
                My invoices
              </Link>
            </Button>
            <Button asChild className="h-10 px-5">
              <Link href="/partner/invoices/new">
                <FileUp />
                Upload invoice
              </Link>
            </Button>
          </>
        }
      />

      <PortfolioHero overview={overview} />

      <div className="mt-8 grid gap-6 xl:grid-cols-12">
        <Panel
          eyebrow="Your queue"
          title="Action needed"
          description={actionCount ? `${plural(actionCount, "item needs", "items need")} your attention` : "Nothing is waiting on you"}
          className="flex flex-col xl:col-span-5"
          bodyClassName="flex flex-1 flex-col pb-0"
        >
          {actionCount === 0 ? (
            <EmptyNote
              compact
              icon={CheckCircle2}
              title="You're all caught up"
              description="Clarification requests and early payment opportunities will appear here."
            />
          ) : (
            <ul className="-mx-5 divide-y divide-[#f0ebe0] border-t border-[#ece6d8] sm:-mx-7">
              {overview.clarifications.map((invoice) => (
                <QueueItem
                  key={invoice.id}
                  tone="warning"
                  icon={MessageSquareWarning}
                  kicker="Clarification requested"
                  title={invoice.invoiceNumber}
                  meta={invoice.latestReviewNote ?? `${invoice.builder.name} has asked for more information.`}
                  amount={<Money paise={invoice.amountPaise} className="text-navy" />}
                  action={
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/partner/invoices/${invoice.id}#respond`}>Respond</Link>
                    </Button>
                  }
                />
              ))}
              {overview.openOffers.map((offer) => (
                <QueueItem
                  key={offer.id}
                  tone="gold"
                  icon={BadgePercent}
                  kicker={`Open offer · ${formatBps(offer.discountRateBps)}`}
                  title={`${offer.invoice.invoiceNumber} · ${offer.invoice.builder.name}`}
                  meta={`Valid until ${formatDateTime(offer.validUntil)}`}
                  amount={<Money paise={offer.netPayablePaise} className="font-semibold text-heritage" />}
                  action={<OfferLauncher invoice={offerInvoice(offer.invoice)} offer={toOfferDto(offer)} label="Review offer" variant="outline" />}
                />
              ))}
              {overview.eligibleWithoutOffer.map((invoice) => {
                const rate = overview.eligibility.get(invoice.id)?.programme?.discountRateBps;
                return (
                  <QueueItem
                    key={invoice.id}
                    tone="heritage"
                    icon={Sparkles}
                    kicker={`Eligible for early payment${rate !== undefined ? ` · ${formatBps(rate)}` : ""}`}
                    title={`${invoice.invoiceNumber} · ${invoice.builder.name}`}
                    meta={`Approved ${formatDate(invoice.decidedAt ?? invoice.updatedAt)} · ${invoice.project.name}`}
                    amount={<Money paise={invoice.approvedAmountPaise ?? 0n} className="text-navy" />}
                    action={<OfferLauncher invoice={offerInvoice(invoice)} />}
                  />
                );
              })}
            </ul>
          )}
          <p className="-mx-5 mt-auto flex items-start gap-2.5 border-t border-[#ece6d8] bg-[#faf8f3] px-5 py-4 text-xs leading-relaxed text-muted-foreground sm:-mx-7 sm:px-7">
            <BadgePercent className="mt-px size-3.5 shrink-0 text-[#8b6f3e]" />
            <span>
              Early payment is priced at the fixed rate agreed between Veefin and each builder, with no other charges.{" "}
              <Link href="/partner/offers" className="font-medium whitespace-nowrap text-navy hover:underline">
                Financing offers
              </Link>
            </span>
          </p>
        </Panel>

        <Panel className="xl:col-span-7" eyebrow="Last six months" title="Financial activity" description="Invoice value by invoice month">
          <InvoiceValueChart data={overview.monthly} />
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-12">
        <Panel
          className="xl:col-span-8"
          eyebrow="Ledger"
          title="Recent invoices"
          actions={
            <Button variant="ghost" size="sm" asChild className="text-navy">
              <Link href="/partner/invoices">
                View all
                <ArrowRight />
              </Link>
            </Button>
          }
          bodyClassName="pb-0"
        >
          {overview.recentInvoices.length === 0 ? (
            <EmptyNote
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
            <>
              <ul className="-mx-5 divide-y divide-[#f0ebe0] border-t border-[#ece6d8] md:hidden">
                {overview.recentInvoices.map((invoice) => (
                  <li key={invoice.id}>
                    <Link href={`/partner/invoices/${invoice.id}`} className="block px-5 py-4 active:bg-ivory/60">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-medium text-navy">{invoice.invoiceNumber}</p>
                        <Money paise={invoice.amountPaise} className="font-medium text-navy" />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {invoice.builder.name} · {formatDate(invoice.invoiceDate)}
                      </p>
                      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                        <StatusMark kind="invoice" status={invoice.status} className="text-xs" />
                        <StatusMark kind="financing" status={invoice.financingStatus} className="text-xs" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              <Table minWidth={640} className="hidden md:block">
                <thead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Invoice date</Th>
                    <Th align="right">Amount</Th>
                    <Th>Status</Th>
                    <Th>Early payment</Th>
                  </tr>
                </thead>
                <tbody>
                  {overview.recentInvoices.map((invoice) => (
                    <Tr key={invoice.id}>
                      <Td>
                        <RefCell href={`/partner/invoices/${invoice.id}`} primary={invoice.invoiceNumber} secondary={`${invoice.builder.name} · ${invoice.project.name}`} />
                      </Td>
                      <Td className="text-[0.8125rem] whitespace-nowrap">{formatDate(invoice.invoiceDate)}</Td>
                      <Td align="right">
                        <Money paise={invoice.amountPaise} className="font-medium text-navy" />
                      </Td>
                      <Td>
                        <StatusMark kind="invoice" status={invoice.status} />
                      </Td>
                      <Td>
                        <StatusMark kind="financing" status={invoice.financingStatus} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </Panel>

        <Panel
          className="xl:col-span-4"
          eyebrow="Early payment · simulated"
          title="Recent transactions"
          bodyClassName="pb-5"
        >
          {overview.recentRequests.length === 0 ? (
            <EmptyNote compact icon={BadgePercent} title="No transactions yet" description="Accepted early payment offers are tracked here through approval and payout." />
          ) : (
            <ul className="-mx-5 divide-y divide-[#f0ebe0] border-t border-[#ece6d8] sm:-mx-7">
              {overview.recentRequests.map((request) => (
                <li key={request.id}>
                  <Link href={`/partner/invoices/${request.invoice.id}`} className="group flex items-start gap-3 px-5 py-4 transition-colors hover:bg-[#fbf9f4] sm:px-7">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-navy">{request.invoice.invoiceNumber}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{request.reference}</p>
                      <StatusMark kind="financing" status={request.status} className="mt-2 text-xs" />
                    </div>
                    <div className="text-right">
                      <Money paise={request.netPayablePaise} className={cn("font-semibold", request.status === "REJECTED" ? "text-muted-foreground line-through" : "text-heritage")} />
                      <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                        {formatBps(request.discountRateBps)} · {formatDate(request.acceptedAt)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/partner/transactions" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-navy hover:underline">
            All transactions
            <ArrowUpRight className="size-3.5" />
          </Link>
        </Panel>
      </div>
    </>
  );
}

function PortfolioHero({ overview }: { overview: Overview }) {
  const { stats } = overview;
  const candidates = [
    ...overview.openOffers.map((offer) => ({
      key: offer.id,
      net: offer.netPayablePaise,
      approved: offer.approvedAmountPaise,
      rate: offer.discountRateBps,
      launcher: <OfferLauncher invoice={offerInvoice(offer.invoice)} offer={toOfferDto(offer)} label="Review offer" size="lg" />,
      label: `${offer.invoice.invoiceNumber} · ${offer.invoice.builder.name}`,
    })),
    ...overview.eligibleWithoutOffer.flatMap((invoice) => {
      const programme = overview.eligibility.get(invoice.id)?.programme;
      if (!programme || invoice.approvedAmountPaise === null) return [];
      return [
        {
          key: invoice.id,
          net: calculateDiscount(invoice.approvedAmountPaise, programme.discountRateBps).netPayablePaise,
          approved: invoice.approvedAmountPaise,
          rate: programme.discountRateBps,
          launcher: <OfferLauncher invoice={offerInvoice(invoice)} size="lg" />,
          label: `${invoice.invoiceNumber} · ${invoice.builder.name}`,
        },
      ];
    }),
  ];
  const available = sumPaise(candidates.map((c) => c.net));
  const approvedBase = sumPaise(candidates.map((c) => c.approved));
  const rates = candidates.map((c) => c.rate);
  const minRate = rates.length ? Math.min(...rates) : 0;
  const first = candidates[0];

  const pipeline = [
    { label: "Awaiting builder", value: stats.pendingAmount, hint: plural(stats.pendingCount, "invoice"), href: "/partner/invoices?status=pending" },
    { label: "Builder-approved", value: stats.approvedAmount, hint: plural(stats.approvedCount, "invoice"), href: "/partner/invoices?status=ACCEPTED" },
    { label: "In financing", value: stats.inFlightAmount, hint: plural(stats.inFlightCount, "request"), href: "/partner/transactions" },
    { label: "Received", value: stats.receivedAmount, hint: plural(stats.receivedCount, "payout"), href: "/partner/disbursements" },
  ];

  return (
    <section className="relative isolate animate-fade-up overflow-hidden rounded-[14px] bg-navy text-white shadow-[0_30px_60px_-35px_rgba(13,30,48,0.7)]">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(120%_140%_at_0%_0%,#1f3d5c_0%,#142b43_45%,#0d1e30_100%)]" />
      <FacadePattern className="inset-y-0 right-0 -z-10 h-full w-[70%] text-gold/[0.13]" />
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-gold/60 to-transparent" />

      <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="px-6 py-8 sm:px-10 sm:py-10">
          {first ? (
            <>
              <p className="text-[0.6875rem] font-semibold tracking-[0.22em] text-gold uppercase">Available to you today</p>
              <Money paise={available} size="display" className="mt-5 block font-light text-[#ecdcb6]" />
              <p className="mt-4 max-w-md text-sm leading-relaxed text-white/70">
                {candidates.length === 1 ? (
                  <>
                    Early payment on <span className="text-white">{first.label}</span>, net of the {formatBps(first.rate)} agreed discount on{" "}
                    <Money paise={first.approved} className="text-white" />.
                  </>
                ) : (
                  <>
                    Across {candidates.length} builder-approved invoices worth <Money paise={approvedBase} className="text-white" />, at agreed rates from {formatBps(minRate)}.
                  </>
                )}
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                {candidates.length === 1 ? (
                  first.launcher
                ) : (
                  <Button variant="gold" size="lg" asChild>
                    <Link href="/partner/offers">
                      <BadgePercent />
                      Review {candidates.length} opportunities
                    </Link>
                  </Button>
                )}
                <span className="text-xs text-white/50">Fixed rate · no other charges</span>
              </div>
            </>
          ) : (
            <>
              <p className="text-[0.6875rem] font-semibold tracking-[0.22em] text-gold uppercase">Portfolio value</p>
              <CompactMoney paise={stats.totalInvoiceAmount} size="display" className="mt-5 block font-light text-[#ecdcb6]" />
              <p className="mt-4 max-w-md text-sm leading-relaxed text-white/70">
                Nothing is ready for early payment right now. When a builder approves an invoice, you can receive it early at the agreed discount rate.
              </p>
              <div className="mt-7">
                <Button variant="gold" size="lg" asChild>
                  <Link href="/partner/invoices/new">
                    <FileUp />
                    Upload invoice
                  </Link>
                </Button>
              </div>
            </>
          )}
        </div>

        <dl className="grid grid-cols-2 border-t border-white/10 lg:border-t-0 lg:border-l">
          {pipeline.map((step, i) => (
            <Link
              key={step.label}
              href={step.href}
              className={cn(
                "group flex min-w-0 flex-col justify-between gap-4 px-6 py-6 transition-colors hover:bg-white/[0.04] sm:px-8 sm:py-7",
                i % 2 === 1 && "border-l border-white/10",
                i >= 2 && "border-t border-white/10",
              )}
            >
              <dt className="flex items-center justify-between gap-2 text-[0.625rem] font-semibold tracking-[0.18em] text-white/55 uppercase">
                {step.label}
                <ArrowUpRight className="size-3.5 text-gold/0 transition-colors group-hover:text-gold/80" />
              </dt>
              <dd>
                <CompactMoney paise={step.value} size="xl" className="block font-light text-white" />
                <span className="mt-2 block text-xs text-white/45">{step.hint}</span>
              </dd>
            </Link>
          ))}
        </dl>
      </div>
    </section>
  );
}

const QUEUE_TONE = {
  warning: { ring: "bg-[#fbf3e3] text-[#8a5a12] ring-[#efd9ae]", kicker: "text-[#8a5a12]" },
  gold: { ring: "bg-gold-100/70 text-[#7d6235] ring-gold/40", kicker: "text-[#8b6f3e]" },
  heritage: { ring: "bg-[#e8f0eb] text-heritage ring-heritage/20", kicker: "text-heritage" },
} as const;

function QueueItem({
  tone,
  icon: Icon,
  kicker,
  title,
  meta,
  amount,
  action,
}: {
  tone: keyof typeof QUEUE_TONE;
  icon: typeof Sparkles;
  kicker: string;
  title: string;
  meta: string;
  amount: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-4 px-5 py-5 sm:px-7">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full ring-1", QUEUE_TONE[tone].ring)}>
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-[0.625rem] font-semibold tracking-[0.16em] uppercase", QUEUE_TONE[tone].kicker)}>{kicker}</p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <p className="text-sm font-medium text-navy">{title}</p>
          {amount}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{meta}</p>
        <div className="mt-3.5">{action}</div>
      </div>
    </li>
  );
}
