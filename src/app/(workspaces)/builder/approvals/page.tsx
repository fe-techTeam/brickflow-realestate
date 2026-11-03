import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Inbox, SearchX } from "lucide-react";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { sumPaise } from "@/lib/money";
import { INVOICE_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { listBuilderProjectOptions } from "@/server/queries/builder";
import { listInvoices } from "@/server/services/invoices";
import { AgeingMeter, BucketBar, type Bucket } from "../_components/ageing";
import { CARD, Empty, Masthead, Monogram, Panel } from "../_components/kit";
import { Money } from "../_components/money";
import { Ledger, Ref, RowLink, SortTh, TableToolbar, Td, Th, Tr } from "../_components/table";
import { ViewTabs } from "../_components/view-tabs";
import { ageInDays } from "../_lib/dates";
import { enumParam, param, type SearchParams } from "../_lib/params";

export const metadata: Metadata = { title: "Invoice approvals" };

const PATH = "/builder/approvals";
const OPEN: InvoiceStatus[] = ["SUBMITTED", "UNDER_REVIEW", "CLARIFICATION_REQUESTED"];
const AWAITING: InvoiceStatus[] = ["SUBMITTED", "UNDER_REVIEW"];
const ALL: InvoiceStatus[] = [...OPEN, "ACCEPTED", "REJECTED"];
const SORT_KEYS = ["cp", "number", "project", "amount", "invoiceDate", "submitted", "status"] as const;

const AGE_BANDS: { key: string; label: string; min: number; max: number; tone: Bucket["tone"] }[] = [
  { key: "fresh", label: "Under a day", min: 0, max: 1, tone: "leaf" },
  { key: "steady", label: "1–2 days", min: 1, max: 3, tone: "slate" },
  { key: "ageing", label: "3–6 days", min: 3, max: 7, tone: "amber" },
  { key: "late", label: "A week or more", min: 7, max: Number.POSITIVE_INFINITY, tone: "rose" },
];

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireWorkspace("builder");
  const sp = await searchParams;
  const view = param(sp, "view") === "all" ? "all" : "open";
  const allowed = view === "open" ? OPEN : ALL;
  const status = enumParam(sp, "status", allowed);
  const projectId = param(sp, "project");
  const q = param(sp, "q");

  const [invoices, projects] = await Promise.all([listInvoices(actor, { search: q, projectId }), listBuilderProjectOptions(actor)]);
  const openCount = invoices.filter((i) => OPEN.includes(i.status)).length;
  const inView = invoices.filter((i) => allowed.includes(i.status) && (!status || i.status === status));
  const now = new Date();

  const awaiting = invoices.filter((i) => AWAITING.includes(i.status));
  const withPartner = invoices.filter((i) => i.status === "CLARIFICATION_REQUESTED");
  const buckets: Bucket[] = AGE_BANDS.map((band) => {
    const group = awaiting.filter((i) => {
      const age = ageInDays(i.submittedAt, now);
      return age >= band.min && age < band.max;
    });
    return { key: band.key, label: band.label, tone: band.tone, count: group.length, value: sumPaise(group.map((i) => i.amountPaise)) };
  });

  const sort = readSort(sp, SORT_KEYS, view === "open" ? { key: "submitted", dir: "asc" } : { key: "submitted", dir: "desc" });
  const rows = sortRows(inView, sort, {
    cp: (i) => i.cp.name,
    number: (i) => i.invoiceNumber,
    project: (i) => i.project.name,
    amount: (i) => i.amountPaise,
    invoiceDate: (i) => i.invoiceDate,
    submitted: (i) => i.submittedAt,
    status: (i) => INVOICE_STATUS[i.status].label,
  });
  const filtered = Boolean(q || projectId || status);

  return (
    <>
      <Masthead
        eyebrow="Invoices"
        title="Invoice approvals"
        lede="Review channel partner invoices against your booking records. Approved invoices become eligible for early payment from Veefin; your own payment terms do not change."
        actions={
          <ViewTabs
            label="Invoice view"
            param="view"
            pathname={PATH}
            searchParams={sp}
            resetParams={["status", "sort", "dir"]}
            current={view}
            tabs={[
              { value: "open", label: "Open inbox", count: openCount },
              { value: "all", label: "All invoices", count: invoices.length },
            ]}
          />
        }
      />

      <section className={`${CARD} mb-6 grid animate-fade-up gap-px overflow-hidden bg-[rgba(255,255,255,0.08)] sm:mb-8 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]`}>
        <div className="bg-card px-5 py-6 sm:px-7">
          <p className="text-[0.625rem] font-semibold tracking-[0.18em] text-fg-muted uppercase">Awaiting your decision</p>
          <Money paise={sumPaise(awaiting.map((i) => i.amountPaise))} compact size="xl" className="mt-4 font-normal text-fg" />
          <p className="mt-2 text-[0.75rem] leading-relaxed text-muted-foreground">
            {awaiting.length} {awaiting.length === 1 ? "invoice" : "invoices"} in review
            {withPartner.length > 0 && ` · ${withPartner.length} with the partner for clarification`}
          </p>
        </div>
        <div className="bg-card px-5 py-6 sm:px-7">
          <p className="mb-4 text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Ageing since submission</p>
          <BucketBar buckets={buckets} format={(v) => <Money paise={v} compact className="text-[0.9375rem] font-medium" />} />
        </div>
      </section>

      <Panel
        title={view === "open" ? "Awaiting action" : "All invoices"}
        description={
          rows.length > 0 ? (
            <>
              {rows.length} {rows.length === 1 ? "invoice" : "invoices"} · <Money paise={sumPaise(rows.map((r) => r.amountPaise))} compact />
              {view === "open" ? " · oldest submissions first" : ""}
            </>
          ) : undefined
        }
        flush
      >
        <TableToolbar>
          <ListToolbar
            searchPlaceholder="Search invoice, reference or partner…"
            filters={[
              { param: "status", label: "Statuses", options: allowed.map((s) => ({ value: s, label: INVOICE_STATUS[s].label })) },
              { param: "project", label: "Projects", options: projects.map((p) => ({ value: p.id, label: p.name })) },
            ]}
          />
        </TableToolbar>

        {rows.length === 0 ? (
          filtered ? (
            <Empty icon={SearchX} title="No invoices match your filters" description="Try a different search term, or clear the filters to see the full list." />
          ) : view === "open" ? (
            <Empty
              icon={Inbox}
              title="Inbox clear"
              description="There are no invoices waiting for your review. New submissions from channel partners will appear here automatically."
              action={
                <Button variant="outline" asChild>
                  <Link href="/builder/approved">View approved invoices</Link>
                </Button>
              }
            />
          ) : (
            <Empty icon={Inbox} title="No invoices yet" description="Invoices submitted by your empanelled channel partners will appear here." />
          )
        ) : (
          <>
            <ul className="divide-y divide-[rgba(255,255,255,0.07)] sm:hidden">
              {rows.map((invoice) => {
                const waiting = AWAITING.includes(invoice.status);
                return (
                  <li key={invoice.id}>
                    <Link
                      href={`/builder/invoices/${invoice.id}`}
                      className="flex gap-3.5 px-5 py-4 transition-colors hover:bg-[rgba(255,255,255,0.04)] focus-visible:bg-[rgba(255,255,255,0.04)] focus-visible:outline-none"
                    >
                      <Monogram name={invoice.cp.name} className="size-8 text-[0.8125rem]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate font-medium text-fg">{invoice.invoiceNumber}</span>
                          <Money paise={invoice.amountPaise} className="shrink-0 font-medium text-fg" />
                        </div>
                        <p className="mt-1 truncate text-[0.75rem] text-muted-foreground">
                          {invoice.cp.name} · {invoice.project.name}
                        </p>
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                          <StatusBadge kind="invoice" status={invoice.status} />
                          {waiting ? (
                            <AgeingMeter days={ageInDays(invoice.submittedAt, now)} />
                          ) : (
                            <span className="text-[0.75rem] text-muted-foreground">Submitted {formatDate(invoice.submittedAt)}</span>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="max-sm:hidden">
            <Ledger minWidth={940} caption="Invoices">
              <thead>
                <tr>
                  <SortTh label="Partner" sortKey="cp" sort={sort} searchParams={sp} pathname={PATH} />
                  <SortTh label="Invoice" sortKey="number" sort={sort} searchParams={sp} pathname={PATH} />
                  <SortTh label="Amount" sortKey="amount" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                  <SortTh label="Invoice date" sortKey="invoiceDate" sort={sort} searchParams={sp} pathname={PATH} />
                  <SortTh label="Waiting" sortKey="submitted" sort={sort} searchParams={sp} pathname={PATH} />
                  <SortTh label="Status" sortKey="status" sort={sort} searchParams={sp} pathname={PATH} />
                  <Th align="right">
                    <span className="sr-only">Action</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((invoice) => {
                  const waiting = AWAITING.includes(invoice.status);
                  return (
                    <Tr key={invoice.id}>
                      <Td>
                        <span className="flex items-center gap-3">
                          <Monogram name={invoice.cp.name} className="size-8 text-[0.8125rem]" />
                          <span className="min-w-0">
                            <span className="block font-medium text-fg">{invoice.cp.name}</span>
                            <span className="mt-1 block text-[0.75rem] text-muted-foreground">{invoice.project.name}</span>
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <RowLink href={`/builder/invoices/${invoice.id}`}>{invoice.invoiceNumber}</RowLink>
                        <Ref>{invoice.reference}</Ref>
                      </Td>
                      <Td align="right">
                        <Money paise={invoice.amountPaise} className="font-medium text-fg" />
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(invoice.invoiceDate)}</Td>
                      <Td className="whitespace-nowrap">
                        {waiting ? (
                          <AgeingMeter days={ageInDays(invoice.submittedAt, now)} />
                        ) : (
                          <span className="text-[0.75rem] text-muted-foreground">Submitted {formatDate(invoice.submittedAt)}</span>
                        )}
                      </Td>
                      <Td>
                        <StatusBadge kind="invoice" status={invoice.status} />
                      </Td>
                      <Td align="right">
                        <Button variant={waiting ? "default" : "ghost"} size="sm" asChild className={waiting ? undefined : "text-fg"}>
                          <Link href={`/builder/invoices/${invoice.id}`} aria-label={`${waiting ? "Review" : "View"} invoice ${invoice.invoiceNumber}`}>
                            {waiting ? "Review" : "View"}
                            <ArrowRight className="size-3.5" />
                          </Link>
                        </Button>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Ledger>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
