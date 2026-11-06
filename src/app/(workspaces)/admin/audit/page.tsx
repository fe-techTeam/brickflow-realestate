import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, Download, Lock, ScrollText } from "lucide-react";
import { ListToolbar } from "@/components/common/list-toolbar";
import { Button } from "@/components/ui/button";
import { requireWorkspace } from "@/server/auth/session";
import { getOrganisationDirectory } from "@/server/queries/admin";
import { getAuditFilterOptions, hasAuditFilters, parseAuditFilters, searchAuditLogs, type AuditFilters } from "@/server/queries/audit";
import { getAuditIntegrity } from "@/server/services/audit-integrity";
import { AuditLedger } from "../_components/activity";
import { AdminHeader, Empty, FilterChips, Panel } from "../_components/editorial";
import { ENTITY_LABELS, param } from "../_components/labels";
import { DateRangeFilter } from "./_components/date-range-filter";
import { IntegrityPanel } from "./_components/integrity-panel";

export const metadata: Metadata = { title: "Audit logs" };

const FEATURED_ENTITIES = ["FinancingProgramme", "FinancingRequest", "Invoice", "Organisation", "User", "PlatformSetting"];

function filterQuery(filters: AuditFilters, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return params.toString();
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("admin");
  const sp = await searchParams;
  const filters = parseAuditFilters(sp);
  const cursor = param(sp.cursor);

  const [page, directory, options, integrity] = await Promise.all([
    searchAuditLogs(actor, filters, { cursor }),
    getOrganisationDirectory(actor),
    getAuditFilterOptions(actor),
    getAuditIntegrity(actor),
  ]);
  const { entries, nextCursor, paged } = page;
  const featured = FEATURED_ENTITIES.filter((t) => options.entityTypes.includes(t));
  const organisations = [...directory.values()].sort((a, b) => a.name.localeCompare(b.name));
  const filtered = hasAuditFilters(filters);
  const query = filterQuery(filters);

  return (
    <>
      <AdminHeader
        eyebrow="Platform · Governance"
        title="Audit logs"
        lede="An append-only, hash-chained record of every state change on the platform: who did what, when, and with which values."
        meta={
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5 text-fg-muted" strokeWidth={1.6} aria-hidden="true" />
            Entries cannot be edited or deleted without breaking the chain
          </span>
        }
        actions={
          <Button variant="outline" asChild>
            <a href={`/api/admin/audit/export${query ? `?${query}` : ""}`} download>
              <Download aria-hidden="true" />
              Export CSV
            </a>
          </Button>
        }
      />
      <IntegrityPanel overview={integrity} canVerify={actor.role === "SUPER_ADMIN"} />
      <Panel
        eyebrow="The record"
        title={paged ? "Earlier entries" : filtered ? "Matching entries" : "Latest entries"}
        description={
          entries.length === 0
            ? "Nothing to show for this selection."
            : `Showing ${entries.length} ${entries.length === 1 ? "entry" : "entries"}, newest first${nextCursor ? "; older entries follow" : ""}. Dates use India Standard Time.`
        }
        bodyClassName="space-y-5"
      >
        <FilterChips
          label="Record type"
          param="entity"
          pathname="/admin/audit"
          searchParams={Object.fromEntries(Object.entries(sp).filter(([key]) => key !== "cursor"))}
          allLabel="Everything"
          options={featured.map((t) => ({ value: t, label: ENTITY_LABELS[t] ?? t }))}
        />
        <div className="space-y-3">
          <ListToolbar
            searchPlaceholder="Search entries…"
            filters={[
              { param: "entity", label: "Record types", options: options.entityTypes.map((t) => ({ value: t, label: ENTITY_LABELS[t] ?? t })) },
              { param: "action", label: "Actions", options: options.actions.map((a) => ({ value: a, label: a })) },
              { param: "org", label: "Organisations", options: organisations.map((o) => ({ value: o.id, label: o.name })) },
              { param: "actor", label: "People", options: options.actors.map((a) => ({ value: a.id, label: a.name })) },
            ]}
          />
          <DateRangeFilter />
        </div>
        <div className="border-t border-border/70 pt-7">
          {entries.length === 0 ? (
            <Empty
              icon={ScrollText}
              title="No audit entries match"
              description={filtered ? "Try a wider date range or clear some filters." : "Entries appear here as soon as anything changes on the platform."}
            />
          ) : (
            <AuditLedger entries={entries} directory={directory} />
          )}
        </div>
        {(nextCursor || paged) && (
          <nav aria-label="Audit log pages" className="flex flex-wrap items-center justify-center gap-3 border-t border-border/70 pt-6">
            {paged && (
              <Button variant="ghost" asChild>
                <Link href={`/admin/audit${query ? `?${query}` : ""}`} scroll={false}>
                  <ArrowUp aria-hidden="true" />
                  Back to newest
                </Link>
              </Button>
            )}
            {nextCursor && (
              <Button variant="outline" asChild className="bg-card">
                <Link href={`/admin/audit?${filterQuery(filters, { cursor: nextCursor })}`} scroll={false}>
                  <ArrowDown aria-hidden="true" />
                  Older entries
                </Link>
              </Button>
            )}
          </nav>
        )}
      </Panel>
    </>
  );
}
