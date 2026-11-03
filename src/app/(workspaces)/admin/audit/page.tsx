import type { Metadata } from "next";
import Link from "next/link";
import { Lock, ScrollText } from "lucide-react";
import { ListToolbar } from "@/components/common/list-toolbar";
import { Button } from "@/components/ui/button";
import { requireWorkspace } from "@/server/auth/session";
import { getOrganisationDirectory, listAuditEntityTypes } from "@/server/queries/admin";
import { listAuditLogs } from "@/server/services/admin";
import { AuditLedger } from "../_components/activity";
import { AdminHeader, Empty, FilterChips, Panel } from "../_components/editorial";
import { ENTITY_LABELS, param } from "../_components/labels";

export const metadata: Metadata = { title: "Audit logs" };

const PAGE_SIZE = 50;
const MAX_TAKE = 500;
const FEATURED_ENTITIES = ["FinancingProgramme", "FinancingRequest", "Invoice", "Organisation", "User", "PlatformSetting"];

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspace("admin");
  const sp = await searchParams;
  const requested = Number.parseInt(param(sp.take) ?? "", 10);
  const take = Number.isFinite(requested) ? Math.min(Math.max(requested, PAGE_SIZE), MAX_TAKE) : PAGE_SIZE;
  const entityType = param(sp.entity);
  const search = param(sp.q);

  const [fetched, directory, entityTypes] = await Promise.all([
    listAuditLogs(actor, { entityType, search, take: take + 1 }),
    getOrganisationDirectory(actor),
    listAuditEntityTypes(actor),
  ]);
  const hasMore = fetched.length > take && take < MAX_TAKE;
  const entries = fetched.slice(0, take);
  const featured = FEATURED_ENTITIES.filter((t) => entityTypes.includes(t));

  const moreParams = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) if (typeof value === "string" && key !== "take") moreParams.set(key, value);
  moreParams.set("take", String(Math.min(take + PAGE_SIZE, MAX_TAKE)));

  return (
    <>
      <AdminHeader
        eyebrow="Platform · Governance"
        title="Audit logs"
        lede="An append-only record of every state change on the platform: who did what, when, and with which values."
        meta={
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5 text-fg-muted" strokeWidth={1.6} aria-hidden="true" />
            Entries cannot be edited or deleted
          </span>
        }
      />
      <Panel
        eyebrow="The record"
        title={`${entries.length}${hasMore ? "+" : ""} entr${entries.length === 1 ? "y" : "ies"}`}
        description={hasMore ? `Showing the latest ${entries.length}. Load more to go further back.` : "Showing all matching entries, newest first."}
        bodyClassName="space-y-5"
      >
        <FilterChips
          label="Record type"
          param="entity"
          pathname="/admin/audit"
          searchParams={sp}
          allLabel="Everything"
          options={featured.map((t) => ({ value: t, label: ENTITY_LABELS[t] ?? t }))}
        />
        <ListToolbar
          searchPlaceholder="Search summary, actor or action…"
          filters={[{ param: "entity", label: "Entity types", options: entityTypes.map((t) => ({ value: t, label: ENTITY_LABELS[t] ?? t })) }]}
        />
        <div className="border-t border-border/70 pt-7">
          {entries.length === 0 ? (
            <Empty icon={ScrollText} title="No audit entries match" description="Try a different search or clear the record-type filter." />
          ) : (
            <AuditLedger entries={entries} directory={directory} />
          )}
        </div>
        {hasMore && (
          <div className="flex justify-center border-t border-border/70 pt-6">
            <Button variant="outline" asChild className="bg-card">
              <Link href={`/admin/audit?${moreParams.toString()}`} scroll={false}>
                Load {Math.min(PAGE_SIZE, MAX_TAKE - take)} earlier entries
              </Link>
            </Button>
          </div>
        )}
      </Panel>
    </>
  );
}
