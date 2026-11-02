import "server-only";
import type { FinancingStatus, Prisma, ProgrammeStatus, SettlementStatus } from "@/generated/prisma/client";
import { sumPaise } from "@/lib/money";
import { assertOrgType, type Actor } from "../auth/session";
import { db } from "../db";
import { notFound } from "../errors";
import { getOrganisation } from "../services/admin";
import {
  effectiveSettlementStatus,
  listFinancingRequests,
  refreshSettlementStatuses,
  type FinancingRequestDetail,
  type FinancingRequestListItem,
} from "../services/financing";

/** Requests that represent a committed (approved or paid out) financing exposure. */
export const FINANCED_STATUSES: FinancingStatus[] = ["APPROVED", "DISBURSEMENT_INITIATED", "DISBURSED"];

/** Financing statuses a financier can see on its requests, in workflow order. */
export const FINANCIER_REQUEST_STATUSES = ["PENDING_APPROVAL", "APPROVED", "DISBURSEMENT_INITIATED", "DISBURSED", "REJECTED"] as const;
export type FinancierRequestStatus = (typeof FINANCIER_REQUEST_STATUSES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

function assertFinancier(actor: Actor) {
  assertOrgType(actor, "FINANCIER");
}

async function financierBuilderIds(actor: Actor): Promise<string[]> {
  const programmes = await db.financingProgramme.findMany({ where: { financierId: actor.orgId }, select: { builderId: true } });
  return [...new Set(programmes.map((p) => p.builderId))];
}

/** "XXXX9005": only the last four digits of a bank account ever leave the server (matches the disbursement record format). */
export function maskAccountNumber(account: string | null | undefined): string {
  if (!account) return "—";
  const digits = account.replace(/\s+/g, "");
  return `XXXX${digits.slice(-4)}`;
}

const istMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" });
const monthLabel = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "short", year: "2-digit" });

function monthKey(date: Date): string {
  return istMonth.format(date).slice(0, 7);
}

/** The last `count` calendar months (IST), oldest first, as `{ key: "2026-11", label: "Nov 26" }`. */
function recentMonths(count: number, now: Date) {
  const [year, month] = monthKey(now).split("-").map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - (count - 1 - i), 1));
    return { key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, label: monthLabel.format(d) };
  });
}

export interface MonthlyPoint {
  key: string;
  label: string;
  paise: string;
  count: number;
}

function monthlyDisbursed(requests: FinancingRequestListItem[], months: number, now: Date): MonthlyPoint[] {
  const buckets = new Map(recentMonths(months, now).map((m) => [m.key, { ...m, total: 0n, count: 0 }]));
  for (const request of requests) {
    const completedAt = request.disbursement?.completedAt;
    if (request.status !== "DISBURSED" || !completedAt) continue;
    const bucket = buckets.get(monthKey(completedAt));
    if (!bucket) continue;
    bucket.total += request.disbursement!.amountPaise;
    bucket.count += 1;
  }
  return [...buckets.values()].map((b) => ({ key: b.key, label: b.label, paise: b.total.toString(), count: b.count }));
}

function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / DAY_MS);
}

/* ----------------------------------------------------------------------------------------------
 * Overview
 * -------------------------------------------------------------------------------------------- */

export interface WatchlistItem {
  request: FinancingRequestListItem;
  status: SettlementStatus;
  dueDate: Date;
  amountPaise: bigint;
  /** Positive: days until due; negative: days overdue. */
  daysToDue: number;
}

function openSettlements(requests: FinancingRequestListItem[], now: Date): WatchlistItem[] {
  return requests
    .filter((r) => r.settlement && effectiveSettlementStatus(r.settlement, now) !== "SETTLED")
    .map((r) => ({
      request: r,
      status: effectiveSettlementStatus(r.settlement!, now),
      dueDate: r.settlement!.dueDate,
      amountPaise: r.settlement!.amountPaise,
      daysToDue: daysBetween(now, r.settlement!.dueDate),
    }))
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

export async function getFinanceOverview(actor: Actor, now: Date = new Date()) {
  assertFinancier(actor);
  await refreshSettlementStatuses(now);
  const builderIds = await financierBuilderIds(actor);
  const [relationships, approvedInvoices, requests] = await Promise.all([
    db.cpBuilderRelationship.findMany({ where: { builderId: { in: builderIds }, status: "ACTIVE" }, select: { cpId: true } }),
    db.invoice.findMany({ where: { builderId: { in: builderIds }, status: "ACCEPTED" }, select: { approvedAmountPaise: true } }),
    listFinancingRequests(actor),
  ]);

  const financed = requests.filter((r) => FINANCED_STATUSES.includes(r.status));
  const disbursed = requests.filter((r) => r.status === "DISBURSED");
  const pending = requests.filter((r) => r.status === "PENDING_APPROVAL");
  const approved = requests.filter((r) => r.status === "APPROVED");
  const inProgress = requests.filter((r) => r.status === "DISBURSEMENT_INITIATED");
  const watchlist = openSettlements(requests, now);

  return {
    builderCount: builderIds.length,
    cpCount: new Set(relationships.map((r) => r.cpId)).size,
    approvedInvoiceCount: approvedInvoices.length,
    approvedInvoiceValue: sumPaise(approvedInvoices.map((i) => i.approvedAmountPaise)),
    requestCount: requests.length,
    financedCount: financed.length,
    financedValue: sumPaise(financed.map((r) => r.approvedAmountPaise)),
    disbursedCount: disbursed.length,
    disbursedValue: sumPaise(disbursed.map((r) => r.disbursement?.amountPaise ?? r.netPayablePaise)),
    pendingCount: pending.length,
    pendingValue: sumPaise(pending.map((r) => r.approvedAmountPaise)),
    pendingNetValue: sumPaise(pending.map((r) => r.netPayablePaise)),
    outstandingValue: sumPaise(watchlist.map((w) => w.amountPaise)),
    outstandingCount: watchlist.length,
    overdueCount: watchlist.filter((w) => w.status === "OVERDUE").length,
    queue: { pending, approved, inProgress },
    watchlist,
    monthly: monthlyDisbursed(requests, 6, now),
  };
}

/* ----------------------------------------------------------------------------------------------
 * Builders
 * -------------------------------------------------------------------------------------------- */

type ProgrammeSummary = { id: string; code: string; name: string; discountRateBps: number; status: ProgrammeStatus };

function primaryProgramme<T extends ProgrammeSummary & { effectiveFrom: Date }>(programmes: T[]): T {
  const active = programmes.find((p) => p.status === "ACTIVE");
  return active ?? [...programmes].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0]!;
}

interface BuilderMetrics {
  approvedInvoiceCount: number;
  approvedInvoiceValue: bigint;
  financedCount: number;
  financedValue: bigint;
  outstandingValue: bigint;
  overdueCount: number;
  overdueValue: bigint;
  requestCount: number;
}

function builderMetrics(
  builderId: string,
  invoices: { builderId: string; approvedAmountPaise: bigint | null }[],
  requests: FinancingRequestListItem[],
  now: Date,
): BuilderMetrics {
  const own = requests.filter((r) => r.builderId === builderId);
  const invoicesForBuilder = invoices.filter((i) => i.builderId === builderId);
  const financed = own.filter((r) => FINANCED_STATUSES.includes(r.status));
  const open = openSettlements(own, now);
  const overdue = open.filter((o) => o.status === "OVERDUE");
  return {
    approvedInvoiceCount: invoicesForBuilder.length,
    approvedInvoiceValue: sumPaise(invoicesForBuilder.map((i) => i.approvedAmountPaise)),
    financedCount: financed.length,
    financedValue: sumPaise(financed.map((r) => r.approvedAmountPaise)),
    outstandingValue: sumPaise(open.map((o) => o.amountPaise)),
    overdueCount: overdue.length,
    overdueValue: sumPaise(overdue.map((o) => o.amountPaise)),
    requestCount: own.length,
  };
}

export async function listFinanceBuilders(actor: Actor, now: Date = new Date()) {
  assertFinancier(actor);
  await refreshSettlementStatuses(now);
  const programmes = await db.financingProgramme.findMany({
    where: { financierId: actor.orgId },
    include: { builder: { include: { _count: { select: { projects: true, builderRelationships: true } } } } },
    orderBy: { effectiveFrom: "desc" },
  });
  const builderIds = [...new Set(programmes.map((p) => p.builderId))];
  const [invoices, requests] = await Promise.all([
    db.invoice.findMany({ where: { builderId: { in: builderIds }, status: "ACCEPTED" }, select: { builderId: true, approvedAmountPaise: true } }),
    listFinancingRequests(actor),
  ]);

  return builderIds
    .map((builderId) => {
      const own = programmes.filter((p) => p.builderId === builderId);
      const builder = own[0]!.builder;
      return {
        id: builder.id,
        name: builder.name,
        legalName: builder.legalName,
        city: builder.city,
        state: builder.state,
        status: builder.status,
        projectCount: builder._count.projects,
        cpCount: builder._count.builderRelationships,
        programme: primaryProgramme(own),
        programmeCount: own.length,
        ...builderMetrics(builderId, invoices, requests, now),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type FinanceBuilderRow = Awaited<ReturnType<typeof listFinanceBuilders>>[number];

export async function getFinanceBuilderDetail(actor: Actor, builderId: string, now: Date = new Date()) {
  assertFinancier(actor);
  const programmes = await db.financingProgramme.findMany({
    where: { financierId: actor.orgId, builderId },
    include: { _count: { select: { requests: true, offers: true } } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (programmes.length === 0) throw notFound("Builder not found.");
  await refreshSettlementStatuses(now);
  const [organisation, requests, invoices] = await Promise.all([
    getOrganisation(actor, builderId),
    listFinancingRequests(actor, { builderId }),
    db.invoice.findMany({ where: { builderId, status: "ACCEPTED" }, select: { builderId: true, approvedAmountPaise: true } }),
  ]);
  if (organisation.type !== "BUILDER") throw notFound("Builder not found.");
  return {
    organisation,
    programmes,
    programme: primaryProgramme(programmes),
    requests,
    watchlist: openSettlements(requests, now),
    metrics: builderMetrics(builderId, invoices, requests, now),
  };
}

/* ----------------------------------------------------------------------------------------------
 * Channel partners
 * -------------------------------------------------------------------------------------------- */

function partnerScope(actor: Actor, builderIds: string[]): Prisma.OrganisationWhereInput {
  return {
    type: "CHANNEL_PARTNER",
    OR: [{ cpRequests: { some: { financierId: actor.orgId } } }, { cpRelationships: { some: { builderId: { in: builderIds } } } }],
  };
}

function partnerMetrics(cpId: string, requests: FinancingRequestListItem[]) {
  const own = requests.filter((r) => r.cpId === cpId);
  const disbursed = own.filter((r) => r.status === "DISBURSED");
  return {
    requestCount: own.length,
    pendingCount: own.filter((r) => r.status === "PENDING_APPROVAL").length,
    disbursedCount: disbursed.length,
    disbursedValue: sumPaise(disbursed.map((r) => r.disbursement?.amountPaise ?? r.netPayablePaise)),
    discountValue: sumPaise(disbursed.map((r) => r.discountAmountPaise)),
  };
}

export async function listFinancePartners(actor: Actor) {
  assertFinancier(actor);
  const builderIds = await financierBuilderIds(actor);
  const [partners, requests] = await Promise.all([
    db.organisation.findMany({
      where: partnerScope(actor, builderIds),
      include: {
        cpRelationships: {
          where: { builderId: { in: builderIds } },
          include: { builder: { select: { id: true, name: true } } },
          orderBy: { builder: { name: "asc" } },
        },
      },
      orderBy: { name: "asc" },
    }),
    listFinancingRequests(actor),
  ]);
  return partners.map((cp) => ({
    id: cp.id,
    name: cp.name,
    legalName: cp.legalName,
    gstin: cp.gstin,
    city: cp.city,
    status: cp.status,
    builders: cp.cpRelationships.map((r) => ({ id: r.builder.id, name: r.builder.name, code: r.empanelmentCode, status: r.status })),
    ...partnerMetrics(cp.id, requests),
  }));
}

export type FinancePartnerRow = Awaited<ReturnType<typeof listFinancePartners>>[number];

export async function getFinancePartnerDetail(actor: Actor, cpId: string) {
  assertFinancier(actor);
  const builderIds = await financierBuilderIds(actor);
  const inScope = await db.organisation.findFirst({ where: { AND: [{ id: cpId }, partnerScope(actor, builderIds)] }, select: { id: true } });
  if (!inScope) throw notFound("Channel partner not found.");
  const [organisation, requests] = await Promise.all([getOrganisation(actor, cpId), listFinancingRequests(actor, { cpId })]);
  const { bankAccountNumber, ...profile } = organisation;
  return {
    profile: { ...profile, bankAccountMasked: maskAccountNumber(bankAccountNumber) },
    relationships: organisation.cpRelationships.filter((r) => builderIds.includes(r.builderId)),
    requests,
    metrics: partnerMetrics(cpId, requests),
  };
}

/* ----------------------------------------------------------------------------------------------
 * Request review
 * -------------------------------------------------------------------------------------------- */

/** Resolves the display names of the users referenced on a financing request (consent, decision, payout, settlement). */
export async function getRequestParticipants(actor: Actor, request: FinancingRequestDetail): Promise<Map<string, string>> {
  assertFinancier(actor);
  const ids = [
    request.acceptedById,
    request.decidedById,
    request.offer.generatedById,
    request.offer.acceptedById,
    request.disbursement?.initiatedById,
    request.disbursement?.completedById,
    request.settlement?.settledById,
  ].filter((id): id is string => Boolean(id));
  if (ids.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** Builder empanelment details for the CP on a request (credit period drives the fallback settlement date). */
export async function getRequestEmpanelment(actor: Actor, cpId: string, builderId: string) {
  assertFinancier(actor);
  return db.cpBuilderRelationship.findUnique({ where: { cpId_builderId: { cpId, builderId } } });
}

/* ----------------------------------------------------------------------------------------------
 * Ledger (transactions page + CSV export)
 * -------------------------------------------------------------------------------------------- */

export interface LedgerFilters {
  search?: string;
  status?: FinancierRequestStatus;
  builderId?: string;
  settlement?: SettlementStatus | "NONE";
}

const SETTLEMENT_FILTERS = ["NOT_DUE", "DUE", "OVERDUE", "SETTLED", "NONE"] as const;

export function parseLedgerFilters(params: Record<string, string | string[] | undefined> | URLSearchParams): LedgerFilters {
  const get = (key: string) => {
    const value = params instanceof URLSearchParams ? params.get(key) : params[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const status = get("status");
  const settlement = get("settlement");
  return {
    search: get("q"),
    builderId: get("builder"),
    status: FINANCIER_REQUEST_STATUSES.find((s) => s === status),
    settlement: SETTLEMENT_FILTERS.find((s) => s === settlement),
  };
}

export async function listFinanceLedger(actor: Actor, filters: LedgerFilters = {}, now: Date = new Date()) {
  assertFinancier(actor);
  await refreshSettlementStatuses(now);
  const requests = await listFinancingRequests(actor, { search: filters.search, builderId: filters.builderId, status: filters.status });
  const rows = requests.map((request) => ({
    request,
    settlementStatus: request.settlement ? effectiveSettlementStatus(request.settlement, now) : null,
  }));
  if (!filters.settlement) return rows;
  return rows.filter((row) => (filters.settlement === "NONE" ? row.settlementStatus === null : row.settlementStatus === filters.settlement));
}

export type LedgerRow = Awaited<ReturnType<typeof listFinanceLedger>>[number];

/** Builders on this financier's programmes, for filter controls. */
export async function listFinancierBuilderOptions(actor: Actor) {
  assertFinancier(actor);
  const programmes = await db.financingProgramme.findMany({
    where: { financierId: actor.orgId },
    select: { builder: { select: { id: true, name: true } } },
  });
  const unique = new Map(programmes.map((p) => [p.builder.id, p.builder.name]));
  return [...unique].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/* ----------------------------------------------------------------------------------------------
 * Reports
 * -------------------------------------------------------------------------------------------- */

export const AGEING_BUCKETS = [
  { key: "not-due-30", label: "Due in 30+ days", short: "Due 30d+" },
  { key: "not-due", label: "Due in 0–30 days", short: "Due 0–30d" },
  { key: "overdue-30", label: "Overdue 1–30 days", short: "Late 1–30d" },
  { key: "overdue-60", label: "Overdue 31–60 days", short: "Late 31–60d" },
  { key: "overdue-60+", label: "Overdue 60+ days", short: "Late 60d+" },
] as const;

function ageingBucket(daysToDue: number): (typeof AGEING_BUCKETS)[number]["key"] {
  if (daysToDue > 30) return "not-due-30";
  if (daysToDue >= 0) return "not-due";
  if (daysToDue >= -30) return "overdue-30";
  if (daysToDue >= -60) return "overdue-60";
  return "overdue-60+";
}

export async function getFinanceReports(actor: Actor, now: Date = new Date()) {
  assertFinancier(actor);
  await refreshSettlementStatuses(now);
  const requests = await listFinancingRequests(actor);
  const disbursed = requests.filter((r) => r.status === "DISBURSED");
  const open = openSettlements(requests, now);
  const settled = requests.filter((r) => r.settlement?.status === "SETTLED");

  const builders = new Map<string, { name: string; outstanding: bigint; committed: bigint; discount: bigint; disbursed: bigint; count: number }>();
  const builderRow = (r: FinancingRequestListItem) => {
    let row = builders.get(r.builderId);
    if (!row) {
      row = { name: r.builder.name, outstanding: 0n, committed: 0n, discount: 0n, disbursed: 0n, count: 0 };
      builders.set(r.builderId, row);
    }
    return row;
  };
  for (const r of requests) {
    const row = builderRow(r);
    row.count += 1;
    if (r.status === "APPROVED" || r.status === "DISBURSEMENT_INITIATED") row.committed += r.approvedAmountPaise;
    if (r.status === "DISBURSED") {
      row.discount += r.discountAmountPaise;
      row.disbursed += r.disbursement?.amountPaise ?? r.netPayablePaise;
    }
  }
  for (const item of open) builderRow(item.request).outstanding += item.amountPaise;

  const ageing = AGEING_BUCKETS.map((b) => ({ ...b, total: 0n, count: 0 }));
  for (const item of open) {
    const bucket = ageing.find((b) => b.key === ageingBucket(item.daysToDue))!;
    bucket.total += item.amountPaise;
    bucket.count += 1;
  }

  const disbursedApproved = sumPaise(disbursed.map((r) => r.approvedAmountPaise));
  const discountEarned = sumPaise(disbursed.map((r) => r.discountAmountPaise));
  const builderList = [...builders.entries()].map(([id, b]) => ({ id, ...b })).sort((a, b) => a.name.localeCompare(b.name));

  return {
    disbursedValue: sumPaise(disbursed.map((r) => r.disbursement?.amountPaise ?? r.netPayablePaise)),
    disbursedCount: disbursed.length,
    discountEarned,
    weightedRateBps: disbursedApproved > 0n ? Number((discountEarned * 10_000n + disbursedApproved / 2n) / disbursedApproved) : null,
    outstandingValue: sumPaise(open.map((o) => o.amountPaise)),
    outstandingCount: open.length,
    settledValue: sumPaise(settled.map((r) => r.settlement!.amountPaise)),
    settledCount: settled.length,
    monthly: monthlyDisbursed(requests, 12, now),
    builders: builderList,
    ageing: ageing.map((b) => ({ key: b.key, label: b.label, short: b.short, paise: b.total.toString(), count: b.count })),
  };
}

/* ----------------------------------------------------------------------------------------------
 * Disbursement beneficiaries
 * -------------------------------------------------------------------------------------------- */

export interface Beneficiary {
  name: string;
  bankName: string | null;
  accountMasked: string;
  ifsc: string;
}

/** Payout beneficiary details for channel partners with a request at this financier; account numbers are masked. */
export async function getBeneficiaries(actor: Actor, cpIds: string[]): Promise<Map<string, Beneficiary>> {
  assertFinancier(actor);
  if (cpIds.length === 0) return new Map();
  const partners = await db.organisation.findMany({
    where: { id: { in: [...new Set(cpIds)] }, type: "CHANNEL_PARTNER", cpRequests: { some: { financierId: actor.orgId } } },
    select: { id: true, legalName: true, bankName: true, bankAccountNumber: true, bankIfsc: true },
  });
  return new Map(
    partners.map((p) => [
      p.id,
      { name: p.legalName, bankName: p.bankName, accountMasked: maskAccountNumber(p.bankAccountNumber), ifsc: p.bankIfsc ?? "DEMO0000001" },
    ]),
  );
}
