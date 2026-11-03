import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FileStack, FileUp, SearchX } from "lucide-react";
import type { FinancingStatus, InvoiceStatus } from "@/generated/prisma/enums";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { sumPaise } from "@/lib/money";
import { FINANCING_STATUS, INVOICE_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { listPartnerInvoices, PENDING_INVOICE_STATUSES } from "@/server/queries/partner";
import { CompactMoney, Money } from "../_components/money";
import { OfferLauncher } from "../_components/offer-center";
import { firstParam, offerInvoice } from "../_components/summaries";
import { RefCell, SortTh, Table, TableToolbar, Td, Th, Tr } from "../_components/table";
import { EmptyNote, MetricStrip, PageIntro, Panel, StatusMark } from "../_components/ui";

export const metadata: Metadata = { title: "My Invoices" };

const PATH = "/partner/invoices";
const INVOICE_FILTERS: InvoiceStatus[] = ["SUBMITTED", "UNDER_REVIEW", "CLARIFICATION_REQUESTED", "ACCEPTED", "REJECTED"];
const FINANCING_FILTERS: FinancingStatus[] = ["NOT_REQUESTED", "OFFER_GENERATED", "PENDING_APPROVAL", "APPROVED", "DISBURSEMENT_INITIATED", "DISBURSED", "REJECTED"];
const SORT_KEYS = ["number", "builder", "project", "date", "amount", "status", "financing"] as const;

type SearchParams = Record<string, string | string[] | undefined>;

export default async function MyInvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireWorkspace("partner");
  const params = await searchParams;
  const statusParam = firstParam(params.status);
  const financingParam = firstParam(params.financing);
  const search = firstParam(params.q);

  const status =
    statusParam === "pending" ? PENDING_INVOICE_STATUSES : INVOICE_FILTERS.includes(statusParam as InvoiceStatus) ? (statusParam as InvoiceStatus) : undefined;
  const financing = FINANCING_FILTERS.includes(financingParam as FinancingStatus) ? (financingParam as FinancingStatus) : undefined;
  const filtered = Boolean(statusParam || financingParam || search);

  const [{ invoices, eligibility }, portfolio] = await Promise.all([
    listPartnerInvoices(actor, { status, financingStatus: financing, search }),
    filtered ? listPartnerInvoices(actor) : null,
  ]);
  const all = portfolio ?? { invoices, eligibility };
  const visible = financingParam === "eligible" ? invoices.filter((inv) => eligibility.get(inv.id)?.eligible) : invoices;

  const sort = readSort(params, SORT_KEYS, { key: "date", dir: "desc" });
  const rows = sortRows(visible, sort, {
    number: (r) => r.invoiceNumber,
    builder: (r) => r.builder.name,
    project: (r) => r.project.name,
    date: (r) => r.invoiceDate,
    amount: (r) => r.amountPaise,
    status: (r) => INVOICE_STATUS[r.status].label,
    financing: (r) => FINANCING_STATUS[r.financingStatus].label,
  });

  const pending = all.invoices.filter((inv) => PENDING_INVOICE_STATUSES.includes(inv.status));
  const approved = all.invoices.filter((inv) => inv.status === "ACCEPTED");
  const eligible = all.invoices.filter((inv) => all.eligibility.get(inv.id)?.eligible);

  return (
    <>
      <PageIntro
        eyebrow="Receivables"
        title="My Invoices"
        description="Every brokerage invoice you have raised, its approval with the builder, and its early payment status."
        actions={
          <Button asChild className="h-10 px-5">
            <Link href="/partner/invoices/new">
              <FileUp />
              Upload invoice
            </Link>
          </Button>
        }
      />

      <MetricStrip
        className="mb-8"
        items={[
          {
            label: "Total invoiced",
            value: <CompactMoney paise={sumPaise(all.invoices.map((i) => i.amountPaise))} size="xl" />,
            hint: `${all.invoices.length} ${all.invoices.length === 1 ? "invoice" : "invoices"}`,
            href: PATH,
          },
          {
            label: "Awaiting builder",
            value: <CompactMoney paise={sumPaise(pending.map((i) => i.amountPaise))} size="xl" />,
            hint: `${pending.length} pending approval`,
            accent: "slate",
            href: `${PATH}?status=pending`,
          },
          {
            label: "Builder-approved",
            value: <CompactMoney paise={sumPaise(approved.map((i) => i.approvedAmountPaise))} size="xl" />,
            hint: `${approved.length} accepted`,
            accent: "heritage",
            href: `${PATH}?status=ACCEPTED`,
          },
          {
            label: "Ready for early payment",
            value: <CompactMoney paise={sumPaise(eligible.map((i) => i.approvedAmountPaise))} size="xl" />,
            hint: `${eligible.length} eligible`,
            accent: "gold",
            href: `${PATH}?financing=eligible`,
          },
        ]}
      />

      <Panel
        eyebrow={filtered ? "Filtered view" : "All invoices"}
        title={`${rows.length} ${rows.length === 1 ? "invoice" : "invoices"}`}
        description={rows.length ? <>Total value <Money paise={sumPaise(rows.map((r) => r.amountPaise))} className="font-medium text-navy" /></> : undefined}
        bodyClassName="pb-0"
      >
        <TableToolbar>
          <ListToolbar
            searchPlaceholder="Search invoice no., reference, builder or project"
            filters={[
              {
                param: "status",
                label: "Invoice statuses",
                options: [{ value: "pending", label: "All pending approval" }, ...INVOICE_FILTERS.map((s) => ({ value: s, label: INVOICE_STATUS[s].label }))],
              },
              {
                param: "financing",
                label: "Financing statuses",
                options: [{ value: "eligible", label: "Eligible for early payment" }, ...FINANCING_FILTERS.map((s) => ({ value: s, label: FINANCING_STATUS[s].label }))],
              },
            ]}
          />
        </TableToolbar>

        {rows.length === 0 ? (
          <div className="-mx-5 border-t border-hairline sm:-mx-7">
            {filtered ? (
              <EmptyNote icon={SearchX} title="No invoices match your filters" description="Try a different search term or clear the filters." />
            ) : (
              <EmptyNote
                icon={FileStack}
                title="No invoices yet"
                description="Upload your first brokerage invoice. It goes straight to the builder's approval inbox."
                action={
                  <Button asChild size="sm">
                    <Link href="/partner/invoices/new">Upload invoice</Link>
                  </Button>
                }
              />
            )}
          </div>
        ) : (
          <>
            <ul className="-mx-5 divide-y divide-hairline border-t border-hairline md:hidden">
              {rows.map((invoice) => {
                const canDiscount = eligibility.get(invoice.id)?.eligible;
                return (
                  <li key={invoice.id} className="px-5 py-4">
                    <Link href={`/partner/invoices/${invoice.id}`} className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="font-medium text-navy">{invoice.invoiceNumber}</p>
                          <Money paise={invoice.amountPaise} className="font-medium text-navy" />
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {invoice.builder.name} · {invoice.project.name} · {formatDate(invoice.invoiceDate)}
                        </p>
                        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                          <StatusMark kind="invoice" status={invoice.status} className="text-xs" />
                          <StatusMark kind="financing" status={invoice.financingStatus} className="text-xs" />
                        </div>
                      </div>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    </Link>
                    {canDiscount && (
                      <OfferLauncher
                        invoice={offerInvoice(invoice)}
                        label={invoice.financingStatus === "OFFER_GENERATED" ? "Review offer" : "Get discounted amount"}
                        className="mt-3 w-full"
                      />
                    )}
                  </li>
                );
              })}
            </ul>

            <Table minWidth={1040} className="hidden md:block">
              <thead>
                <tr>
                  <SortTh label="Invoice" sortKey="number" sort={sort} searchParams={params} pathname={PATH} />
                  <SortTh label="Builder" sortKey="builder" sort={sort} searchParams={params} pathname={PATH} />
                  <SortTh label="Invoice date" sortKey="date" sort={sort} searchParams={params} pathname={PATH} />
                  <SortTh label="Amount" sortKey="amount" sort={sort} searchParams={params} pathname={PATH} align="right" />
                  <SortTh label="Status" sortKey="status" sort={sort} searchParams={params} pathname={PATH} />
                  <SortTh label="Early payment" sortKey="financing" sort={sort} searchParams={params} pathname={PATH} />
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((invoice) => {
                  const canDiscount = eligibility.get(invoice.id)?.eligible;
                  const partial = invoice.approvedAmountPaise !== null && invoice.approvedAmountPaise !== invoice.amountPaise;
                  return (
                    <Tr key={invoice.id}>
                      <Td>
                        <RefCell href={`/partner/invoices/${invoice.id}`} primary={invoice.invoiceNumber} secondary={invoice.reference} code />
                      </Td>
                      <Td className="min-w-[12rem]">
                        <p className="text-[0.8125rem] text-navy">{invoice.builder.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {invoice.project.name} · {invoice.project.code}
                        </p>
                      </Td>
                      <Td className="text-[0.8125rem] whitespace-nowrap">{formatDate(invoice.invoiceDate)}</Td>
                      <Td align="right">
                        <Money paise={invoice.amountPaise} className="font-medium text-navy" />
                        {partial && (
                          <p className="mt-0.5 text-xs text-heritage">
                            Approved <Money paise={invoice.approvedAmountPaise!} />
                          </p>
                        )}
                      </Td>
                      <Td>
                        <StatusMark kind="invoice" status={invoice.status} />
                      </Td>
                      <Td>
                        <StatusMark kind="financing" status={invoice.financingStatus} />
                      </Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-2">
                          {canDiscount && (
                            <OfferLauncher
                              invoice={offerInvoice(invoice)}
                              label={invoice.financingStatus === "OFFER_GENERATED" ? "Review offer" : "Get discounted amount"}
                              size="xs"
                            />
                          )}
                          <Button variant="ghost" size="icon-sm" asChild className="text-muted-foreground hover:text-navy">
                            <Link href={`/partner/invoices/${invoice.id}`} aria-label={`View invoice ${invoice.invoiceNumber}`}>
                              <ChevronRight />
                            </Link>
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </>
        )}
      </Panel>
    </>
  );
}
