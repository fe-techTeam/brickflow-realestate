import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CheckCircle2, FileStack, HandCoins } from "lucide-react";
import { DataTable, readSort, SortTh, sortRows, Td, Th, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatCard, StatGrid } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import type { RecordStatus } from "@/generated/prisma/enums";
import { formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { listBuilderProjects } from "@/server/queries/builder";
import { ToolbarRow } from "../_components/toolbar-row";
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

  return (
    <>
      <PageHeader eyebrow="Directory" title="Projects" description="Your RERA-registered projects and the channel partner invoices raised against each of them." />

      <StatGrid className="mb-8 xl:grid-cols-4 2xl:grid-cols-4">
        <StatCard label="Projects" value={projects.length} hint={`${projects.filter((p) => p.status === "ACTIVE").length} active · ${cities.length} ${cities.length === 1 ? "city" : "cities"}`} icon={Building2} />
        <StatCard
          label="Invoices raised"
          value={projects.reduce((n, p) => n + p.totals.invoiceCount, 0)}
          hint={`${formatINRCompact(sumPaise(projects.map((p) => p.totals.invoiceValue)))} invoiced in total`}
          icon={FileStack}
          tone="slate"
        />
        <StatCard label="Approved value" value={formatINRCompact(sumPaise(projects.map((p) => p.totals.approvedValue)))} hint="Approved amount of accepted invoices" icon={CheckCircle2} tone="heritage" />
        <StatCard label="Financed value" value={formatINRCompact(sumPaise(projects.map((p) => p.totals.financedValue)))} hint="Paid early to partners by Veefin" icon={HandCoins} tone="gold" />
      </StatGrid>

      <Section title="All projects" description={`${rows.length} of ${projects.length} shown`} bodyClassName="py-0">
        <ToolbarRow>
          <ListToolbar
            searchPlaceholder="Search project, code, location or RERA…"
            filters={[
              { param: "city", label: "Cities", options: cities.map((c) => ({ value: c, label: c })) },
              { param: "status", label: "Statuses", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] },
            ]}
          />
        </ToolbarRow>
        {rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={projects.length === 0 ? "No projects registered" : "No projects match your filters"}
            description={projects.length === 0 ? "Projects are configured by the platform administrator." : "Try a different search term or clear the filters."}
          />
        ) : (
          <DataTable minWidth={980}>
            <thead>
              <tr>
                <SortTh label="Project" sortKey="name" sort={sort} searchParams={sp} pathname={PATH} />
                <SortTh label="City / location" sortKey="city" sort={sort} searchParams={sp} pathname={PATH} />
                <Th>RERA registration</Th>
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
                    <Link href={`/builder/approvals?view=all&project=${p.id}`} className="font-medium text-navy underline-offset-4 hover:underline" title={`View invoices for ${p.name}`}>
                      {p.name}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{p.code}</p>
                  </Td>
                  <Td>
                    <p>{p.city}</p>
                    {p.location && <p className="mt-0.5 text-xs text-muted-foreground">{p.location}</p>}
                  </Td>
                  <Td className="font-mono text-xs">{p.reraNumber ?? "—"}</Td>
                  <Td>
                    <StatusBadge kind="record" status={p.status} />
                  </Td>
                  <Td align="right">
                    {p.totals.invoiceCount}
                    {p.totals.openCount > 0 && <p className="text-xs text-muted-foreground">{p.totals.openCount} open</p>}
                  </Td>
                  <Td align="right">{formatINR(p.totals.invoiceValue)}</Td>
                  <Td align="right" className="text-heritage">
                    {formatINR(p.totals.approvedValue)}
                  </Td>
                  <Td align="right">{formatINR(p.totals.financedValue)}</Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>
    </>
  );
}
