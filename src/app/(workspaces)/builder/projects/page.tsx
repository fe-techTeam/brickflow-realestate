import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { readSort, sortRows } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { StatusBadge } from "@/components/common/status-badge";
import type { RecordStatus } from "@/generated/prisma/enums";
import { sumPaise } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { listBuilderProjects } from "@/server/queries/builder";
import { Empty, Figure, Masthead, Metric, MetricStrip, Panel, ShareBar } from "../_components/kit";
import { Money } from "../_components/money";
import { Ledger, SortTh, TableToolbar, Td, Th, Tr } from "../_components/table";
import { enumParam, param, type SearchParams } from "../_lib/params";

export const metadata: Metadata = { title: "Projects" };

const PATH = "/builder/projects";
const SORT_KEYS = ["name", "city", "invoices", "value", "approved", "financed"] as const;

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireWorkspace("builder");
  const sp = await searchParams;
  const projects = await listBuilderProjects(actor);

  const q = param(sp, "q")?.toLowerCase();
  const status = enumParam<RecordStatus>(sp, "status", ["ACTIVE", "INACTIVE"]);
  const city = param(sp, "city");
  const sort = readSort(sp, SORT_KEYS, { key: "name", dir: "asc" });
  const cities = [...new Set(projects.map((p) => p.city))].sort();

  const filtered = projects.filter(
    (p) =>
      (!status || p.status === status) &&
      (!city || p.city === city) &&
      (!q || [p.name, p.code, p.city, p.location ?? "", p.reraNumber ?? ""].some((v) => v.toLowerCase().includes(q))),
  );
  const rows = sortRows(filtered, sort, {
    name: (p) => p.name,
    city: (p) => p.city,
    invoices: (p) => p.totals.invoiceCount,
    value: (p) => p.totals.invoiceValue,
    approved: (p) => p.totals.approvedValue,
    financed: (p) => p.totals.financedValue,
  });
  const invoiceCount = projects.reduce((n, p) => n + p.totals.invoiceCount, 0);

  return (
    <>
      <Masthead eyebrow="Directory" title="Projects" lede="Your RERA-registered projects and the channel partner invoices raised against each of them." />

      <MetricStrip className="mb-6 grid-cols-1 sm:mb-8 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Projects"
          value={<Figure unit={projects.length === 1 ? "project" : "projects"}>{projects.length}</Figure>}
          caption={`${projects.filter((p) => p.status === "ACTIVE").length} active · ${cities.length} ${cities.length === 1 ? "city" : "cities"}`}
        />
        <Metric
          label="Invoices raised"
          accent="slate"
          value={<Figure unit={invoiceCount === 1 ? "invoice" : "invoices"}>{invoiceCount}</Figure>}
          caption={
            <>
              <Money paise={sumPaise(projects.map((p) => p.totals.invoiceValue))} compact /> invoiced in total
            </>
          }
        />
        <Metric
          label="Approved value"
          accent="leaf"
          value={<Money paise={sumPaise(projects.map((p) => p.totals.approvedValue))} compact size="xl" className="font-normal" />}
          caption="Approved amount of accepted invoices"
        />
        <Metric
          label="Financed value"
          accent="kota"
          value={<Money paise={sumPaise(projects.map((p) => p.totals.financedValue))} compact size="xl" className="font-normal" />}
          caption="Paid early to partners by Veefin"
        />
      </MetricStrip>

      <Panel title="All projects" description={`${rows.length} of ${projects.length} shown`} flush>
        <TableToolbar>
          <ListToolbar
            searchPlaceholder="Search project, code, location or RERA…"
            filters={[
              { param: "city", label: "Cities", options: cities.map((c) => ({ value: c, label: c })) },
              { param: "status", label: "Statuses", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] },
            ]}
          />
        </TableToolbar>
        {rows.length === 0 ? (
          <Empty
            icon={Building2}
            title={projects.length === 0 ? "No projects registered" : "No projects match your filters"}
            description={projects.length === 0 ? "Projects are configured by the platform administrator." : "Try a different search term or clear the filters."}
          />
        ) : (
          <Ledger minWidth={960} caption="Projects">
            <thead>
              <tr>
                <SortTh label="Project" sortKey="name" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="Location · RERA" sortKey="city" sort={sort} searchParams={sp} pathname={PATH} />
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
                      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-basalt text-kota">
                        <Building2 className="size-4" strokeWidth={1.5} />
                      </span>
                      <span className="min-w-0">
                        <Link
                          href={`/builder/approvals?view=all&project=${p.id}`}
                          className="font-display text-[1.0625rem] font-semibold whitespace-nowrap text-basalt decoration-kota/60 underline-offset-[5px] hover:underline"
                          title={`View invoices for ${p.name}`}
                        >
                          {p.name}
                        </Link>
                        <span className="mt-0.5 block font-mono text-[0.6875rem] text-muted-foreground">{p.code}</span>
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <p className="text-basalt">{p.city}</p>
                    {p.location && <p className="mt-1 text-[0.75rem] text-muted-foreground">{p.location}</p>}
                    <p className="mt-1 font-mono text-[0.6875rem] tracking-tight text-muted-foreground">RERA {p.reraNumber ?? "—"}</p>
                  </Td>
                  <Td>
                    <StatusBadge kind="record" status={p.status} />
                  </Td>
                  <Td align="right">
                    <span className="font-medium text-basalt">{p.totals.invoiceCount}</span>
                    {p.totals.openCount > 0 && <p className="mt-1 text-[0.6875rem] text-[#8a5a12]">{p.totals.openCount} open</p>}
                  </Td>
                  <Td align="right">
                    <Money paise={p.totals.invoiceValue} />
                  </Td>
                  <Td align="right">
                    <Money paise={p.totals.approvedValue} className="font-medium text-leaf" />
                  </Td>
                  <Td align="right">
                    <Money paise={p.totals.financedValue} className="text-basalt" />
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
