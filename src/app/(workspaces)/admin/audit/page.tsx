import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { DataTable, Td, Th, Tr } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { requireWorkspace } from "@/server/auth/session";
import { getOrganisationDirectory, listAuditEntityTypes } from "@/server/queries/admin";
import { listAuditLogs } from "@/server/services/admin";
import { ENTITY_LABELS, param, ROLE_LABELS } from "../_components/labels";
import { OrgTypeBadge } from "../_components/org-type-badge";

export const metadata: Metadata = { title: "Audit logs" };

const PAGE_SIZE = 50;
const MAX_TAKE = 500;

function prettyMetadata(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function entityHref(entityType: string, entityId: string): string | null {
  if (entityType === "FinancingRequest") return `/admin/transactions/${entityId}`;
  if (entityType === "Organisation") return `/admin/organisations/${entityId}`;
  return null;
}

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

  const moreParams = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) if (typeof value === "string" && key !== "take") moreParams.set(key, value);
  moreParams.set("take", String(Math.min(take + PAGE_SIZE, MAX_TAKE)));

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Audit logs"
        description="An append-only record of every state change on the platform: who did what, when, and with which values. Entries cannot be edited or deleted."
      />
      <Section
        title={`${entries.length}${hasMore ? "+" : ""} entr${entries.length === 1 ? "y" : "ies"}`}
        description={hasMore ? `Showing the latest ${entries.length}. Load more to go further back.` : "Showing all matching entries, newest first."}
        bodyClassName="space-y-5"
      >
        <ListToolbar
          searchPlaceholder="Search summary, actor or action…"
          filters={[{ param: "entity", label: "Entity types", options: entityTypes.map((t) => ({ value: t, label: ENTITY_LABELS[t] ?? t })) }]}
        />
        {entries.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No audit entries match" description="Try a different search or clear the entity filter." />
        ) : (
          <DataTable minWidth={1240}>
            <thead>
              <tr>
                <Th>Timestamp</Th>
                <Th>Actor</Th>
                <Th>Organisation</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th className="w-[34%]">Summary</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const org = entry.actorOrgId ? directory.get(entry.actorOrgId) : undefined;
                const metadata = prettyMetadata(entry.metadata);
                const href = entityHref(entry.entityType, entry.entityId);
                return (
                  <Tr key={entry.id} className="align-top">
                    <Td className="align-top text-xs whitespace-nowrap">
                      <time dateTime={entry.createdAt.toISOString()}>{formatDateTime(entry.createdAt)}</time>
                    </Td>
                    <Td className="align-top">
                      <p className="font-medium text-navy">{entry.actorName}</p>
                      <p className="text-xs text-muted-foreground">{entry.actorRole ? (ROLE_LABELS[entry.actorRole] ?? entry.actorRole) : "System"}</p>
                    </Td>
                    <Td className="align-top">
                      {org ? (
                        <>
                          <Link href={`/admin/organisations/${org.id}`} className="text-navy hover:underline">
                            {org.name}
                          </Link>
                          <div className="mt-1">
                            <OrgTypeBadge type={org.type} />
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td className="align-top">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] whitespace-nowrap text-navy">{entry.action}</code>
                    </Td>
                    <Td className="align-top">
                      <p className="text-xs font-medium">{ENTITY_LABELS[entry.entityType] ?? entry.entityType}</p>
                      {href ? (
                        <Link href={href} className="font-mono text-[0.6875rem] text-navy hover:underline" title={entry.entityId}>
                          {entry.entityId.slice(0, 12)}…
                        </Link>
                      ) : (
                        <p className="font-mono text-[0.6875rem] break-all text-muted-foreground" title={entry.entityId}>
                          {entry.entityId.length > 24 ? `${entry.entityId.slice(0, 24)}…` : entry.entityId}
                        </p>
                      )}
                    </Td>
                    <Td className="align-top">
                      <p className="text-sm text-slate-ink">{entry.summary}</p>
                      {metadata && (
                        <details className="group mt-2">
                          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs font-medium text-navy select-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                            <ChevronDown className="size-3 transition-transform group-open:rotate-180" aria-hidden="true" />
                            Metadata
                          </summary>
                          <pre className="mt-2 max-h-72 max-w-[32rem] overflow-auto rounded-md whitespace-pre-wrap break-words bg-navy-900 px-3 py-2.5 font-mono text-[0.6875rem] leading-relaxed text-ivory">
                            {metadata}
                          </pre>
                        </details>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
        {hasMore && (
          <div className="flex justify-center pt-1">
            <Button variant="outline" asChild>
              <Link href={`/admin/audit?${moreParams.toString()}`} scroll={false}>
                Load {Math.min(PAGE_SIZE, MAX_TAKE - take)} more
              </Link>
            </Button>
          </div>
        )}
      </Section>
    </>
  );
}
