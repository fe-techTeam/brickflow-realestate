import "server-only";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { sumPaise } from "@/lib/money";
import { assertOrgType, type Actor } from "../auth/session";
import { db } from "../db";
import { getOrganisation } from "../services/admin";
import { getEligibility, listFinancingRequests, listOpenOffers, type Eligibility } from "../services/financing";
import { listInvoiceableBuilders, listInvoices, type InvoiceListFilters, type InvoiceListItem } from "../services/invoices";

/** Read models for the channel partner workspace. Every query is scoped to the actor's organisation. */

export const PENDING_INVOICE_STATUSES: InvoiceStatus[] = ["SUBMITTED", "UNDER_REVIEW", "CLARIFICATION_REQUESTED"];

function assertPartner(actor: Actor) {
  assertOrgType(actor, "CHANNEL_PARTNER");
}

/** Early-payment eligibility for each invoice, keyed by invoice id. */
export async function eligibilityFor(invoices: InvoiceListItem[], now: Date = new Date()): Promise<Map<string, Eligibility>> {
  const entries = await Promise.all(invoices.map(async (invoice) => [invoice.id, await getEligibility(invoice, now)] as const));
  return new Map(entries);
}

export async function listPartnerInvoices(actor: Actor, filters: InvoiceListFilters = {}) {
  assertPartner(actor);
  const invoices = await listInvoices(actor, filters);
  const eligibility = await eligibilityFor(invoices);
  return { invoices, eligibility };
}

function monthKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(date).slice(0, 7);
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(year!, month! - 1, 15)));
}

export interface MonthlyInvoiceValue {
  month: string;
  label: string;
  submittedPaise: string;
  approvedPaise: string;
}

/** Invoice value by invoice month for the trailing six months (paise as strings for client charts). */
function monthlySeries(invoices: InvoiceListItem[], now: Date): MonthlyInvoiceValue[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  for (let i = 5; i >= 0; i -= 1) {
    keys.push(monthKey(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 15))));
  }
  return keys.map((key) => {
    const inMonth = invoices.filter((inv) => monthKey(inv.invoiceDate) === key);
    return {
      month: key,
      label: monthLabel(key),
      submittedPaise: sumPaise(inMonth.map((inv) => inv.amountPaise)).toString(),
      approvedPaise: sumPaise(inMonth.filter((inv) => inv.status === "ACCEPTED").map((inv) => inv.approvedAmountPaise)).toString(),
    };
  });
}

export async function getPartnerOverview(actor: Actor) {
  assertPartner(actor);
  const now = new Date();
  const [invoices, requests, offers] = await Promise.all([listInvoices(actor), listFinancingRequests(actor), listOpenOffers(actor)]);
  const eligibility = await eligibilityFor(invoices, now);

  const pending = invoices.filter((inv) => PENDING_INVOICE_STATUSES.includes(inv.status));
  const approved = invoices.filter((inv) => inv.status === "ACCEPTED");
  const eligible = invoices.filter((inv) => eligibility.get(inv.id)?.eligible);
  const financed = requests.filter((r) => r.status !== "REJECTED");
  const received = requests.filter((r) => r.status === "DISBURSED");
  const openOffers = offers.filter((o) => o.status === "OFFERED" && o.validUntil > now);
  const offeredInvoiceIds = new Set(openOffers.map((o) => o.invoiceId));

  return {
    stats: {
      totalInvoiceAmount: sumPaise(invoices.map((inv) => inv.amountPaise)),
      invoiceCount: invoices.length,
      pendingCount: pending.length,
      pendingAmount: sumPaise(pending.map((inv) => inv.amountPaise)),
      approvedCount: approved.length,
      approvedAmount: sumPaise(approved.map((inv) => inv.approvedAmountPaise)),
      eligibleCount: eligible.length,
      eligibleAmount: sumPaise(eligible.map((inv) => inv.approvedAmountPaise)),
      financedCount: financed.length,
      financedAmount: sumPaise(financed.map((r) => r.approvedAmountPaise)),
      receivedCount: received.length,
      receivedAmount: sumPaise(received.map((r) => r.netPayablePaise)),
      builderCount: new Set(invoices.map((inv) => inv.builderId)).size,
      inFlightCount: requests.filter((r) => ["PENDING_APPROVAL", "APPROVED", "DISBURSEMENT_INITIATED"].includes(r.status)).length,
      inFlightAmount: sumPaise(requests.filter((r) => ["PENDING_APPROVAL", "APPROVED", "DISBURSEMENT_INITIATED"].includes(r.status)).map((r) => r.netPayablePaise)),
    },
    clarifications: invoices.filter((inv) => inv.status === "CLARIFICATION_REQUESTED"),
    openOffers,
    eligibleWithoutOffer: eligible.filter((inv) => !offeredInvoiceIds.has(inv.id)),
    eligibility,
    recentInvoices: invoices.slice(0, 6),
    recentRequests: requests.slice(0, 4),
    monthly: monthlySeries(invoices, now),
  };
}

/** Offers, plus eligible invoices that have no open offer yet. */
export async function getPartnerOffers(actor: Actor) {
  assertPartner(actor);
  const now = new Date();
  const [offers, invoices] = await Promise.all([listOpenOffers(actor), listInvoices(actor, { status: "ACCEPTED", financingStatus: { in: ["NOT_REQUESTED", "OFFER_GENERATED"] } })]);
  const eligibility = await eligibilityFor(invoices, now);
  const open = offers.filter((o) => o.status === "OFFERED" && o.validUntil > now);
  const openInvoiceIds = new Set(open.map((o) => o.invoiceId));
  return {
    open,
    history: offers.filter((o) => o.status !== "OFFERED" || o.validUntil <= now),
    eligibleWithoutOffer: invoices.filter((inv) => eligibility.get(inv.id)?.eligible && !openInvoiceIds.has(inv.id)),
    eligibility,
  };
}

/** Builders the partner may invoice, with the identifiers used to match uploaded documents. */
export async function getUploadBuilders(actor: Actor) {
  assertPartner(actor);
  const builders = await listInvoiceableBuilders(actor);
  const [identities, partner] = await Promise.all([
    db.organisation.findMany({
      where: { id: { in: builders.map((b) => b.id) }, builderRelationships: { some: { cpId: actor.orgId, status: "ACTIVE" } } },
      select: { id: true, legalName: true, gstin: true },
    }),
    db.organisation.findUnique({ where: { id: actor.orgId }, select: { gstin: true, legalName: true } }),
  ]);
  const byId = new Map(identities.map((i) => [i.id, i]));
  return {
    builders: builders.map((b) => ({ ...b, legalName: byId.get(b.id)?.legalName ?? null, gstin: byId.get(b.id)?.gstin ?? null })),
    partnerGstin: partner?.gstin ?? null,
  };
}

export async function listPartnerDocuments(actor: Actor) {
  assertPartner(actor);
  return db.invoiceDocument.findMany({
    where: { invoice: { cpId: actor.orgId } },
    include: {
      invoice: {
        select: { id: true, invoiceNumber: true, reference: true, status: true, builder: { select: { name: true } }, project: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function listPartnerDisbursements(actor: Actor) {
  assertPartner(actor);
  const [disbursements, awaiting] = await Promise.all([
    db.disbursement.findMany({
      where: { request: { cpId: actor.orgId } },
      include: {
        request: {
          select: {
            id: true,
            reference: true,
            approvedAmountPaise: true,
            invoice: { select: { id: true, invoiceNumber: true, builder: { select: { name: true } } } },
          },
        },
      },
      orderBy: { initiatedAt: "desc" },
    }),
    listFinancingRequests(actor, { status: "APPROVED" }),
  ]);
  return { disbursements, awaiting };
}

export async function getPartnerProfile(actor: Actor) {
  assertPartner(actor);
  return getOrganisation(actor, actor.orgId);
}
