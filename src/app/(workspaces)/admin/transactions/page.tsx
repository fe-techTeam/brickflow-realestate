import type { Metadata } from "next";
import Link from "next/link";
import { FileStack, Receipt } from "lucide-react";
import type { FinancingStatus, InvoiceStatus } from "@/generated/prisma/enums";
import { DataTable, readSort, SortTh, sortRows, Td, Th, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { DemoBadge, StatusBadge } from "@/components/common/status-badge";
import { formatDate } from "@/lib/format";
import { formatBps, formatINR, sumPaise } from "@/lib/money";
import { FINANCING_STATUS, INVOICE_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { listBuilderOptions } from "@/server/queries/admin";
import { listProgrammes } from "@/server/services/admin";
import { effectiveSettlementStatus, listFinancingRequests } from "@/server/services/financing";
import { listInvoices } from "@/server/services/invoices";
import { param } from "../_components/labels";

export const metadata: Metadata = { title: "Transactions" };

type SearchParams = Record<string, string | string[] | undefined>;

const REQUEST_STATUSES = (Object.keys(FINANCING_STATUS) as FinancingStatus[]).filter((s) => !["NOT_REQUESTED", "REQUESTED", "OFFER_GENERATED"].includes(s));
const REQUEST_SORT = ["created", "approved", "net", "rate"] as const;
const INVOICE_SORT = ["submitted", "amount", "due"] as const;

function ViewTabs({ view }: { view: "requests" | "invoices" }) {
  const tabs = [
    { key: "requests", label: "Financing requests", href: "/admin/transactions", icon: Receipt },
    { key: "invoices", label: "All invoices", href: "/admin/transactions?view=invoices", icon: FileStack },
  ] as const;
  return (
    <nav aria-label="Transaction views" className="mb-6 inline-flex animate-fade-up rounded-lg border border-border bg-card p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={view === t.key ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
            view === t.key ? "bg-navy text-white shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-navy",
          )}
        >
          <t.icon className="size-4" strokeWidth={1.75} />
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

async function RequestsView({ sp }: { sp: SearchParams }) {
  const actor = await requireWorkspace("admin");
  const statusParam = param(sp.status);
  const status = statusParam && REQUEST_STATUSES.includes(statusParam as FinancingStatus) ? (statusParam as FinancingStatus) : undefined;
  const sort = readSort(sp, REQUEST_SORT, { key: "created", dir: "desc" });
  const [requests, programmes, builders] = await Promise.all([
    listFinancingRequests(actor, { status, builderId: param(sp.builder), search: param(sp.q) }),
    listProgrammes(actor),
    listBuilderOptions(actor),
  ]);
  const liveRate = new Map(programmes.map((p) => [p.id, p.discountRateBps]));
  const rows = sortRows(requests, sort, {
    created: (r) => r.createdAt,
    approved: (r) => r.approvedAmountPaise,
    net: (r) => r.netPayablePaise,
    rate: (r) => r.discountRateBps,
  });

  return (
    <Section
      title={`${rows.length} financing request${rows.length === 1 ? "" : "s"}`}
      description={`Approved ${formatINR(sumPaise(rows.map((r) => r.approvedAmountPaise)))} · net payable ${formatINR(sumPaise(rows.map((r) => r.netPayablePaise)))}. Rates are the snapshot agreed at acceptance.`}
      actions={<DemoBadge />}
      bodyClassName="space-y-5"
    >
      <ListToolbar
        searchPlaceholder="Search reference, invoice, partner or builder…"
        filters={[
          { param: "status", label: "Statuses", options: REQUEST_STATUSES.map((s) => ({ value: s, label: FINANCING_STATUS[s].label })) },
          { param: "builder", label: "Builders", options: builders.map((b) => ({ value: b.id, label: b.name })) },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState icon={Receipt} title="No financing requests match" description="Requests appear here once a channel partner accepts an early-payment offer." />
      ) : (
        <DataTable minWidth={1360}>
          <thead>
            <tr>
              <SortTh label="Request" sortKey="created" sort={sort} searchParams={sp} pathname="/admin/transactions" />
              <Th>Channel partner → builder</Th>
              <Th>Invoice</Th>
              <SortTh label="Approved" sortKey="approved" sort={sort} searchParams={sp} pathname="/admin/transactions" align="right" />
              <SortTh label="Rate" sortKey="rate" sort={sort} searchParams={sp} pathname="/admin/transactions" align="right" />
              <Th align="right">Discount</Th>
              <SortTh label="Net payable" sortKey="net" sort={sort} searchParams={sp} pathname="/admin/transactions" align="right" />
              <Th>Status</Th>
              <Th>Disbursement</Th>
              <Th>Settlement</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const current = liveRate.get(r.programmeId);
              return (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/admin/transactions/${r.id}`} className="font-mono text-xs font-medium whitespace-nowrap text-navy hover:underline">
                      {r.reference}
                    </Link>
                    <p className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</p>
                  </Td>
                  <Td>
                    <p>{r.cp.name}</p>
                    <p className="text-xs text-muted-foreground">→ {r.builder.name}</p>
                  </Td>
                  <Td>
                    <p className="font-mono text-xs whitespace-nowrap">{r.invoice.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground">{r.invoice.project.name}</p>
                  </Td>
                  <Td align="right" className="whitespace-nowrap">{formatINR(r.approvedAmountPaise)}</Td>
                  <Td align="right">
                    <span className="font-medium text-navy">{formatBps(r.discountRateBps)}</span>
                    {current !== undefined && current !== r.discountRateBps && (
                      <p className="text-[0.6875rem] whitespace-nowrap text-muted-foreground" title="The programme rate has changed since this request was accepted">
                        programme now {formatBps(current)}
                      </p>
                    )}
                  </Td>
                  <Td align="right" className="whitespace-nowrap text-[#93342a]">
                    −{formatINR(r.discountAmountPaise)}
                  </Td>
                  <Td align="right" className="font-medium whitespace-nowrap text-heritage">
                    {formatINR(r.netPayablePaise)}
                  </Td>
                  <Td>
                    <StatusBadge kind="financing" status={r.status} />
                  </Td>
                  <Td>
                    {r.disbursement ? (
                      <>
                        <p className="font-mono text-xs whitespace-nowrap">{r.disbursement.reference}</p>
                        <StatusBadge kind="disbursement" status={r.disbursement.status} className="mt-1" />
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </Td>
                  <Td>
                    {r.settlement ? (
                      <>
                        <StatusBadge kind="settlement" status={effectiveSettlementStatus(r.settlement)} />
                        <p className="mt-1 text-xs text-muted-foreground">Due {formatDate(r.settlement.dueDate)}</p>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </Section>
  );
}

async function InvoicesView({ sp }: { sp: SearchParams }) {
  const actor = await requireWorkspace("admin");
  const statusParam = param(sp.status);
  const status = statusParam && statusParam in INVOICE_STATUS ? (statusParam as InvoiceStatus) : undefined;
  const financingParam = param(sp.financing);
  const financingStatus = financingParam && financingParam in FINANCING_STATUS ? (financingParam as FinancingStatus) : undefined;
  const sort = readSort(sp, INVOICE_SORT, { key: "submitted", dir: "desc" });
  const [invoices, builders] = await Promise.all([
    listInvoices(actor, { status, financingStatus, builderId: param(sp.builder), search: param(sp.q) }),
    listBuilderOptions(actor),
  ]);
  const rows = sortRows(invoices, sort, {
    submitted: (i) => i.submittedAt ?? i.createdAt,
    amount: (i) => i.amountPaise,
    due: (i) => i.dueDate,
  });

  return (
    <Section
      title={`${rows.length} invoice${rows.length === 1 ? "" : "s"}`}
      description={`Gross value ${formatINR(sumPaise(rows.map((i) => i.amountPaise)))}. Invoice review status and financing status are tracked separately.`}
      bodyClassName="space-y-5"
    >
      <ListToolbar
        searchPlaceholder="Search invoice, reference, partner, builder or project…"
        filters={[
          { param: "status", label: "Invoice statuses", options: Object.entries(INVOICE_STATUS).map(([value, m]) => ({ value, label: m.label })) },
          { param: "financing", label: "Financing statuses", options: Object.entries(FINANCING_STATUS).map(([value, m]) => ({ value, label: m.label })) },
          { param: "builder", label: "Builders", options: builders.map((b) => ({ value: b.id, label: b.name })) },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState icon={FileStack} title="No invoices match" description="Try a different search or clear the filters." />
      ) : (
        <DataTable minWidth={1360}>
          <thead>
            <tr>
              <SortTh label="Invoice" sortKey="submitted" sort={sort} searchParams={sp} pathname="/admin/transactions" />
              <Th>Channel partner</Th>
              <Th>Builder · project</Th>
              <Th>Invoice date</Th>
              <SortTh label="Due" sortKey="due" sort={sort} searchParams={sp} pathname="/admin/transactions" />
              <SortTh label="Amount" sortKey="amount" sort={sort} searchParams={sp} pathname="/admin/transactions" align="right" />
              <Th align="right">Approved</Th>
              <Th>Invoice status</Th>
              <Th>Financing status</Th>
              <Th>Request</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <Tr key={i.id}>
                <Td>
                  <p className="font-mono text-xs font-medium whitespace-nowrap text-navy">{i.invoiceNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.reference} · {i.submittedAt ? formatDate(i.submittedAt) : "not submitted"}
                  </p>
                </Td>
                <Td>{i.cp.name}</Td>
                <Td>
                  <p>{i.builder.name}</p>
                  <p className="text-xs text-muted-foreground">{i.project.name}</p>
                </Td>
                <Td className="text-xs whitespace-nowrap">{formatDate(i.invoiceDate)}</Td>
                <Td className="text-xs whitespace-nowrap">{formatDate(i.dueDate)}</Td>
                <Td align="right" className="whitespace-nowrap">{formatINR(i.amountPaise)}</Td>
                <Td align="right" className="whitespace-nowrap">{i.approvedAmountPaise !== null ? formatINR(i.approvedAmountPaise) : "—"}</Td>
                <Td>
                  <StatusBadge kind="invoice" status={i.status} />
                </Td>
                <Td>
                  <StatusBadge kind="financing" status={i.financingStatus} />
                </Td>
                <Td>
                  {i.financingRequest ? (
                    <Link href={`/admin/transactions/${i.financingRequest.id}`} className="font-mono text-xs whitespace-nowrap text-navy hover:underline">
                      {i.financingRequest.reference}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Section>
  );
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireWorkspace("admin");
  const sp = await searchParams;
  const view = sp.view === "invoices" ? "invoices" : "requests";

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Transactions"
        description="Every early-payment request and every invoice across all organisations. Read-only: operational actions belong to the builder and Veefin workspaces."
      />
      <ViewTabs view={view} />
      {view === "requests" ? <RequestsView sp={sp} /> : <InvoicesView sp={sp} />}
    </>
  );
}
