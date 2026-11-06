import "server-only";
import { createHash } from "node:crypto";
import type { AuditLog, Prisma } from "@/generated/prisma/client";
import type { Actor } from "../auth/session";
import { db } from "../db";
import { forbidden } from "../errors";

/** Audit log filters as they appear in the URL. Dates are calendar days in India Standard Time. */
export interface AuditFilters {
  from?: string;
  to?: string;
  actor?: string;
  org?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  q?: string;
}

const FILTER_KEYS = ["from", "to", "actor", "org", "action", "entity", "entityId", "q"] as const satisfies readonly (keyof AuditFilters)[];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IST_OFFSET = "+05:30";
const MAX_FILTER_LENGTH = 200;

export const AUDIT_PAGE_SIZE = 50;
export const MAX_AUDIT_EXPORT_ROWS = 50_000;

function validDate(value: string | undefined): string | undefined {
  if (!value || !DATE.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : undefined;
}

/** Reads and sanitises filters from URL search params; unknown or malformed values are dropped. */
export function parseAuditFilters(source: URLSearchParams | Record<string, string | string[] | undefined>): AuditFilters {
  const get = (key: string) => {
    const raw = source instanceof URLSearchParams ? source.get(key) : source[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const trimmed = value?.trim();
    return trimmed ? trimmed.slice(0, MAX_FILTER_LENGTH) : undefined;
  };
  const filters: AuditFilters = {};
  for (const key of FILTER_KEYS) {
    const value = key === "from" || key === "to" ? validDate(get(key)) : get(key);
    if (value) filters[key] = value;
  }
  return filters;
}

export function hasAuditFilters(filters: AuditFilters): boolean {
  return FILTER_KEYS.some((key) => filters[key] !== undefined);
}

/** Start of the given IST calendar day as an instant. */
function istDayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000${IST_OFFSET}`);
}

function istNextDayStart(day: string): Date {
  const start = istDayStart(day);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function scopeFor(actor: Actor): Prisma.AuditLogWhereInput {
  return actor.orgType === "PLATFORM" ? {} : { actorOrgId: actor.orgId };
}

export function auditWhere(actor: Actor, filters: AuditFilters): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [scopeFor(actor)];
  if (filters.from) and.push({ createdAt: { gte: istDayStart(filters.from) } });
  if (filters.to) and.push({ createdAt: { lt: istNextDayStart(filters.to) } });
  if (filters.actor) and.push({ actorUserId: filters.actor });
  if (filters.org) and.push({ actorOrgId: filters.org });
  if (filters.action) and.push({ action: filters.action });
  if (filters.entity) and.push({ entityType: filters.entity });
  if (filters.entityId) and.push({ entityId: filters.entityId });
  if (filters.q) {
    and.push({
      OR: [
        { summary: { contains: filters.q, mode: "insensitive" } },
        { actorName: { contains: filters.q, mode: "insensitive" } },
        { action: { contains: filters.q, mode: "insensitive" } },
        { entityId: { equals: filters.q } },
      ],
    });
  }
  return { AND: and };
}

/* ----------------------------------------------------------------------------------------------
 * Keyset cursor. It embeds a fingerprint of the filters it was issued for, so a cursor carried over
 * after the filters change is ignored instead of skipping rows of the new result set.
 * -------------------------------------------------------------------------------------------- */

interface CursorPayload {
  t: string;
  id: string;
  f: string;
}

function fingerprint(filters: AuditFilters): string {
  const canonical = FILTER_KEYS.map((key) => `${key}=${filters[key] ?? ""}`).join("&");
  return createHash("sha256").update(canonical).digest("base64url").slice(0, 12);
}

export function encodeAuditCursor(row: Pick<AuditLog, "createdAt" | "id">, filters: AuditFilters): string {
  const payload: CursorPayload = { t: row.createdAt.toISOString(), id: row.id, f: fingerprint(filters) };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeAuditCursor(cursor: string | undefined, filters: AuditFilters): { createdAt: Date; id: string } | null {
  if (!cursor || cursor.length > 512) return null;
  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorPayload>;
    if (typeof payload.t !== "string" || typeof payload.id !== "string" || payload.f !== fingerprint(filters)) return null;
    const createdAt = new Date(payload.t);
    return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id: payload.id };
  } catch {
    return null;
  }
}

function after(position: { createdAt: Date; id: string } | null): Prisma.AuditLogWhereInput {
  if (!position) return {};
  return { OR: [{ createdAt: { lt: position.createdAt } }, { createdAt: position.createdAt, id: { lt: position.id } }] };
}

const NEWEST_FIRST: Prisma.AuditLogOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];

export interface AuditPage {
  entries: AuditLog[];
  nextCursor: string | null;
  /** True when the requested cursor was applied (false on the first page or for a stale cursor). */
  paged: boolean;
}

/** One page of matching entries, newest first, with an opaque cursor for the next (older) page. */
export async function searchAuditLogs(actor: Actor, filters: AuditFilters, options: { cursor?: string; limit?: number } = {}): Promise<AuditPage> {
  const limit = Math.min(Math.max(options.limit ?? AUDIT_PAGE_SIZE, 1), 200);
  const position = decodeAuditCursor(options.cursor, filters);
  const rows = await db.auditLog.findMany({
    where: { AND: [auditWhere(actor, filters), after(position)] },
    orderBy: NEWEST_FIRST,
    take: limit + 1,
  });
  const entries = rows.slice(0, limit);
  const last = entries.at(-1);
  return { entries, nextCursor: rows.length > limit && last ? encodeAuditCursor(last, filters) : null, paged: position !== null };
}

export async function countAuditLogs(actor: Actor, filters: AuditFilters): Promise<number> {
  return db.auditLog.count({ where: auditWhere(actor, filters) });
}

/** Streams every matching entry in pages (newest first) for exports. */
export async function* iterateAuditLogs(actor: Actor, filters: AuditFilters, batchSize = 500): AsyncGenerator<AuditLog[]> {
  let position: { createdAt: Date; id: string } | null = null;
  for (;;) {
    const rows: AuditLog[] = await db.auditLog.findMany({ where: { AND: [auditWhere(actor, filters), after(position)] }, orderBy: NEWEST_FIRST, take: batchSize });
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < batchSize) return;
    const last = rows[rows.length - 1]!;
    position = { createdAt: last.createdAt, id: last.id };
  }
}

export interface AuditFilterOptions {
  actions: string[];
  entityTypes: string[];
  actors: { id: string; name: string }[];
}

/** Values that actually occur in the log, for the filter menus. Platform administrators only. */
export async function getAuditFilterOptions(actor: Actor): Promise<AuditFilterOptions> {
  if (actor.orgType !== "PLATFORM") throw forbidden();
  const [actions, entityTypes, actors] = await Promise.all([
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    db.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
    db.auditLog.findMany({ where: { actorUserId: { not: null } }, distinct: ["actorUserId"], select: { actorUserId: true, actorName: true }, orderBy: { actorUserId: "asc" } }),
  ]);
  return {
    actions: actions.map((r) => r.action),
    entityTypes: entityTypes.map((r) => r.entityType),
    actors: actors
      .filter((r): r is { actorUserId: string; actorName: string } => r.actorUserId !== null)
      .map((r) => ({ id: r.actorUserId, name: r.actorName }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
