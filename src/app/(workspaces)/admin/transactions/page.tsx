import type { Metadata } from "next";
import Link from "next/link";
import { FileStack, Receipt } from "lucide-react";
import type { FinancingStatus, InvoiceStatus } from "@/generated/prisma/enums";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { DemoBadge, StatusBadge } from "@/components/common/status-badge";
import { formatDate } from "@/lib/format";
import { formatBps, sumPaise } from "@/lib/money";
import { FINANCING_STATUS, INVOICE_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { listBuilderOptions } from "@/server/queries/admin";
import { listProgrammes } from "@/server/services/admin";
import { effectiveSettlementStatus, listFinancingRequests } from "@/server/services/financing";
import { listInvoices } from "@/server/services/invoices";
import { AdminHeader, Empty, Panel, SummaryStrip } from "../_components/editorial";
import { Count, Money, Rate } from "../_components/figures";
import { param, plural } from "../_components/labels";
import { Ledger, LSortTh, LTd, LTh, LTr, RefCode } from "../_components/ledger";

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
    <nav aria-label="Transaction views" className="-mt-4 mb-8 flex animate-fade-up gap-7 border-b border-border/90">
      {tabs.map((t) => {
        const active = view === t.key;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative -mb-px inline-flex items-center gap-2 border-b-2 pt-1 pb-3.5 text-sm font-medium transition-colors",
              active ? "border-gold text-navy" : "border-transparent text-muted-foreground hover:text-navy",
            )}
          >
            <t.icon className={cn("size-4", active && "text-gold-600")} strokeWidth={1.6} />
            {t.label}
          </Link>
        );
      })}
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
  const approved = sumPaise(rows.map((r) => r.approvedAmountPaise));
  const discount = sumPaise(rows.map((r) => r.discountAmountPaise));
  const net = sumPaise(rows.map((r) => r.netPayablePaise));

  return (
    <>
      <SummaryStrip
        items={[
          { label: "Requests", value: <Count value={rows.length} size="lg" />, hint: status ? FINANCING_STATUS[status].label : "All stages" },
          { label: "Builder-approved", value: <Money paise={approved} compact size="lg" />, hint: "Gross value financed", accent: "navy" },
          { label: "Discount", value: <Money paise={discount} compact size="lg" className="text-gold-600" />, hint: "At each agreed rate", accent: "gold" },
          { label: "Net to partners", value: <Money paise={net} compact size="lg" className="text-heritage" />, hint: "Payable early (simulated)", accent: "heritage" },
        ]}
      />
      <Panel
        eyebrow="Ledger"
        title={`${rows.length} financing request${rows.length === 1 ? "" : "s"}`}
        description="Rates are the snapshot agreed at acceptance and never change afterwards."
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
          <Empty icon={Receipt} title="No financing requests match" description="Requests appear here once a channel partner accepts an early-payment offer." />
        ) : (
          <Ledger minWidth={1360}>
            <thead>
              <tr>
                <LSortTh label="Request" sortKey="created" sort={sort} searchParams={sp} pathname="/admin/transactions" />
                <LTh>Channel partner → builder</LTh>
                <LTh>Invoice</LTh>
                <LSortTh label="Approved" sortKey="approved" sort={sort} searchParams={sp} pathname="/admin/transactions" align="right" />
                <LSortTh label="Rate" sortKey="rate" sort={sort} searchParams={sp} pathname="/admin/transactions" align="right" />
                <LTh align="right">Discount</LTh>
                <LSortTh label="Net payable" sortKey="net" sort={sort} searchParams={sp} pathname="/admin/transactions" align="right" />
                <LTh>Status</LTh>
                <LTh>Disbursement</LTh>
                <LTh>Settlement</LTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const current = liveRate.get(r.programmeId);
                return (
                  <LTr key={r.id}>
                    <LTd>
                      <Link href={`/admin/transactions/${r.id}`} className="hover:underline">
                        <RefCode>{r.reference}</RefCode>
                      </Link>
                      <p className="tabular text-xs text-muted-foreground">{formatDate(r.createdAt)}</p>
                    </LTd>
                    <LTd>
                      <p className="text-navy">{r.cp.name}</p>
                      <p className="text-xs text-muted-foreground">→ {r.builder.name}</p>
                    </LTd>
                    <LTd>
                      <p className="font-mono text-xs tracking-tight whitespace-nowrap">{r.invoice.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground">{r.invoice.project.name}</p>
                    </LTd>
                    <LTd align="right">
                      <Money paise={r.approvedAmountPaise} className="text-navy" />
                    </LTd>
                    <LTd align="right">
                      <Rate bps={r.discountRateBps} size="sm" className="font-semibold" />
                      {current !== undefined && current !== r.discountRateBps && (
                        <p className="text-[0.6875rem] whitespace-nowrap text-muted-foreground" title="The programme rate has changed since this request was accepted">
                          programme now {formatBps(current)}
                        </p>
                      )}
                    </LTd>
                    <LTd align="right">
                      <Money paise={r.discountAmountPaise} sign="−" className="text-[#93342a]" />
                    </LTd>
                    <LTd align="right">
                      <Money paise={r.netPayablePaise} className="font-semibold text-heritage" />
                    </LTd>
                    <LTd>
                      <StatusBadge kind="financing" status={r.status} />
                    </LTd>
                    <LTd>
                      {r.disbursement ? (
                        <>
                          <RefCode className="block text-xs font-normal">{r.disbursement.reference}</RefCode>
                          <StatusBadge kind="disbursement" status={r.disbursement.status} className="mt-1" />
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </LTd>
                    <LTd>
                      {r.settlement ? (
                        <>
                          <StatusBadge kind="settlement" status={effectiveSettlementStatus(r.settlement)} />
                          <p className="tabular mt-1 text-xs text-muted-foreground">Due {formatDate(r.settlement.dueDate)}</p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </LTd>
                  </LTr>
                );
              })}
            </tbody>
          </Ledger>
        )}
      </Panel>
    </>
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
  const gross = sumPaise(rows.map((i) => i.amountPaise));
  const approvedValue = sumPaise(rows.map((i) => i.approvedAmountPaise ?? 0n));
  const inReview = rows.filter((i) => i.status === "SUBMITTED" || i.status === "UNDER_REVIEW").length;

  return (
    <>
      <SummaryStrip
        items={[
          { label: "Invoices", value: <Count value={rows.length} size="lg" />, hint: status ? INVOICE_STATUS[status].label : "All review stages" },
          { label: "Gross value", value: <Money paise={gross} compact size="lg" />, hint: "As invoiced by partners", accent: "navy" },
          { label: "Builder-approved", value: <Money paise={approvedValue} compact size="lg" className="text-heritage" />, hint: "Eligible for early payment", accent: "heritage" },
          { label: "With builders", value: <Count value={inReview} size="lg" />, hint: `${plural(inReview, "invoice")} pending or in review`, accent: "gold" },
        ]}
      />
      <Panel
        eyebrow="Ledger"
        title={`${rows.length} invoice${rows.length === 1 ? "" : "s"}`}
        description="Invoice review status and financing status are tracked separately."
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
          <Empty icon={FileStack} title="No invoices match" description="Try a different search or clear the filters." />
        ) : (
          <Ledger minWidth={1360}>
            <thead>
              <tr>
                <LSortTh label="Invoice" sortKey="submitted" sort={sort} searchParams={sp} pathname="/admin/transactions" />
                <LTh>Channel partner</LTh>
                <LTh>Builder · project</LTh>
                <LTh>Invoice date</LTh>
                <LSortTh label="Due" sortKey="due" sort={sort} searchParams={sp} pathname="/admin/transactions" />
                <LSortTh label="Amount" sortKey="amount" sort={sort} searchParams={sp} pathname="/admin/transactions" align="right" />
                <LTh align="right">Approved</LTh>
                <LTh>Invoice status</LTh>
                <LTh>Financing status</LTh>
                <LTh>Request</LTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <LTr key={i.id}>
                  <LTd>
                    <RefCode>{i.invoiceNumber}</RefCode>
                    <p className="tabular text-xs text-muted-foreground">
                      {i.reference} · {i.submittedAt ? formatDate(i.submittedAt) : "not submitted"}
                    </p>
                  </LTd>
                  <LTd className="text-navy">{i.cp.name}</LTd>
                  <LTd>
                    <p>{i.builder.name}</p>
                    <p className="text-xs text-muted-foreground">{i.project.name}</p>
                  </LTd>
                  <LTd className="tabular text-xs whitespace-nowrap">{formatDate(i.invoiceDate)}</LTd>
                  <LTd className="tabular text-xs whitespace-nowrap">{formatDate(i.dueDate)}</LTd>
                  <LTd align="right">
                    <Money paise={i.amountPaise} className="text-navy" />
                  </LTd>
                  <LTd align="right">
                    {i.approvedAmountPaise !== null ? <Money paise={i.approvedAmountPaise} className="text-heritage" /> : <span className="text-muted-foreground">—</span>}
                  </LTd>
                  <LTd>
                    <StatusBadge kind="invoice" status={i.status} />
                  </LTd>
                  <LTd>
                    <StatusBadge kind="financing" status={i.financingStatus} />
                  </LTd>
                  <LTd>
                    {i.financingRequest ? (
                      <Link href={`/admin/transactions/${i.financingRequest.id}`} className="hover:underline">
                        <RefCode>{i.financingRequest.reference}</RefCode>
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </LTd>
                </LTr>
              ))}
            </tbody>
          </Ledger>
        )}
      </Panel>
    </>
  );
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireWorkspace("admin");
  const sp = await searchParams;
  const view = sp.view === "invoices" ? "invoices" : "requests";

  return (
    <>
      <AdminHeader
        eyebrow="Platform · Read-only"
        title="Transactions"
        lede="Every early-payment request and every invoice across all organisations. Operational actions belong to the builder and Veefin workspaces."
      />
      <ViewTabs view={view} />
      {view === "requests" ? <RequestsView sp={sp} /> : <InvoicesView sp={sp} />}
    </>
  );
}
