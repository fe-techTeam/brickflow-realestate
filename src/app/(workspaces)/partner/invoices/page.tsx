import type { Metadata } from "next";
import Link from "next/link";
import { FileStack, FileUp, SearchX } from "lucide-react";
import type { FinancingStatus, InvoiceStatus } from "@/generated/prisma/enums";
import { DataTable, readSort, SortTh, sortRows, Td, Th, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { formatINR, sumPaise } from "@/lib/money";
import { FINANCING_STATUS, INVOICE_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { listPartnerInvoices, PENDING_INVOICE_STATUSES } from "@/server/queries/partner";
import { OfferLauncher } from "../_components/offer-center";
import { firstParam, offerInvoice } from "../_components/summaries";

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

  const { invoices, eligibility } = await listPartnerInvoices(actor, { status, financingStatus: financing, search });
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
  const filtered = Boolean(statusParam || financingParam || search);

  return (
    <>
      <PageHeader
        eyebrow="Invoices"
        title="My Invoices"
        description="Every brokerage invoice you have raised, its approval status with the builder, and its early payment status."
        actions={
          <Button asChild>
            <Link href="/partner/invoices/new">
              <FileUp />
              Upload invoice
            </Link>
          </Button>
        }
      />

      <Section
        title={`${rows.length} ${rows.length === 1 ? "invoice" : "invoices"}`}
        description={rows.length ? `${formatINR(sumPaise(rows.map((r) => r.amountPaise)))} total invoice value${filtered ? " (filtered)" : ""}` : undefined}
        bodyClassName="py-0"
      >
        <div className="border-b border-border/70 py-4">
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
        </div>

        {rows.length === 0 ? (
          filtered ? (
            <EmptyState icon={SearchX} title="No invoices match your filters" description="Try a different search term or clear the filters." />
          ) : (
            <EmptyState
              icon={FileStack}
              title="No invoices yet"
              description="Upload your first brokerage invoice. It goes straight to the builder's approval inbox."
              action={
                <Button asChild size="sm">
                  <Link href="/partner/invoices/new">Upload invoice</Link>
                </Button>
              }
            />
          )
        ) : (
          <DataTable minWidth={1060}>
            <thead>
              <tr>
                <SortTh label="Invoice no." sortKey="number" sort={sort} searchParams={params} pathname={PATH} />
                <SortTh label="Builder" sortKey="builder" sort={sort} searchParams={params} pathname={PATH} />
                <SortTh label="Project" sortKey="project" sort={sort} searchParams={params} pathname={PATH} />
                <SortTh label="Invoice date" sortKey="date" sort={sort} searchParams={params} pathname={PATH} />
                <SortTh label="Amount" sortKey="amount" sort={sort} searchParams={params} pathname={PATH} align="right" />
                <SortTh label="Invoice status" sortKey="status" sort={sort} searchParams={params} pathname={PATH} />
                <SortTh label="Financing status" sortKey="financing" sort={sort} searchParams={params} pathname={PATH} />
                <Th align="right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((invoice) => {
                const eligible = eligibility.get(invoice.id)?.eligible;
                return (
                  <Tr key={invoice.id}>
                    <Td className="whitespace-nowrap">
                      <Link href={`/partner/invoices/${invoice.id}`} className="font-medium text-navy hover:underline">
                        {invoice.invoiceNumber}
                      </Link>
                      <p className="text-xs text-muted-foreground">{invoice.reference}</p>
                    </Td>
                    <Td className="min-w-[9rem]">{invoice.builder.name}</Td>
                    <Td>
                      <p>{invoice.project.name}</p>
                      <p className="text-xs text-muted-foreground">{invoice.project.code}</p>
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(invoice.invoiceDate)}</Td>
                    <Td align="right">
                      <p>{formatINR(invoice.amountPaise)}</p>
                      {invoice.approvedAmountPaise !== null && invoice.approvedAmountPaise !== invoice.amountPaise && (
                        <p className="text-xs text-muted-foreground">Approved {formatINR(invoice.approvedAmountPaise)}</p>
                      )}
                    </Td>
                    <Td>
                      <StatusBadge kind="invoice" status={invoice.status} />
                    </Td>
                    <Td>
                      <StatusBadge kind="financing" status={invoice.financingStatus} />
                    </Td>
                    <Td align="right">
                      <div className="flex flex-col items-end gap-1.5">
                        {eligible && (
                          <OfferLauncher
                            invoice={offerInvoice(invoice)}
                            label={invoice.financingStatus === "OFFER_GENERATED" ? "Review offer" : "Get discounted amount"}
                            size="xs"
                          />
                        )}
                        <Button variant="outline" size="xs" asChild className="px-3">
                          <Link href={`/partner/invoices/${invoice.id}`} aria-label={`View invoice ${invoice.invoiceNumber}`}>
                            View
                          </Link>
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Section>
    </>
  );
}
