import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { OrganisationType } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { ENTITY_LABELS, ROLE_LABELS } from "./labels";
import { OrgTypeBadge } from "./org-type-badge";

export interface ActivityItem {
  id: string;
  createdAt: Date;
  summary: string;
  actorName: string;
  actorRole: string | null;
  actorOrgId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: string | null;
}

type Directory = Map<string, { id: string; name: string; type: OrganisationType }>;

const time = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const shortDay = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
const longDay = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

/** Dot colour for an audit action: gold for pricing, green for positive outcomes, red for refusals. */
export function actionTone(action: string): "gold" | "heritage" | "danger" | "muted" | "navy" {
  const a = action.toLowerCase();
  if (a.includes("programme") || a.includes("setting")) return "gold";
  if (/(reject|deactivat|inactive|fail|withdraw)/.test(a)) return "danger";
  if (/(approv|accept|disburs|settled|activat|create)/.test(a)) return "heritage";
  if (a.startsWith("session")) return "muted";
  return "navy";
}

const DOT = {
  gold: "bg-gold ring-gold/25",
  heritage: "bg-heritage ring-heritage/20",
  danger: "bg-danger ring-danger/20",
  muted: "bg-slate-ink/30 ring-slate-ink/10",
  navy: "bg-navy ring-navy/15",
};

export function entityHref(entityType: string, entityId: string): string | null {
  if (entityType === "FinancingRequest") return `/admin/transactions/${entityId}`;
  if (entityType === "Organisation") return `/admin/organisations/${entityId}`;
  if (entityType === "FinancingProgramme") return "/admin/financing";
  if (entityType === "PlatformSetting") return "/admin/settings";
  return null;
}

function ActionCode({ action }: { action: string }) {
  return (
    <code className="rounded-[5px] border border-border/80 bg-ivory/70 px-1.5 py-0.5 font-mono text-[0.6875rem] whitespace-nowrap text-navy/80">{action}</code>
  );
}

/** Compact timeline for the dashboard: time, a hairline rail and the summary. */
export function ActivityTimeline({ entries, directory }: { entries: ActivityItem[]; directory: Directory }) {
  return (
    <ol className="relative">
      {entries.map((entry, i) => {
        const org = entry.actorOrgId ? directory.get(entry.actorOrgId) : undefined;
        const tone = actionTone(entry.action);
        return (
          <li key={entry.id} className="grid grid-cols-[3.75rem_1.5rem_1fr] gap-x-2 sm:grid-cols-[4.5rem_1.75rem_1fr]">
            <time dateTime={entry.createdAt.toISOString()} className="tabular pt-0.5 text-right font-sans leading-tight">
              <span className="block text-[0.8125rem] font-medium text-navy">{time.format(entry.createdAt)}</span>
              <span className="block text-[0.6875rem] text-muted-foreground">{shortDay.format(entry.createdAt)}</span>
            </time>
            <span aria-hidden="true" className="relative flex justify-center">
              {i < entries.length - 1 && <span className="absolute top-3 bottom-0 w-px bg-border" />}
              <span className={cn("relative mt-1.5 size-2 rounded-full ring-4", DOT[tone])} />
            </span>
            <div className={cn("min-w-0", i < entries.length - 1 ? "pb-6" : "pb-1")}>
              <p className="text-sm leading-snug text-slate-ink">{entry.summary}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="font-medium text-navy/80">{entry.actorName}</span>
                {org && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{org.name}</span>
                  </>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function MetadataView({ raw }: { raw: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const entries = Object.entries(parsed as Record<string, unknown>);
    return (
      <dl className="grid gap-x-6 gap-y-2.5 rounded-lg border border-border/80 bg-ivory/50 px-4 py-3.5 sm:grid-cols-[minmax(8rem,auto)_1fr]">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-[0.625rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase sm:pt-0.5">{key}</dt>
            <dd className="font-mono text-[0.75rem] break-all whitespace-pre-wrap text-navy">
              {typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? String(value) : JSON.stringify(value, null, 2)}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <pre className="max-h-72 overflow-auto rounded-lg bg-navy-900 px-4 py-3 font-mono text-[0.6875rem] leading-relaxed break-words whitespace-pre-wrap text-ivory">
      {parsed === undefined ? raw : JSON.stringify(parsed, null, 2)}
    </pre>
  );
}

/** Full audit log grouped by day, with an expandable metadata ledger per entry. */
export function AuditLedger({ entries, directory }: { entries: ActivityItem[]; directory: Directory }) {
  const groups: { key: string; label: string; items: ActivityItem[] }[] = [];
  for (const entry of entries) {
    const key = dayKey.format(entry.createdAt);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(entry);
    else groups.push({ key, label: longDay.format(entry.createdAt), items: [entry] });
  }

  return (
    <div className="space-y-10">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <div className="mb-4 flex items-baseline gap-4">
            <h3 className="font-display text-[1.25rem] font-semibold whitespace-nowrap">{group.label}</h3>
            <span aria-hidden="true" className="h-px flex-1 translate-y-[-3px] bg-gradient-to-r from-gold/50 to-border/40" />
            <span className="tabular text-xs whitespace-nowrap text-muted-foreground">
              {group.items.length} {group.items.length === 1 ? "entry" : "entries"}
            </span>
          </div>
          <ol>
            {group.items.map((entry, i) => {
              const org = entry.actorOrgId ? directory.get(entry.actorOrgId) : undefined;
              const href = entityHref(entry.entityType, entry.entityId);
              const tone = actionTone(entry.action);
              const last = i === group.items.length - 1;
              return (
                <li key={entry.id} className="grid grid-cols-[3rem_1.25rem_1fr] gap-x-2 sm:grid-cols-[4rem_1.75rem_1fr]">
                  <time dateTime={entry.createdAt.toISOString()} className="tabular pt-0.5 text-right font-sans text-[0.8125rem] font-medium text-navy">
                    {time.format(entry.createdAt)}
                  </time>
                  <span aria-hidden="true" className="relative flex justify-center">
                    {!last && <span className="absolute top-3 bottom-0 w-px bg-border" />}
                    <span className={cn("relative mt-1.5 size-2 rounded-full ring-4", DOT[tone])} />
                  </span>
                  <div className={cn("min-w-0", last ? "pb-1" : "pb-7")}>
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
                      <div className="min-w-0">
                        <p className="text-[0.9375rem] leading-snug text-navy">{entry.summary}</p>
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span className="font-medium text-slate-ink">{entry.actorName}</span>
                          <span aria-hidden="true">·</span>
                          <span>{entry.actorRole ? (ROLE_LABELS[entry.actorRole] ?? entry.actorRole) : "System"}</span>
                          {org && (
                            <>
                              <span aria-hidden="true">·</span>
                              <Link href={`/admin/organisations/${org.id}`} className="text-navy/80 hover:text-navy hover:underline">
                                {org.name}
                              </Link>
                              <OrgTypeBadge type={org.type} />
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                        <ActionCode action={entry.action} />
                        <span className="text-[0.6875rem] text-muted-foreground">
                          {ENTITY_LABELS[entry.entityType] ?? entry.entityType}{" "}
                          {href ? (
                            <Link href={href} className="font-mono text-navy/80 hover:text-navy hover:underline" title={entry.entityId}>
                              {entry.entityId.slice(0, 10)}…
                            </Link>
                          ) : (
                            <span className="font-mono" title={entry.entityId}>
                              {entry.entityId.length > 14 ? `${entry.entityId.slice(0, 14)}…` : entry.entityId}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    {entry.metadata && (
                      <details className="group/meta mt-2.5">
                        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-[0.75rem] font-medium text-gold-600 select-none hover:text-navy focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                          <ChevronDown className="size-3.5 transition-transform group-open/meta:rotate-180" aria-hidden="true" />
                          <span className="group-open/meta:hidden">Show recorded values</span>
                          <span className="hidden group-open/meta:inline">Hide recorded values</span>
                        </summary>
                        <div className="mt-3 max-w-3xl">
                          <MetadataView raw={entry.metadata} />
                        </div>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

export interface EventItem {
  id: string;
  title: string;
  at: Date;
  actor: string;
  body?: string;
  tone: keyof typeof DOT;
}

/** Chronological event rail for a single record (invoice review and financing steps). */
export function EventTimeline({ events }: { events: EventItem[] }) {
  return (
    <ol>
      {events.map((e, i) => {
        const last = i === events.length - 1;
        return (
          <li key={e.id} className="grid grid-cols-[1.25rem_1fr] gap-x-3">
            <span aria-hidden="true" className="relative flex justify-center">
              {!last && <span className="absolute top-3 bottom-0 w-px bg-border" />}
              <span className={cn("relative mt-1.5 size-2 rounded-full ring-4", DOT[e.tone])} />
            </span>
            <div className={cn("min-w-0", last ? "pb-1" : "pb-6")}>
              <p className="text-sm font-medium text-navy">{e.title}</p>
              <p className="tabular mt-0.5 text-xs text-muted-foreground">
                {e.actor} · {shortDay.format(e.at)}, {time.format(e.at)}
              </p>
              {e.body && <p className="mt-2 rounded-md border-l-2 border-gold/60 bg-ivory/60 px-3 py-2 text-[0.8125rem] leading-relaxed text-slate-ink">{e.body}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
