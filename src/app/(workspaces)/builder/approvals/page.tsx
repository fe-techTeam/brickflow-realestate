import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Inbox, SearchX } from "lucide-react";
import { DataTable, readSort, SortTh, sortRows, Td, Th, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { INVOICE_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/auth/session";
import { listBuilderProjectOptions } from "@/server/queries/builder";
import { listInvoices } from "@/server/services/invoices";
import { ToolbarRow } from "../_components/toolbar-row";
import { ViewTabs } from "../_components/view-tabs";
import { ageInDays, formatAgeing } from "../_lib/dates";
import { enumParam, param, type SearchParams } from "../_lib/params";

export const metadata: Metadata = { title: "Invoice approvals" };

const PATH = "/builder/approvals";
const OPEN: InvoiceStatus[] = ["SUBMITTED", "UNDER_REVIEW", "CLARIFICATION_REQUESTED"];
const ALL: InvoiceStatus[] = [...OPEN, "ACCEPTED", "REJECTED"];
const SORT_KEYS = ["cp", "number", "project", "amount", "invoiceDate", "submitted", "status"] as const;

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
  const now = new Date();

  return (
    <>
      <PageHeader
        eyebrow="Invoices"
        title="Invoice approvals"
        description="Review channel partner invoices against your booking records. Approved invoices become eligible for early payment from Veefin; your own payment terms do not change."
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

      <Section
        title={view === "open" ? "Awaiting action" : "All invoices"}
        description={
          rows.length > 0
            ? `${rows.length} ${rows.length === 1 ? "invoice" : "invoices"} · ${formatINRCompact(sumPaise(rows.map((r) => r.amountPaise)))}${view === "open" ? " · oldest submissions first" : ""}`
            : undefined
        }
        bodyClassName="py-0"
      >
        <ToolbarRow>
          <ListToolbar
            searchPlaceholder="Search invoice, reference or partner…"
            filters={[
              { param: "status", label: "Statuses", options: allowed.map((s) => ({ value: s, label: INVOICE_STATUS[s].label })) },
              { param: "project", label: "Projects", options: projects.map((p) => ({ value: p.id, label: p.name })) },
            ]}
          />
        </ToolbarRow>

        {rows.length === 0 ? (
          filtered ? (
            <EmptyState icon={SearchX} title="No invoices match your filters" description="Try a different search term, or clear the filters to see the full list." />
          ) : view === "open" ? (
            <EmptyState
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
            <EmptyState icon={Inbox} title="No invoices yet" description="Invoices submitted by your empanelled channel partners will appear here." />
          )
        ) : (
          <DataTable minWidth={960}>
            <thead>
              <tr>
                <SortTh label="Partner" sortKey="cp" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Invoice no." sortKey="number" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Project" sortKey="project" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Amount" sortKey="amount" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Invoice date" sortKey="invoiceDate" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Submitted" sortKey="submitted" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Status" sortKey="status" sort={sort} searchParams={sp} pathname={PATH} />
                <Th align="right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((invoice) => {
                const waiting = invoice.status === "SUBMITTED" || invoice.status === "UNDER_REVIEW";
                const stale = waiting && ageInDays(invoice.submittedAt, now) >= 3;
                return (
                  <Tr key={invoice.id}>
                    <Td className="font-medium text-navy">{invoice.cp.name}</Td>
                    <Td>
                      <Link href={`/builder/invoices/${invoice.id}`} className="font-medium text-navy underline-offset-4 hover:underline">
                        {invoice.invoiceNumber}
                      </Link>
                      <p className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">{invoice.reference}</p>
                    </Td>
                    <Td>{invoice.project.name}</Td>
                    <Td align="right" className="font-medium text-navy">
                      {formatINR(invoice.amountPaise)}
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(invoice.invoiceDate)}</Td>
                    <Td className="whitespace-nowrap">
                      {formatDate(invoice.submittedAt)}
                      <p className={cn("mt-0.5 text-xs", stale ? "font-medium text-[#8a5a12]" : "text-muted-foreground")}>{formatAgeing(invoice.submittedAt, now)}</p>
                    </Td>
                    <Td>
                      <StatusBadge kind="invoice" status={invoice.status} />
                    </Td>
                    <Td align="right">
                      <Button variant={waiting ? "default" : "outline"} size="sm" asChild>
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
          </DataTable>
        )}
      </Section>
    </>
  );
}
