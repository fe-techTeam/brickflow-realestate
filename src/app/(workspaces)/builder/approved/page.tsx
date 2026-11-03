import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, SearchX } from "lucide-react";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import type { FinancingStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { sumPaise } from "@/lib/money";
import { FINANCING_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { listBuilderProjectOptions } from "@/server/queries/builder";
import { listInvoices } from "@/server/services/invoices";
import { Empty, Figure, Masthead, Metric, MetricStrip, Panel } from "../_components/kit";
import { Money } from "../_components/money";
import { Ledger, Ref, RowLink, SortTh, TableToolbar, Td, Tr } from "../_components/table";
import { enumParam, param, type SearchParams } from "../_lib/params";

export const metadata: Metadata = { title: "Approved invoices" };

const PATH = "/builder/approved";
const FINANCING_FILTER: FinancingStatus[] = ["NOT_REQUESTED", "OFFER_GENERATED", "PENDING_APPROVAL", "APPROVED", "DISBURSEMENT_INITIATED", "DISBURSED", "REJECTED"];
const SORT_KEYS = ["cp", "number", "project", "amount", "approved", "decided", "due", "financing"] as const;

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export default async function ApprovedInvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireWorkspace("builder");
  const sp = await searchParams;
  const q = param(sp, "q");
  const projectId = param(sp, "project");
  const financing = enumParam(sp, "financing", FINANCING_FILTER);

  const [all, invoices, projects] = await Promise.all([
    listInvoices(actor, { status: "ACCEPTED" }),
    listInvoices(actor, { status: "ACCEPTED", search: q, projectId, financingStatus: financing }),
    listBuilderProjectOptions(actor),
  ]);

  const sort = readSort(sp, SORT_KEYS, { key: "decided", dir: "desc" });
  const rows = sortRows(invoices, sort, {
    cp: (i) => i.cp.name,
    number: (i) => i.invoiceNumber,
    project: (i) => i.project.name,
    amount: (i) => i.amountPaise,
    approved: (i) => i.approvedAmountPaise,
    decided: (i) => i.decidedAt,
    due: (i) => i.dueDate,
    financing: (i) => FINANCING_STATUS[i.financingStatus].label,
  });

  const financed = all.filter((i) => i.financingRequest && i.financingRequest.status !== "REJECTED");
  const notFinanced = all.filter((i) => !i.financingRequest || i.financingRequest.status === "REJECTED");
  const approvedValue = sumPaise(all.map((i) => i.approvedAmountPaise));

  return (
    <>
      <Masthead
        eyebrow="Invoices"
        title="Approved invoices"
        lede="Invoices you have accepted. Channel partners may take early payment from Veefin on the approved amount; your due dates are unaffected."
      />

      <MetricStrip className="mb-6 grid-cols-1 sm:mb-8 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Approved invoices"
          accent="heritage"
          value={<Figure unit={all.length === 1 ? "invoice" : "invoices"}>{all.length}</Figure>}
          caption={
            <>
              <Money paise={sumPaise(all.map((i) => i.amountPaise))} compact /> invoiced by partners
            </>
          }
        />
        <Metric label="Approved value" accent="heritage" value={<Money paise={approvedValue} compact size="xl" className="font-normal" />} caption="Total approved amount payable" />
        <Metric
          label="Financed by Veefin"
          accent="gold"
          value={<Money paise={sumPaise(financed.map((i) => i.approvedAmountPaise))} compact size="xl" className="font-normal" />}
          caption={`${plural(financed.length, "invoice")} with early payment requested or paid`}
          href="/builder/financed"
        />
        <Metric
          label="Not financed"
          accent="slate"
          value={<Money paise={sumPaise(notFinanced.map((i) => i.approvedAmountPaise))} compact size="xl" className="font-normal" />}
          caption={`${plural(notFinanced.length, "invoice")} payable directly to partners`}
        />
      </MetricStrip>

      <Panel
        title="Accepted invoices"
        description={
          rows.length > 0 ? (
            <>
              {plural(rows.length, "invoice")} · <Money paise={sumPaise(rows.map((r) => r.approvedAmountPaise))} compact /> approved
            </>
          ) : undefined
        }
        flush
      >
        <TableToolbar>
          <ListToolbar
            searchPlaceholder="Search invoice, reference or partner…"
            filters={[
              { param: "project", label: "Projects", options: projects.map((p) => ({ value: p.id, label: p.name })) },
              { param: "financing", label: "Financing statuses", options: FINANCING_FILTER.map((s) => ({ value: s, label: FINANCING_STATUS[s].label })) },
            ]}
          />
        </TableToolbar>
        {rows.length === 0 ? (
          all.length === 0 ? (
            <Empty
              icon={CheckCircle2}
              title="No approved invoices yet"
              description="Invoices you approve from the inbox appear here."
              action={
                <Button asChild>
                  <Link href="/builder/approvals">Go to the approval inbox</Link>
                </Button>
              }
            />
          ) : (
            <Empty icon={SearchX} title="No invoices match your filters" description="Try a different search term or clear the filters." />
          )
        ) : (
          <Ledger minWidth={960} caption="Accepted invoices">
            <thead>
              <tr>
                <SortTh label="Invoice" sortKey="number" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Partner" sortKey="cp" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Invoiced" sortKey="amount" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Approved" sortKey="approved" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Decided" sortKey="decided" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Due" sortKey="due" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Financing" sortKey="financing" sort={sort} searchParams={sp} pathname={PATH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((invoice) => {
                const partial = invoice.approvedAmountPaise !== null && invoice.approvedAmountPaise < invoice.amountPaise;
                return (
                  <Tr key={invoice.id}>
                    <Td>
                      <RowLink href={`/builder/invoices/${invoice.id}`}>{invoice.invoiceNumber}</RowLink>
                      <Ref>{invoice.reference}</Ref>
                    </Td>
                    <Td>
                      <p className="font-medium text-navy">{invoice.cp.name}</p>
                      <p className="mt-1 text-[0.75rem] text-muted-foreground">{invoice.project.name}</p>
                    </Td>
                    <Td align="right">
                      <Money paise={invoice.amountPaise} className="text-slate-ink" />
                    </Td>
                    <Td align="right">
                      {invoice.approvedAmountPaise !== null ? <Money paise={invoice.approvedAmountPaise} className="font-semibold text-heritage" /> : "—"}
                      {partial && <p className="mt-0.5 text-[0.6875rem] text-[#8a5a12]">Partial approval</p>}
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(invoice.decidedAt)}</Td>
                    <Td className="whitespace-nowrap">{formatDate(invoice.dueDate)}</Td>
                    <Td>
                      <StatusBadge kind="financing" status={invoice.financingStatus} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Ledger>
        )}
      </Panel>
    </>
  );
}
