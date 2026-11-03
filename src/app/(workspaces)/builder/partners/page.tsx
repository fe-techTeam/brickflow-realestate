import type { Metadata } from "next";
import Link from "next/link";
import { Handshake } from "lucide-react";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { StatusBadge } from "@/components/common/status-badge";
import type { RecordStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { sumPaise } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { listBuilderPartners } from "@/server/queries/builder";
import { Empty, Figure, Masthead, Metric, MetricStrip, Monogram, Panel, ShareBar } from "../_components/kit";
import { Money } from "../_components/money";
import { Ledger, SortTh, TableToolbar, Td, Th, Tr } from "../_components/table";
import { enumParam, param, type SearchParams } from "../_lib/params";

export const metadata: Metadata = { title: "Channel partners" };

const PATH = "/builder/partners";
const SORT_KEYS = ["name", "code", "credit", "invoices", "value", "approved", "financed"] as const;

export default async function PartnersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireWorkspace("builder");
  const sp = await searchParams;
  const partners = await listBuilderPartners(actor);

  const q = param(sp, "q")?.toLowerCase();
  const status = enumParam<RecordStatus>(sp, "status", ["ACTIVE", "INACTIVE"]);
  const sort = readSort(sp, SORT_KEYS, { key: "name", dir: "asc" });

  const filtered = partners.filter(
    (p) =>
      (!status || p.status === status) &&
      (!q || [p.cp.name, p.cp.legalName, p.empanelmentCode, p.cp.gstin ?? "", p.cp.city ?? ""].some((v) => v.toLowerCase().includes(q))),
  );
  const rows = sortRows(filtered, sort, {
    name: (p) => p.cp.name,
    code: (p) => p.empanelmentCode,
    credit: (p) => p.creditPeriodDays,
    invoices: (p) => p.totals.invoiceCount,
    value: (p) => p.totals.invoiceValue,
    approved: (p) => p.totals.approvedValue,
    financed: (p) => p.totals.financedValue,
  });

  const active = partners.filter((p) => p.status === "ACTIVE").length;
  const approved = sumPaise(partners.map((p) => p.totals.approvedValue));
  const financed = sumPaise(partners.map((p) => p.totals.financedValue));
  const share = approved > 0n ? Number((financed * 1000n) / approved) / 10 : 0;

  return (
    <>
      <Masthead
        eyebrow="Directory"
        title="Channel partners"
        lede="Brokers empanelled with you. Credit periods set here define the original due date when an invoice does not state one."
      />

      <MetricStrip className="mb-6 grid-cols-1 sm:mb-8 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Empanelled partners" value={<Figure unit={partners.length === 1 ? "partner" : "partners"}>{partners.length}</Figure>} caption={`${active} active`} />
        <Metric
          label="Invoice value received"
          accent="slate"
          value={<Money paise={sumPaise(partners.map((p) => p.totals.invoiceValue))} compact size="xl" className="font-normal" />}
          caption="All submitted invoices"
        />
        <Metric label="Approved value" accent="heritage" value={<Money paise={approved} compact size="xl" className="font-normal" />} caption="Approved amount of accepted invoices" />
        <Metric
          label="Financed value"
          accent="gold"
          value={<Money paise={financed} compact size="xl" className="font-normal" />}
          caption={`${share.toFixed(1)}% of approved value paid early by Veefin`}
        />
      </MetricStrip>

      <Panel title="Empanelled channel partners" description={`${rows.length} of ${partners.length} shown`} flush>
        <TableToolbar>
          <ListToolbar
            searchPlaceholder="Search partner, code or GSTIN…"
            filters={[{ param: "status", label: "Statuses", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] }]}
          />
        </TableToolbar>
        {rows.length === 0 ? (
          <Empty
            icon={Handshake}
            title={partners.length === 0 ? "No channel partners empanelled" : "No partners match your filters"}
            description={partners.length === 0 ? "Empanelments are configured by the platform administrator." : "Try a different search term or clear the filters."}
          />
        ) : (
          <Ledger minWidth={980} caption="Empanelled channel partners">
            <thead>
              <tr>
                <SortTh label="Partner" sortKey="name" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Empanelment" sortKey="code" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Credit" sortKey="credit" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <Th>Status</Th>
                <SortTh label="Invoices" sortKey="invoices" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Invoiced" sortKey="value" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Approved" sortKey="approved" sort={sort} searchParams={sp} pathname={PATH} align="right" />
                <SortTh label="Financed" sortKey="financed" sort={sort} searchParams={sp} pathname={PATH} align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <span className="flex items-center gap-3.5">
                      <Monogram name={p.cp.name} />
                      <span className="min-w-0">
                        <Link
                          href={`/builder/approvals?view=all&q=${encodeURIComponent(p.cp.name)}`}
                          className="font-medium text-navy decoration-gold/60 underline-offset-[5px] hover:underline"
                          title={`View invoices from ${p.cp.name}`}
                        >
                          {p.cp.name}
                        </Link>
                        <span className="mt-1 block text-[0.75rem] text-muted-foreground">
                          {p.cp.gstin ? <span className="font-mono">{p.cp.gstin}</span> : "GSTIN not recorded"}
                          {p.cp.city ? ` · ${p.cp.city}` : ""}
                        </span>
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <p className="font-mono text-[0.75rem] text-slate-ink">{p.empanelmentCode}</p>
                    <p className="mt-1 text-[0.75rem] text-muted-foreground">Since {formatDate(p.empanelledAt)}</p>
                  </Td>
                  <Td align="right">
                    {p.creditPeriodDays} <span className="text-muted-foreground">days</span>
                  </Td>
                  <Td>
                    <StatusBadge kind="record" status={p.status} />
                  </Td>
                  <Td align="right">
                    <span className="font-medium text-navy">{p.totals.invoiceCount}</span>
                    {p.totals.openCount > 0 && <p className="mt-1 text-[0.6875rem] text-[#8a5a12]">{p.totals.openCount} open</p>}
                  </Td>
                  <Td align="right">
                    <Money paise={p.totals.invoiceValue} />
                  </Td>
                  <Td align="right">
                    <Money paise={p.totals.approvedValue} className="font-medium text-heritage" />
                  </Td>
                  <Td align="right">
                    <Money paise={p.totals.financedValue} className="text-navy" />
                    <span className="mt-1.5 flex justify-end">
                      <ShareBar part={p.totals.financedValue} whole={p.totals.approvedValue} />
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Ledger>
        )}
      </Panel>
    </>
  );
}
