import "server-only";
import type { FinancingStatus, InvoiceStatus, OrganisationType } from "@/generated/prisma/client";
import packageJson from "../../../package.json";
import type { Actor } from "../auth/session";
import { db } from "../db";
import { forbidden } from "../errors";
import { sortByEnumName } from "../ordering";
import { getOrganisation } from "../services/admin";

/** Request statuses at which Veefin has committed funds (approved, paying out or paid). */
export const FINANCED_STATUSES: FinancingStatus[] = ["APPROVED", "DISBURSEMENT_INITIATED", "DISBURSED"];

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function assertPlatform(actor: Actor) {
  if (actor.orgType !== "PLATFORM") throw forbidden();
}

const weekLabel = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });

export interface WeeklyVolumePoint {
  label: string;
  invoicedPaise: string;
  financedPaise: string;
}

/* ----------------------------------------------------------------------------------------------
 * Dashboard
 * -------------------------------------------------------------------------------------------- */

export async function getAdminDashboard(actor: Actor, weeks = 12) {
  assertPlatform(actor);
  const now = new Date();
  const since = new Date(now.getTime() - weeks * WEEK_MS);

  const [orgGroups, userGroups, invoiceGroups, requestGroups, disbursed, outstanding, recentInvoices, recentRequests] = await Promise.all([
    db.organisation.groupBy({ by: ["type", "status"], _count: { _all: true } }),
    db.user.groupBy({ by: ["status"], _count: { _all: true } }),
    db.invoice.groupBy({ by: ["status"], _count: { _all: true }, _sum: { amountPaise: true } }),
    db.financingRequest.groupBy({ by: ["status"], _count: { _all: true }, _sum: { approvedAmountPaise: true, netPayablePaise: true } }),
    db.disbursement.aggregate({ where: { status: "SUCCESS" }, _count: { _all: true }, _sum: { amountPaise: true } }),
    db.settlement.aggregate({ where: { status: { not: "SETTLED" } }, _count: { _all: true }, _sum: { amountPaise: true } }),
    db.invoice.findMany({ where: { submittedAt: { gte: since } }, select: { submittedAt: true, amountPaise: true } }),
    db.financingRequest.findMany({ where: { acceptedAt: { gte: since } }, select: { acceptedAt: true, approvedAmountPaise: true } }),
  ]);

  const organisations = { total: 0, active: 0, byType: {} as Record<OrganisationType, number> };
  for (const g of orgGroups) {
    organisations.total += g._count._all;
    if (g.status === "ACTIVE") organisations.active += g._count._all;
    organisations.byType[g.type] = (organisations.byType[g.type] ?? 0) + g._count._all;
  }

  const users = { total: 0, active: 0 };
  for (const g of userGroups) {
    users.total += g._count._all;
    if (g.status === "ACTIVE") users.active += g._count._all;
  }

  const invoices = {
    total: invoiceGroups.reduce((n, g) => n + g._count._all, 0),
    byStatus: invoiceGroups.map((g) => ({ status: g.status as InvoiceStatus, count: g._count._all, amountPaise: g._sum.amountPaise ?? 0n })),
  };

  let financedPaise = 0n;
  let financedCount = 0;
  for (const g of requestGroups) {
    if (FINANCED_STATUSES.includes(g.status)) {
      financedPaise += g._sum.approvedAmountPaise ?? 0n;
      financedCount += g._count._all;
    }
  }
  const requests = {
    total: requestGroups.reduce((n, g) => n + g._count._all, 0),
    byStatus: requestGroups.map((g) => ({ status: g.status as FinancingStatus, count: g._count._all, approvedPaise: g._sum.approvedAmountPaise ?? 0n })),
    financedPaise,
    financedCount,
  };

  const buckets = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(now.getTime() - (weeks - i) * WEEK_MS);
    return { label: weekLabel.format(start), invoiced: 0n, financed: 0n };
  });
  const bucketFor = (date: Date) => weeks - 1 - Math.floor((now.getTime() - date.getTime()) / WEEK_MS);
  for (const inv of recentInvoices) {
    const index = inv.submittedAt ? bucketFor(inv.submittedAt) : -1;
    if (index >= 0 && index < weeks) buckets[index]!.invoiced += inv.amountPaise;
  }
  for (const req of recentRequests) {
    const index = bucketFor(req.acceptedAt);
    if (index >= 0 && index < weeks) buckets[index]!.financed += req.approvedAmountPaise;
  }

  return {
    organisations,
    users,
    invoices,
    requests,
    disbursed: { count: disbursed._count._all, amountPaise: disbursed._sum.amountPaise ?? 0n },
    outstanding: { count: outstanding._count._all, amountPaise: outstanding._sum.amountPaise ?? 0n },
    weekly: buckets.map<WeeklyVolumePoint>((b) => ({ label: b.label, invoicedPaise: b.invoiced.toString(), financedPaise: b.financed.toString() })),
  };
}

/* ----------------------------------------------------------------------------------------------
 * Directory summaries
 * -------------------------------------------------------------------------------------------- */

export async function listBuilderSummaries(actor: Actor, filters: { search?: string } = {}) {
  assertPlatform(actor);
  const q = filters.search?.trim();
  const [builders, invoiceAgg, financedAgg, outstandingAgg] = await Promise.all([
    db.organisation.findMany({
      where: { type: "BUILDER", ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { legalName: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }] } : {}) },
      include: {
        _count: { select: { projects: true, builderRelationships: { where: { status: "ACTIVE" } } } },
        builderProgrammes: {
          where: { status: "ACTIVE" },
          select: { id: true, code: true, name: true, discountRateBps: true, financier: { select: { name: true } } },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.invoice.groupBy({ by: ["builderId"], where: { status: { not: "DRAFT" } }, _count: { _all: true }, _sum: { amountPaise: true } }),
    db.financingRequest.groupBy({ by: ["builderId"], where: { status: { in: FINANCED_STATUSES } }, _count: { _all: true }, _sum: { approvedAmountPaise: true } }),
    db.settlement.groupBy({ by: ["builderId"], where: { status: { not: "SETTLED" } }, _sum: { amountPaise: true } }),
  ]);
  const invoices = new Map(invoiceAgg.map((a) => [a.builderId, a]));
  const financed = new Map(financedAgg.map((a) => [a.builderId, a]));
  const outstanding = new Map(outstandingAgg.map((a) => [a.builderId, a]));

  return builders.map((b) => ({
    id: b.id,
    name: b.name,
    legalName: b.legalName,
    city: b.city,
    status: b.status,
    programme: b.builderProgrammes[0] ?? null,
    projects: b._count.projects,
    empanelledPartners: b._count.builderRelationships,
    invoiceCount: invoices.get(b.id)?._count._all ?? 0,
    invoicePaise: invoices.get(b.id)?._sum.amountPaise ?? 0n,
    financedCount: financed.get(b.id)?._count._all ?? 0,
    financedPaise: financed.get(b.id)?._sum.approvedAmountPaise ?? 0n,
    outstandingPaise: outstanding.get(b.id)?._sum.amountPaise ?? 0n,
  }));
}

export type BuilderSummary = Awaited<ReturnType<typeof listBuilderSummaries>>[number];

export async function listPartnerSummaries(actor: Actor, filters: { search?: string } = {}) {
  assertPlatform(actor);
  const q = filters.search?.trim();
  const [partners, invoiceAgg, financedAgg, receivedAgg] = await Promise.all([
    db.organisation.findMany({
      where: { type: "CHANNEL_PARTNER", ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { legalName: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }] } : {}) },
      include: {
        cpRelationships: {
          include: { builder: { select: { id: true, name: true, status: true } } },
          orderBy: { builder: { name: "asc" } },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.invoice.groupBy({ by: ["cpId"], where: { status: { not: "DRAFT" } }, _count: { _all: true }, _sum: { amountPaise: true } }),
    db.financingRequest.groupBy({ by: ["cpId"], where: { status: { in: FINANCED_STATUSES } }, _count: { _all: true }, _sum: { approvedAmountPaise: true } }),
    db.financingRequest.groupBy({ by: ["cpId"], where: { status: "DISBURSED" }, _sum: { netPayablePaise: true } }),
  ]);
  const invoices = new Map(invoiceAgg.map((a) => [a.cpId, a]));
  const financed = new Map(financedAgg.map((a) => [a.cpId, a]));
  const received = new Map(receivedAgg.map((a) => [a.cpId, a]));

  return partners.map((p) => ({
    id: p.id,
    name: p.name,
    legalName: p.legalName,
    city: p.city,
    status: p.status,
    empanelments: p.cpRelationships.map((r) => ({
      id: r.id,
      builderId: r.builder.id,
      builderName: r.builder.name,
      code: r.empanelmentCode,
      creditPeriodDays: r.creditPeriodDays,
      status: r.status,
    })),
    invoiceCount: invoices.get(p.id)?._count._all ?? 0,
    invoicePaise: invoices.get(p.id)?._sum.amountPaise ?? 0n,
    financedCount: financed.get(p.id)?._count._all ?? 0,
    financedPaise: financed.get(p.id)?._sum.approvedAmountPaise ?? 0n,
    receivedPaise: received.get(p.id)?._sum.netPayablePaise ?? 0n,
  }));
}

export type PartnerSummary = Awaited<ReturnType<typeof listPartnerSummaries>>[number];

/** Organisation profile plus the programmes and activity figures shown on the admin detail page. */
export async function getOrganisationProfile(actor: Actor, organisationId: string) {
  assertPlatform(actor);
  const org = await getOrganisation(actor, organisationId);
  const invoiceWhere = org.type === "BUILDER" ? { builderId: org.id } : org.type === "CHANNEL_PARTNER" ? { cpId: org.id } : null;
  const requestWhere =
    org.type === "BUILDER" ? { builderId: org.id } : org.type === "CHANNEL_PARTNER" ? { cpId: org.id } : org.type === "FINANCIER" ? { financierId: org.id } : null;

  const [programmes, invoiceAgg, financedAgg] = await Promise.all([
    org.type === "BUILDER" || org.type === "FINANCIER"
      ? db.financingProgramme
          .findMany({
            where: org.type === "BUILDER" ? { builderId: org.id } : { financierId: org.id },
            include: { builder: { select: { id: true, name: true } }, financier: { select: { id: true, name: true } } },
            orderBy: [{ effectiveFrom: "desc" }, { id: "asc" }],
          })
          .then((rows) => sortByEnumName(rows, (p) => p.status))
      : Promise.resolve([]),
    invoiceWhere
      ? db.invoice.aggregate({ where: { ...invoiceWhere, status: { not: "DRAFT" } }, _count: { _all: true }, _sum: { amountPaise: true } })
      : Promise.resolve(null),
    requestWhere
      ? db.financingRequest.aggregate({ where: { ...requestWhere, status: { in: FINANCED_STATUSES } }, _count: { _all: true }, _sum: { approvedAmountPaise: true } })
      : Promise.resolve(null),
  ]);

  return {
    org,
    programmes,
    stats: {
      invoiceCount: invoiceAgg?._count._all ?? null,
      invoicePaise: invoiceAgg?._sum.amountPaise ?? null,
      financedCount: financedAgg?._count._all ?? null,
      financedPaise: financedAgg?._sum.approvedAmountPaise ?? null,
    },
  };
}

/* ----------------------------------------------------------------------------------------------
 * Financing configuration
 * -------------------------------------------------------------------------------------------- */

/** Selectable builders/financiers for the programme form and the count of open offers per programme. */
export async function getProgrammeConfigContext(actor: Actor) {
  assertPlatform(actor);
  const [orgs, openOffers] = await Promise.all([
    db.organisation.findMany({
      where: { type: { in: ["BUILDER", "FINANCIER"] } },
      select: { id: true, name: true, type: true, status: true },
      orderBy: { name: "asc" },
    }),
    db.financingOffer.groupBy({ by: ["programmeId"], where: { status: "OFFERED" }, _count: { _all: true } }),
  ]);
  return {
    builders: orgs.filter((o) => o.type === "BUILDER").map(({ id, name, status }) => ({ id, name, status })),
    financiers: orgs.filter((o) => o.type === "FINANCIER").map(({ id, name, status }) => ({ id, name, status })),
    openOffersByProgramme: Object.fromEntries(openOffers.map((o) => [o.programmeId, o._count._all])) as Record<string, number>,
  };
}

/* ----------------------------------------------------------------------------------------------
 * Audit & reference data
 * -------------------------------------------------------------------------------------------- */

export async function getOrganisationDirectory(actor: Actor) {
  assertPlatform(actor);
  const orgs = await db.organisation.findMany({ select: { id: true, name: true, type: true } });
  return new Map(orgs.map((o) => [o.id, o]));
}

export async function listAuditEntityTypes(actor: Actor): Promise<string[]> {
  assertPlatform(actor);
  const rows = await db.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } });
  return rows.map((r) => r.entityType);
}

export async function listBuilderOptions(actor: Actor) {
  assertPlatform(actor);
  return db.organisation.findMany({ where: { type: "BUILDER" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export interface EnvironmentInfo {
  appVersion: string;
  database: string;
  storageDriver: string;
  nodeVersion: string;
  environment: string;
}

export function getEnvironmentInfo(actor: Actor): EnvironmentInfo {
  assertPlatform(actor);
  return {
    appVersion: packageJson.version,
    database: "PostgreSQL",
    storageDriver: process.env.STORAGE_DRIVER ?? "local",
    nodeVersion: process.version,
    environment: process.env.NODE_ENV ?? "development",
  };
}

