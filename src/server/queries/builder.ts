import "server-only";
import type { FinancingStatus, InvoiceStatus, SettlementStatus } from "@/generated/prisma/client";
import { assertOrgType, type Actor } from "../auth/session";
import { db } from "../db";
import { effectiveSettlementStatus } from "../services/financing";

/**
 * Aggregate read models for the builder workspace. Every query asserts a BUILDER actor and is
 * scoped to `actor.orgId`; draft invoices are never visible to the builder.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Financing requests the financier has approved, whose amount the builder will owe Veefin. */
const SETTLEMENT_BEARING: FinancingStatus[] = ["APPROVED", "DISBURSEMENT_INITIATED", "DISBURSED"];
const AWAITING_DECISION: InvoiceStatus[] = ["SUBMITTED", "UNDER_REVIEW"];
const OPEN_STATUSES: InvoiceStatus[] = ["SUBMITTED", "UNDER_REVIEW", "CLARIFICATION_REQUESTED"];

function builderId(actor: Actor): string {
  assertOrgType(actor, "BUILDER");
  return actor.orgId;
}

function visibleInvoices(actor: Actor) {
  return { builderId: builderId(actor), status: { not: "DRAFT" as const } };
}

/**
 * Amount still owed to Veefin for one request: the open settlement amount, or the approved amount when the
 * request is approved but the simulated disbursement has not completed yet. Zero once settled or not approved.
 */
function pendingSettlementAmount(request: {
  status: FinancingStatus;
  approvedAmountPaise: bigint;
  settlement: { status: SettlementStatus; dueDate: Date; amountPaise: bigint } | null;
}): bigint {
  if (request.settlement) return effectiveSettlementStatus(request.settlement) === "SETTLED" ? 0n : request.settlement.amountPaise;
  return SETTLEMENT_BEARING.includes(request.status) ? request.approvedAmountPaise : 0n;
}

export async function getBuilderOverview(actor: Actor) {
  const scope = visibleInvoices(actor);
  const [invoices, requests, inbox, events] = await Promise.all([
    db.invoice.findMany({
      where: scope,
      select: { status: true, amountPaise: true, approvedAmountPaise: true, project: { select: { id: true, name: true, code: true } } },
    }),
    db.financingRequest.findMany({
      where: { builderId: scope.builderId },
      select: { status: true, approvedAmountPaise: true, settlement: { select: { status: true, dueDate: true, amountPaise: true } } },
    }),
    db.invoice.findMany({
      where: { builderId: scope.builderId, status: { in: AWAITING_DECISION } },
      orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
      take: 5,
      select: {
        id: true,
        invoiceNumber: true,
        amountPaise: true,
        status: true,
        submittedAt: true,
        cp: { select: { name: true } },
        project: { select: { name: true } },
      },
    }),
    db.financingEvent.findMany({
      where: { request: { builderId: scope.builderId } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        toStatus: true,
        note: true,
        actorName: true,
        createdAt: true,
        request: {
          select: {
            reference: true,
            approvedAmountPaise: true,
            invoice: { select: { id: true, invoiceNumber: true } },
            cp: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  let pendingCount = 0;
  let pendingValue = 0n;
  let approvedCount = 0;
  let approvedValue = 0n;
  const byProject = new Map<string, { id: string; name: string; code: string; approved: bigint; awaiting: bigint }>();
  for (const invoice of invoices) {
    const project = byProject.get(invoice.project.id) ?? { id: invoice.project.id, name: invoice.project.name, code: invoice.project.code, approved: 0n, awaiting: 0n };
    if (AWAITING_DECISION.includes(invoice.status)) {
      pendingCount += 1;
      pendingValue += invoice.amountPaise;
    }
    if (OPEN_STATUSES.includes(invoice.status)) project.awaiting += invoice.amountPaise;
    if (invoice.status === "ACCEPTED") {
      approvedCount += 1;
      approvedValue += invoice.approvedAmountPaise ?? 0n;
      project.approved += invoice.approvedAmountPaise ?? 0n;
    }
    byProject.set(invoice.project.id, project);
  }

  let financedCount = 0;
  let financedValue = 0n;
  let pendingSettlementValue = 0n;
  let pendingSettlementCount = 0;
  let nextSettlement: { dueDate: Date; amountPaise: bigint } | null = null;
  for (const request of requests) {
    if (request.status !== "REJECTED") {
      financedCount += 1;
      financedValue += request.approvedAmountPaise;
    }
    const owed = pendingSettlementAmount(request);
    if (owed > 0n) {
      pendingSettlementCount += 1;
      pendingSettlementValue += owed;
    }
    const s = request.settlement;
    if (s && effectiveSettlementStatus(s) !== "SETTLED" && (!nextSettlement || s.dueDate < nextSettlement.dueDate)) {
      nextSettlement = { dueDate: s.dueDate, amountPaise: s.amountPaise };
    }
  }

  return {
    totals: {
      invoiceCount: invoices.length,
      invoiceValue: invoices.reduce((sum, i) => sum + i.amountPaise, 0n),
      pendingCount,
      pendingValue,
      approvedCount,
      approvedValue,
      financedCount,
      financedValue,
      pendingSettlementCount,
      pendingSettlementValue,
    },
    nextSettlement,
    inbox,
    events,
    byProject: [...byProject.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function listBuilderProjectOptions(actor: Actor) {
  return db.project.findMany({
    where: { builderId: builderId(actor) },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
}

interface Totals {
  invoiceCount: number;
  invoiceValue: bigint;
  approvedValue: bigint;
  financedValue: bigint;
  openCount: number;
}

const emptyTotals = (): Totals => ({ invoiceCount: 0, invoiceValue: 0n, approvedValue: 0n, financedValue: 0n, openCount: 0 });

async function invoiceTotalsBy(actor: Actor, key: "cpId" | "projectId") {
  const scope = visibleInvoices(actor);
  const [invoices, requests] = await Promise.all([
    db.invoice.findMany({ where: scope, select: { cpId: true, projectId: true, status: true, amountPaise: true, approvedAmountPaise: true } }),
    db.financingRequest.findMany({
      where: { builderId: scope.builderId, status: { not: "REJECTED" } },
      select: { cpId: true, approvedAmountPaise: true, invoice: { select: { projectId: true } } },
    }),
  ]);
  const totals = new Map<string, Totals>();
  const entry = (id: string) => {
    const existing = totals.get(id);
    if (existing) return existing;
    const created = emptyTotals();
    totals.set(id, created);
    return created;
  };
  for (const invoice of invoices) {
    const t = entry(invoice[key]);
    t.invoiceCount += 1;
    t.invoiceValue += invoice.amountPaise;
    if (invoice.status === "ACCEPTED") t.approvedValue += invoice.approvedAmountPaise ?? 0n;
    if (OPEN_STATUSES.includes(invoice.status)) t.openCount += 1;
  }
  for (const request of requests) {
    entry(key === "cpId" ? request.cpId : request.invoice.projectId).financedValue += request.approvedAmountPaise;
  }
  return totals;
}

export async function listBuilderPartners(actor: Actor) {
  const [relationships, totals] = await Promise.all([
    db.cpBuilderRelationship.findMany({
      where: { builderId: builderId(actor) },
      include: {
        cp: { select: { id: true, name: true, legalName: true, gstin: true, city: true, state: true, contactName: true, contactEmail: true, status: true } },
      },
      orderBy: { cp: { name: "asc" } },
    }),
    invoiceTotalsBy(actor, "cpId"),
  ]);
  return relationships.map((r) => ({ ...r, totals: totals.get(r.cpId) ?? emptyTotals() }));
}

export type BuilderPartner = Awaited<ReturnType<typeof listBuilderPartners>>[number];

export async function listBuilderProjects(actor: Actor) {
  const [projects, totals] = await Promise.all([
    db.project.findMany({ where: { builderId: builderId(actor) }, orderBy: { name: "asc" } }),
    invoiceTotalsBy(actor, "projectId"),
  ]);
  return projects.map((p) => ({ ...p, totals: totals.get(p.id) ?? emptyTotals() }));
}

export type BuilderProject = Awaited<ReturnType<typeof listBuilderProjects>>[number];

/** Empanelment terms between the builder and one of its channel partners. */
export async function getBuilderEmpanelment(actor: Actor, cpId: string) {
  return db.cpBuilderRelationship.findUnique({
    where: { cpId_builderId: { cpId, builderId: builderId(actor) } },
    select: { empanelmentCode: true, creditPeriodDays: true, status: true, empanelledAt: true },
  });
}

export async function listBuilderSettlements(actor: Actor) {
  const id = builderId(actor);
  const [settlements, awaiting] = await Promise.all([
    db.settlement.findMany({
      where: { builderId: id, request: { builderId: id } },
      include: {
        request: {
          select: {
            id: true,
            reference: true,
            approvedAmountPaise: true,
            invoice: { select: { id: true, invoiceNumber: true, reference: true, project: { select: { name: true } } } },
            cp: { select: { name: true } },
            financier: { select: { name: true } },
          },
        },
      },
      orderBy: { dueDate: "asc" },
    }),
    db.financingRequest.findMany({
      where: { builderId: id, status: { in: ["APPROVED", "DISBURSEMENT_INITIATED"] }, settlement: null },
      select: { approvedAmountPaise: true },
    }),
  ]);
  return {
    settlements: settlements.map((s) => ({ ...s, effectiveStatus: effectiveSettlementStatus(s) })),
    awaitingDisbursement: { count: awaiting.length, value: awaiting.reduce((sum, r) => sum + r.approvedAmountPaise, 0n) },
  };
}

export type BuilderSettlement = Awaited<ReturnType<typeof listBuilderSettlements>>["settlements"][number];

const MONTH_NAME = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "Asia/Kolkata" });
const monthLabel = (date: Date, key: string) => `${MONTH_NAME.format(date)} ’${key.slice(2, 4)}`;
const MONTH_KEY = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Kolkata" });

export const TURNAROUND_BUCKETS = [
  { label: "Same day", max: 1 },
  { label: "1–3 days", max: 3 },
  { label: "3–7 days", max: 7 },
  { label: "7–14 days", max: 14 },
  { label: "Over 14 days", max: Number.POSITIVE_INFINITY },
] as const;

/** Data for the reports page: monthly volume, approval turnaround, financing take-up by project and settlement profile. */
export async function getBuilderReport(actor: Actor, now: Date = new Date(), months = 6) {
  const scope = visibleInvoices(actor);
  const [invoices, settlementData] = await Promise.all([
    db.invoice.findMany({
      where: scope,
      select: {
        status: true,
        amountPaise: true,
        approvedAmountPaise: true,
        submittedAt: true,
        createdAt: true,
        decidedAt: true,
        project: { select: { id: true, name: true } },
        financingRequest: { select: { status: true } },
      },
    }),
    listBuilderSettlements(actor),
  ]);

  const monthly: { key: string; label: string; count: number; value: bigint; approvedValue: bigint }[] = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 15));
    monthly.push({ key: MONTH_KEY.format(anchor), label: monthLabel(anchor, MONTH_KEY.format(anchor)), count: 0, value: 0n, approvedValue: 0n });
  }
  const monthIndex = new Map(monthly.map((m, i) => [m.key, i]));

  const turnaroundDays: number[] = [];
  const projects = new Map<string, { name: string; financed: bigint; notFinanced: bigint; financedCount: number; notFinancedCount: number }>();

  for (const invoice of invoices) {
    const submitted = invoice.submittedAt ?? invoice.createdAt;
    const bucket = monthIndex.get(MONTH_KEY.format(submitted));
    if (bucket !== undefined) {
      monthly[bucket]!.count += 1;
      monthly[bucket]!.value += invoice.amountPaise;
      if (invoice.status === "ACCEPTED") monthly[bucket]!.approvedValue += invoice.approvedAmountPaise ?? 0n;
    }
    if ((invoice.status === "ACCEPTED" || invoice.status === "REJECTED") && invoice.decidedAt && invoice.submittedAt) {
      turnaroundDays.push(Math.max(0, (invoice.decidedAt.getTime() - invoice.submittedAt.getTime()) / DAY_MS));
    }
    if (invoice.status === "ACCEPTED") {
      const project = projects.get(invoice.project.id) ?? { name: invoice.project.name, financed: 0n, notFinanced: 0n, financedCount: 0, notFinancedCount: 0 };
      const approved = invoice.approvedAmountPaise ?? 0n;
      if (invoice.financingRequest && invoice.financingRequest.status !== "REJECTED") {
        project.financed += approved;
        project.financedCount += 1;
      } else {
        project.notFinanced += approved;
        project.notFinancedCount += 1;
      }
      projects.set(invoice.project.id, project);
    }
  }

  const sorted = [...turnaroundDays].sort((a, b) => a - b);
  const median = sorted.length === 0 ? null : sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  const average = sorted.length === 0 ? null : sorted.reduce((s, d) => s + d, 0) / sorted.length;
  const distribution = TURNAROUND_BUCKETS.map((b, i) => ({
    label: b.label,
    count: sorted.filter((d) => d < b.max && (i === 0 || d >= TURNAROUND_BUCKETS[i - 1]!.max)).length,
  }));

  const settlementProfile: Record<SettlementStatus, { count: number; value: bigint }> = {
    NOT_DUE: { count: 0, value: 0n },
    DUE: { count: 0, value: 0n },
    OVERDUE: { count: 0, value: 0n },
    SETTLED: { count: 0, value: 0n },
  };
  for (const s of settlementData.settlements) {
    settlementProfile[s.effectiveStatus].count += 1;
    settlementProfile[s.effectiveStatus].value += s.amountPaise;
  }

  return {
    invoiceCount: invoices.length,
    monthly,
    turnaround: { decidedCount: sorted.length, averageDays: average, medianDays: median, distribution },
    financingByProject: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)),
    settlementProfile,
    awaitingDisbursement: settlementData.awaitingDisbursement,
  };
}
