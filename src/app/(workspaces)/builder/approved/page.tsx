import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleDashed, HandCoins, SearchX, Wallet } from "lucide-react";
import { DataTable, readSort, SortTh, sortRows, Td, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import type { FinancingStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { FINANCING_STATUS } from "@/lib/status";
import { requireWorkspace } from "@/server/auth/session";
import { listBuilderProjectOptions } from "@/server/queries/builder";
import { listInvoices } from "@/server/services/invoices";
import { ToolbarRow } from "../_components/toolbar-row";
import { enumParam, param, type SearchParams } from "../_lib/params";

export const metadata: Metadata = { title: "Approved invoices" };

const PATH = "/builder/approved";
const FINANCING_FILTER: FinancingStatus[] = ["NOT_REQUESTED", "OFFER_GENERATED", "PENDING_APPROVAL", "APPROVED", "DISBURSEMENT_INITIATED", "DISBURSED", "REJECTED"];
const SORT_KEYS = ["cp", "number", "project", "amount", "approved", "decided", "due", "financing"] as const;

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
      <PageHeader
        eyebrow="Invoices"
        title="Approved invoices"
        description="Invoices you have accepted. Channel partners may take early payment from Veefin on the approved amount; your due dates are unaffected."
      />

      <StatGrid className="mb-8 xl:grid-cols-4 2xl:grid-cols-4">
        <StatCard label="Approved invoices" value={all.length} hint={`${formatINRCompact(sumPaise(all.map((i) => i.amountPaise)))} invoiced`} icon={CheckCircle2} tone="heritage" />
        <StatCard label="Approved value" value={formatINRCompact(approvedValue)} hint="Total approved amount payable" icon={Wallet} />
        <StatCard
          label="Financed by Veefin"
          value={formatINRCompact(sumPaise(financed.map((i) => i.approvedAmountPaise)))}
          hint={`${financed.length} ${financed.length === 1 ? "invoice" : "invoices"} with early payment requested or paid`}
          icon={HandCoins}
          tone="gold"
          href="/builder/financed"
        />
        <StatCard
          label="Not financed"
          value={formatINRCompact(sumPaise(notFinanced.map((i) => i.approvedAmountPaise)))}
          hint={`${notFinanced.length} ${notFinanced.length === 1 ? "invoice" : "invoices"} payable directly to partners`}
          icon={CircleDashed}
          tone="slate"
        />
      </StatGrid>

      <Section
        title="Accepted invoices"
        description={rows.length > 0 ? `${rows.length} ${rows.length === 1 ? "invoice" : "invoices"} · ${formatINRCompact(sumPaise(rows.map((r) => r.approvedAmountPaise)))} approved` : undefined}
        bodyClassName="py-0"
      >
        <ToolbarRow>
          <ListToolbar
            searchPlaceholder="Search invoice, reference or partner…"
            filters={[
              { param: "project", label: "Projects", options: projects.map((p) => ({ value: p.id, label: p.name })) },
              { param: "financing", label: "Financing statuses", options: FINANCING_FILTER.map((s) => ({ value: s, label: FINANCING_STATUS[s].label })) },
            ]}
          />
        </ToolbarRow>
        {rows.length === 0 ? (
          all.length === 0 ? (
            <EmptyState
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
            <EmptyState icon={SearchX} title="No invoices match your filters" description="Try a different search term or clear the filters." />
          )
        ) : (
          <DataTable minWidth={1000}>
            <thead>
              <tr>
                <SortTh label="Partner" sortKey="cp" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Invoice no." sortKey="number" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Project" sortKey="project" sort={sort} searchParams={sp} pathname={PATH} />
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
                    <Td className="font-medium text-navy">{invoice.cp.name}</Td>
                    <Td>
                      <Link href={`/builder/invoices/${invoice.id}`} className="font-medium text-navy underline-offset-4 hover:underline">
                        {invoice.invoiceNumber}
                      </Link>
                      <p className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">{invoice.reference}</p>
                    </Td>
                    <Td>{invoice.project.name}</Td>
                    <Td align="right">{formatINR(invoice.amountPaise)}</Td>
                    <Td align="right" className="font-medium text-heritage">
                      {invoice.approvedAmountPaise !== null ? formatINR(invoice.approvedAmountPaise) : "—"}
                      {partial && <p className="text-[0.6875rem] font-normal text-muted-foreground">Partial approval</p>}
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
          </DataTable>
        )}
      </Section>
    </>
  );
}
