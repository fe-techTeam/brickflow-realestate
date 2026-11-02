import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import type { FinancingStatus, Prisma, SettlementStatus } from "@/generated/prisma/client";
import { calculateDiscount } from "@/lib/financing";
import { formatBps, formatINR } from "@/lib/money";
import { recordAudit } from "../audit";
import { assertOrgType, type Actor } from "../auth/session";
import { db, type Tx } from "../db";
import { conflict, forbidden, notFound } from "../errors";
import { nextReference } from "../sequence";

export const CONSENT_TEXT =
  "I confirm that I wish to receive early payment for this builder-approved invoice at the discount shown. " +
  "I understand the discount is deducted upfront, that the net amount will be paid to my registered bank account, " +
  "and that the builder will settle the full approved amount with the financier on the original due date. " +
  "This is a demonstration transaction and no real funds will move.";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The programme currently applicable to a builder: active, in its effective window, with an active financier. */
export async function getApplicableProgramme(builderId: string, at: Date = new Date(), client: Tx | typeof db = db) {
  return client.financingProgramme.findFirst({
    where: {
      builderId,
      status: "ACTIVE",
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      financier: { status: "ACTIVE" },
    },
    include: { financier: { select: { id: true, name: true } } },
    orderBy: { effectiveFrom: "desc" },
  });
}

export type ApplicableProgramme = NonNullable<Awaited<ReturnType<typeof getApplicableProgramme>>>;

export interface Eligibility {
  eligible: boolean;
  reason: string | null;
  programme: ApplicableProgramme | null;
}

type EligibilityInvoice = Pick<
  Prisma.InvoiceGetPayload<object>,
  "status" | "financingStatus" | "approvedAmountPaise" | "dueDate" | "builderId"
>;

export async function getEligibility(invoice: EligibilityInvoice, now: Date = new Date()): Promise<Eligibility> {
  if (invoice.status !== "ACCEPTED") return { eligible: false, reason: "Invoice must be accepted by the builder first.", programme: null };
  if (!["NOT_REQUESTED", "OFFER_GENERATED"].includes(invoice.financingStatus))
    return { eligible: false, reason: "Early payment has already been requested for this invoice.", programme: null };
  if (!invoice.approvedAmountPaise || invoice.approvedAmountPaise <= 0n)
    return { eligible: false, reason: "No builder-approved amount is recorded.", programme: null };
  if (invoice.dueDate && invoice.dueDate.getTime() <= now.getTime())
    return { eligible: false, reason: "The invoice due date has passed.", programme: null };
  const programme = await getApplicableProgramme(invoice.builderId, now);
  if (!programme) return { eligible: false, reason: "No active financing programme is configured for this builder.", programme: null };
  return { eligible: true, reason: null, programme };
}

function termsSnapshot(programme: ApplicableProgramme) {
  return JSON.stringify({
    programmeCode: programme.code,
    programmeName: programme.name,
    financier: programme.financier.name,
    discountRateBps: programme.discountRateBps,
    offerValidityDays: programme.offerValidityDays,
    terms: programme.terms,
  });
}

export interface OfferTerms {
  programmeCode: string;
  programmeName: string;
  financier: string;
  discountRateBps: number;
  offerValidityDays: number;
  terms: string;
}

export function parseOfferTerms(snapshot: string): OfferTerms {
  return JSON.parse(snapshot) as OfferTerms;
}

/** "GET DISCOUNTED AMOUNT": creates (or returns the still-valid) offer computed on the server from the configured rate. */
export async function generateOffer(actor: Actor, invoiceId: string) {
  assertOrgType(actor, "CHANNEL_PARTNER");
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.cpId !== actor.orgId) throw notFound("Invoice not found.");

  const now = new Date();
  const { eligible, reason, programme } = await getEligibility(invoice, now);
  if (!eligible || !programme) throw conflict(reason ?? "This invoice is not eligible for early payment.");

  const current = await db.financingOffer.findFirst({
    where: { invoiceId: invoice.id, status: "OFFERED", validUntil: { gt: now } },
    orderBy: { generatedAt: "desc" },
  });
  if (current && current.programmeId === programme.id && current.discountRateBps === programme.discountRateBps) {
    return current;
  }

  const breakdown = calculateDiscount(invoice.approvedAmountPaise!, programme.discountRateBps);

  return db.$transaction(async (tx) => {
    await tx.financingOffer.updateMany({ where: { invoiceId: invoice.id, status: "OFFERED" }, data: { status: "SUPERSEDED" } });
    const reference = await nextReference(tx, "offer", now);
    const offer = await tx.financingOffer.create({
      data: {
        reference,
        invoiceId: invoice.id,
        programmeId: programme.id,
        invoiceAmountPaise: invoice.amountPaise,
        approvedAmountPaise: breakdown.approvedAmountPaise,
        discountRateBps: breakdown.discountRateBps,
        discountAmountPaise: breakdown.discountAmountPaise,
        chargesPaise: breakdown.chargesPaise,
        netPayablePaise: breakdown.netPayablePaise,
        termsSnapshot: termsSnapshot(programme),
        generatedById: actor.userId,
        generatedAt: now,
        validUntil: new Date(now.getTime() + programme.offerValidityDays * DAY_MS),
      },
    });
    const moved = await tx.invoice.updateMany({
      where: { id: invoice.id, status: "ACCEPTED", financingStatus: { in: ["NOT_REQUESTED", "OFFER_GENERATED"] } },
      data: { financingStatus: "OFFER_GENERATED" },
    });
    if (moved.count !== 1) throw conflict("Early payment has already been requested for this invoice.");
    await recordAudit(tx, actor, {
      action: "financing.offer_generated",
      entityType: "FinancingOffer",
      entityId: offer.id,
      summary: `Generated offer ${reference} on invoice ${invoice.invoiceNumber}: ${formatBps(offer.discountRateBps)} discount, net ${formatINR(offer.netPayablePaise)}`,
      metadata: { invoiceId: invoice.id, programmeId: programme.id, ...breakdown },
    });
    return offer;
  });
}

export async function getOfferForActor(actor: Actor, offerId: string) {
  const offer = await db.financingOffer.findUnique({
    where: { id: offerId },
    include: { invoice: { include: { builder: true, project: true, cp: true } }, programme: { include: { financier: true } } },
  });
  if (!offer) throw notFound("Offer not found.");
  const allowed =
    actor.orgType === "PLATFORM" ||
    (actor.orgType === "CHANNEL_PARTNER" && offer.invoice.cpId === actor.orgId) ||
    (actor.orgType === "BUILDER" && offer.invoice.builderId === actor.orgId) ||
    (actor.orgType === "FINANCIER" && offer.programme.financierId === actor.orgId);
  if (!allowed) throw notFound("Offer not found.");
  return offer;
}

const acceptSchema = z.object({
  consent: z.literal(true, { error: "You must confirm the consent statement to proceed." }),
});

async function addEvent(tx: Tx, requestId: string, from: FinancingStatus | null, to: FinancingStatus, actor: Actor | null, note?: string) {
  await tx.financingEvent.create({
    data: { requestId, fromStatus: from, toStatus: to, note: note ?? null, actorUserId: actor?.userId ?? null, actorName: actor?.name ?? "System" },
  });
}

/**
 * CP accepts an offer. The financing request stores a full snapshot of the offer's figures, so later changes
 * to the programme rate never alter an accepted transaction. An offer whose rate no longer matches the live
 * programme is superseded and must be regenerated.
 */
export async function acceptOffer(actor: Actor, offerId: string, raw: { consent: boolean }) {
  assertOrgType(actor, "CHANNEL_PARTNER");
  acceptSchema.parse(raw);
  const offer = await db.financingOffer.findUnique({ where: { id: offerId }, include: { invoice: true, programme: true } });
  if (!offer || offer.invoice.cpId !== actor.orgId) throw notFound("Offer not found.");
  if (offer.status === "ACCEPTED") throw conflict("This offer has already been accepted.");
  if (offer.status !== "OFFERED") throw conflict("This offer is no longer available. Generate a fresh offer.");

  const now = new Date();
  if (offer.validUntil <= now) {
    await db.financingOffer.updateMany({ where: { id: offer.id, status: "OFFERED" }, data: { status: "EXPIRED" } });
    throw conflict("This offer has expired. Generate a fresh offer.");
  }
  const live = await getApplicableProgramme(offer.invoice.builderId, now);
  if (!live || live.id !== offer.programmeId || live.discountRateBps !== offer.discountRateBps) {
    await db.$transaction([
      db.financingOffer.updateMany({ where: { id: offer.id, status: "OFFERED" }, data: { status: "SUPERSEDED" } }),
      db.invoice.updateMany({ where: { id: offer.invoiceId, financingStatus: "OFFER_GENERATED" }, data: { financingStatus: "NOT_REQUESTED" } }),
    ]);
    throw conflict("The agreed financing terms for this builder have changed. Generate a fresh offer to see the current terms.");
  }

  try {
    return await db.$transaction(async (tx) => {
      const claimed = await tx.financingOffer.updateMany({
        where: { id: offer.id, status: "OFFERED" },
        data: { status: "ACCEPTED", acceptedById: actor.userId, acceptedAt: now, consentText: CONSENT_TEXT },
      });
      if (claimed.count !== 1) throw conflict("This offer has already been accepted.");

      const moved = await tx.invoice.updateMany({
        where: { id: offer.invoiceId, status: "ACCEPTED", financingStatus: "OFFER_GENERATED" },
        data: { financingStatus: "PENDING_APPROVAL" },
      });
      if (moved.count !== 1) throw conflict("A financing request already exists for this invoice.");

      const reference = await nextReference(tx, "request", now);
      const request = await tx.financingRequest.create({
        data: {
          reference,
          invoiceId: offer.invoiceId,
          offerId: offer.id,
          programmeId: offer.programmeId,
          cpId: offer.invoice.cpId,
          builderId: offer.invoice.builderId,
          financierId: offer.programme.financierId,
          approvedAmountPaise: offer.approvedAmountPaise,
          discountRateBps: offer.discountRateBps,
          discountAmountPaise: offer.discountAmountPaise,
          chargesPaise: offer.chargesPaise,
          netPayablePaise: offer.netPayablePaise,
          status: "PENDING_APPROVAL",
          acceptedById: actor.userId,
          acceptedAt: now,
        },
      });
      await addEvent(tx, request.id, null, "ACCEPTED_BY_CP", actor, `Offer ${offer.reference} accepted with explicit consent`);
      await addEvent(tx, request.id, "ACCEPTED_BY_CP", "PENDING_APPROVAL", null, "Submitted to Veefin for approval");
      await recordAudit(tx, actor, {
        action: "financing.offer_accepted",
        entityType: "FinancingRequest",
        entityId: request.id,
        summary: `Accepted offer ${offer.reference}; financing request ${reference} created for ${formatINR(offer.netPayablePaise)}`,
        metadata: {
          offerId: offer.id,
          invoiceId: offer.invoiceId,
          discountRateBps: offer.discountRateBps,
          discountAmountPaise: offer.discountAmountPaise,
          netPayablePaise: offer.netPayablePaise,
          consentText: CONSENT_TEXT,
        },
      });
      return request;
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      throw conflict("A financing request already exists for this invoice.");
    }
    throw error;
  }
}

/* ----------------------------------------------------------------------------------------------
 * Financier operations
 * -------------------------------------------------------------------------------------------- */

async function loadRequestForFinancier(actor: Actor, requestId: string) {
  assertOrgType(actor, "FINANCIER");
  const request = await db.financingRequest.findUnique({ where: { id: requestId }, include: { invoice: true, cp: true } });
  if (!request || request.financierId !== actor.orgId) throw notFound("Financing request not found.");
  return request;
}

async function moveRequest(tx: Tx, requestId: string, from: FinancingStatus, to: FinancingStatus, data: Prisma.FinancingRequestUpdateManyMutationInput = {}) {
  const updated = await tx.financingRequest.updateMany({ where: { id: requestId, status: from }, data: { status: to, ...data } });
  if (updated.count !== 1) throw conflict("This request was updated by someone else. Refresh and try again.");
}

const noteSchema = z.object({ note: z.string().trim().max(1000).optional() });
const reasonSchema = z.object({
  reason: z.string().trim().min(10, "Provide a reason of at least 10 characters").max(1000),
});

export async function approveFinancingRequest(actor: Actor, requestId: string, raw: { note?: string }) {
  const { note } = noteSchema.parse(raw);
  const request = await loadRequestForFinancier(actor, requestId);
  if (request.status !== "PENDING_APPROVAL") throw conflict("Only requests pending approval can be approved.");
  const now = new Date();
  await db.$transaction(async (tx) => {
    await moveRequest(tx, request.id, "PENDING_APPROVAL", "APPROVED", { decidedById: actor.userId, decidedAt: now, decisionNote: note || null });
    await tx.invoice.update({ where: { id: request.invoiceId }, data: { financingStatus: "APPROVED" } });
    await addEvent(tx, request.id, "PENDING_APPROVAL", "APPROVED", actor, note || "Approved for disbursement");
    await recordAudit(tx, actor, {
      action: "financing.approved",
      entityType: "FinancingRequest",
      entityId: request.id,
      summary: `Approved financing request ${request.reference} (${formatINR(request.netPayablePaise)})`,
      metadata: { note },
    });
  });
}

export async function rejectFinancingRequest(actor: Actor, requestId: string, raw: { reason: string }) {
  const { reason } = reasonSchema.parse(raw);
  const request = await loadRequestForFinancier(actor, requestId);
  if (request.status !== "PENDING_APPROVAL") throw conflict("Only requests pending approval can be rejected.");
  const now = new Date();
  await db.$transaction(async (tx) => {
    await moveRequest(tx, request.id, "PENDING_APPROVAL", "REJECTED", { decidedById: actor.userId, decidedAt: now, decisionNote: reason });
    await tx.invoice.update({ where: { id: request.invoiceId }, data: { financingStatus: "REJECTED" } });
    await addEvent(tx, request.id, "PENDING_APPROVAL", "REJECTED", actor, reason);
    await recordAudit(tx, actor, {
      action: "financing.rejected",
      entityType: "FinancingRequest",
      entityId: request.id,
      summary: `Rejected financing request ${request.reference}`,
      metadata: { reason },
    });
  });
}

const commentSchema = z.object({ body: z.string().trim().min(2, "Comment is too short").max(2000) });

export async function addInternalComment(actor: Actor, requestId: string, raw: { body: string }) {
  const { body } = commentSchema.parse(raw);
  const request = await loadRequestForFinancier(actor, requestId);
  await db.$transaction(async (tx) => {
    await tx.internalComment.create({ data: { requestId: request.id, body, authorId: actor.userId, authorName: actor.name } });
    await recordAudit(tx, actor, {
      action: "financing.comment_added",
      entityType: "FinancingRequest",
      entityId: request.id,
      summary: `Added internal comment on ${request.reference}`,
    });
  });
}

function maskAccount(account: string | null): string {
  if (!account) return "XXXX";
  return `XXXX${account.slice(-4)}`;
}

/** Simulated payout, step 1: books the disbursement instruction. No bank integration is involved. */
export async function initiateDisbursement(actor: Actor, requestId: string) {
  const request = await loadRequestForFinancier(actor, requestId);
  if (request.status !== "APPROVED") throw conflict("Only approved requests can be disbursed.");
  const now = new Date();
  return db.$transaction(async (tx) => {
    await moveRequest(tx, request.id, "APPROVED", "DISBURSEMENT_INITIATED");
    await tx.invoice.update({ where: { id: request.invoiceId }, data: { financingStatus: "DISBURSEMENT_INITIATED" } });
    const reference = await nextReference(tx, "payment", now);
    const disbursement = await tx.disbursement.create({
      data: {
        requestId: request.id,
        reference,
        amountPaise: request.netPayablePaise,
        beneficiaryName: request.cp.legalName,
        beneficiaryAccount: maskAccount(request.cp.bankAccountNumber),
        beneficiaryIfsc: request.cp.bankIfsc ?? "DEMO0000001",
        initiatedById: actor.userId,
        initiatedAt: now,
      },
    });
    await addEvent(tx, request.id, "APPROVED", "DISBURSEMENT_INITIATED", actor, `Simulated payout ${reference} initiated`);
    await recordAudit(tx, actor, {
      action: "disbursement.initiated",
      entityType: "Disbursement",
      entityId: disbursement.id,
      summary: `Initiated simulated disbursement ${reference} of ${formatINR(request.netPayablePaise)} to ${request.cp.name}`,
      metadata: { requestId: request.id, simulated: true },
    });
    return disbursement;
  });
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Simulated payout, step 2: confirms the (simulated) bank acknowledgement and opens the builder settlement. */
export async function completeDisbursement(actor: Actor, requestId: string) {
  const request = await loadRequestForFinancier(actor, requestId);
  if (request.status !== "DISBURSEMENT_INITIATED") throw conflict("No disbursement is in progress for this request.");
  const relationship = await db.cpBuilderRelationship.findUnique({
    where: { cpId_builderId: { cpId: request.cpId, builderId: request.builderId } },
  });
  const now = new Date();
  const dueDate = request.invoice.dueDate ?? addDays(request.invoice.invoiceDate, relationship?.creditPeriodDays ?? 60);
  const utr = `DEMOUTR${now.getUTCFullYear()}${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;

  await db.$transaction(async (tx) => {
    const done = await tx.disbursement.updateMany({
      where: { requestId: request.id, status: "INITIATED" },
      data: { status: "SUCCESS", utr, completedById: actor.userId, completedAt: now },
    });
    if (done.count !== 1) throw conflict("This disbursement has already been completed.");
    await moveRequest(tx, request.id, "DISBURSEMENT_INITIATED", "DISBURSED");
    await tx.invoice.update({ where: { id: request.invoiceId }, data: { financingStatus: "DISBURSED" } });
    const settlement = await tx.settlement.create({
      data: {
        requestId: request.id,
        builderId: request.builderId,
        financierId: request.financierId,
        amountPaise: request.approvedAmountPaise,
        dueDate,
        status: settlementStatusFor(dueDate, now),
      },
    });
    await addEvent(tx, request.id, "DISBURSEMENT_INITIATED", "DISBURSED", actor, `Simulated transfer confirmed (UTR ${utr})`);
    await recordAudit(tx, actor, {
      action: "disbursement.completed",
      entityType: "Disbursement",
      entityId: request.id,
      summary: `Simulated disbursement for ${request.reference} completed; builder settlement of ${formatINR(settlement.amountPaise)} due ${dueDate.toISOString().slice(0, 10)}`,
      metadata: { utr, settlementId: settlement.id, simulated: true },
    });
  });
}

/** Derived settlement status for an unsettled obligation. */
export function settlementStatusFor(dueDate: Date, now: Date = new Date()): SettlementStatus {
  const due = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (today < due) return "NOT_DUE";
  if (today === due) return "DUE";
  return "OVERDUE";
}

export function effectiveSettlementStatus(settlement: { status: SettlementStatus; dueDate: Date }, now: Date = new Date()): SettlementStatus {
  return settlement.status === "SETTLED" ? "SETTLED" : settlementStatusFor(settlement.dueDate, now);
}

/** Persists derived NOT_DUE/DUE/OVERDUE transitions so reports and filters stay accurate. */
export async function refreshSettlementStatuses(now: Date = new Date()): Promise<void> {
  const open = await db.settlement.findMany({ where: { status: { not: "SETTLED" } }, select: { id: true, status: true, dueDate: true } });
  const changes = open
    .map((s) => ({ id: s.id, next: settlementStatusFor(s.dueDate, now), current: s.status }))
    .filter((s) => s.next !== s.current);
  if (changes.length === 0) return;
  await db.$transaction(changes.map((c) => db.settlement.update({ where: { id: c.id }, data: { status: c.next } })));
}

const settleSchema = z.object({
  reference: z.string().trim().min(4, "Enter the settlement reference").max(60),
  note: z.string().trim().max(500).optional(),
});

/** Records that the builder has paid the financier. Performed by the financier's operations user. */
export async function markSettlementSettled(actor: Actor, requestId: string, raw: { reference: string; note?: string }) {
  const input = settleSchema.parse(raw);
  const request = await loadRequestForFinancier(actor, requestId);
  const settlement = await db.settlement.findUnique({ where: { requestId: request.id } });
  if (!settlement) throw conflict("No settlement exists for this request yet.");
  if (settlement.status === "SETTLED") throw conflict("This settlement is already marked as settled.");
  const now = new Date();
  await db.$transaction(async (tx) => {
    const updated = await tx.settlement.updateMany({
      where: { id: settlement.id, status: { not: "SETTLED" } },
      data: { status: "SETTLED", reference: input.reference, note: input.note || null, settledAt: now, settledById: actor.userId },
    });
    if (updated.count !== 1) throw conflict("This settlement is already marked as settled.");
    await recordAudit(tx, actor, {
      action: "settlement.settled",
      entityType: "Settlement",
      entityId: settlement.id,
      summary: `Marked settlement for ${request.reference} as settled (${input.reference})`,
      metadata: { requestId: request.id, amountPaise: settlement.amountPaise },
    });
  });
}

/* ----------------------------------------------------------------------------------------------
 * Read access
 * -------------------------------------------------------------------------------------------- */

export function requestScope(actor: Actor): Prisma.FinancingRequestWhereInput {
  switch (actor.orgType) {
    case "CHANNEL_PARTNER":
      return { cpId: actor.orgId };
    case "BUILDER":
      return { builderId: actor.orgId };
    case "FINANCIER":
      return { financierId: actor.orgId };
    case "PLATFORM":
      return {};
    default:
      throw forbidden();
  }
}

export const requestListInclude = {
  invoice: { select: { id: true, invoiceNumber: true, reference: true, invoiceDate: true, dueDate: true, amountPaise: true, project: { select: { name: true } } } },
  cp: { select: { id: true, name: true } },
  builder: { select: { id: true, name: true } },
  financier: { select: { id: true, name: true } },
  disbursement: true,
  settlement: true,
} satisfies Prisma.FinancingRequestInclude;

export interface RequestListFilters {
  status?: FinancingStatus | FinancingStatus[];
  search?: string;
  builderId?: string;
  cpId?: string;
}

export async function listFinancingRequests(actor: Actor, filters: RequestListFilters = {}) {
  const and: Prisma.FinancingRequestWhereInput[] = [requestScope(actor)];
  if (filters.status) and.push({ status: Array.isArray(filters.status) ? { in: filters.status } : filters.status });
  if (filters.builderId) and.push({ builderId: filters.builderId });
  if (filters.cpId) and.push({ cpId: filters.cpId });
  if (filters.search?.trim()) {
    const q = filters.search.trim();
    and.push({
      OR: [
        { reference: { contains: q } },
        { invoice: { invoiceNumber: { contains: q } } },
        { cp: { name: { contains: q } } },
        { builder: { name: { contains: q } } },
      ],
    });
  }
  return db.financingRequest.findMany({ where: { AND: and }, include: requestListInclude, orderBy: { createdAt: "desc" } });
}

export type FinancingRequestListItem = Awaited<ReturnType<typeof listFinancingRequests>>[number];

export async function getFinancingRequestDetail(actor: Actor, requestId: string) {
  const request = await db.financingRequest.findFirst({
    where: { AND: [{ id: requestId }, requestScope(actor)] },
    include: {
      invoice: { include: { project: true, documents: { orderBy: { createdAt: "desc" } }, approvals: { orderBy: { createdAt: "asc" } } } },
      offer: true,
      programme: true,
      cp: true,
      builder: true,
      financier: true,
      events: { orderBy: { createdAt: "asc" } },
      comments: actor.orgType === "FINANCIER" || actor.orgType === "PLATFORM" ? { orderBy: { createdAt: "desc" } } : false,
      disbursement: true,
      settlement: true,
    },
  });
  if (!request) throw notFound("Financing request not found.");
  return request;
}

export type FinancingRequestDetail = Awaited<ReturnType<typeof getFinancingRequestDetail>>;

/** Open (not accepted/expired) offers for a channel partner. Expired offers are flagged on read. */
export async function listOpenOffers(actor: Actor) {
  assertOrgType(actor, "CHANNEL_PARTNER");
  const now = new Date();
  await db.financingOffer.updateMany({
    where: { status: "OFFERED", validUntil: { lte: now }, invoice: { cpId: actor.orgId } },
    data: { status: "EXPIRED" },
  });
  return db.financingOffer.findMany({
    where: { invoice: { cpId: actor.orgId } },
    include: { invoice: { include: { builder: { select: { name: true } }, project: { select: { name: true } } } }, programme: { select: { code: true, name: true } } },
    orderBy: { generatedAt: "desc" },
  });
}
