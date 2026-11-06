import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import type { FinancingStatus, Invoice, Prisma } from "@/generated/prisma/client";
import { addDays, compareCalendarDates, endOfIstDay, isFutureInIst, istToday, toCalendarDate, toStorageDate, type CalendarDate } from "@/lib/calendar";
import { consentTextFor, keyFactsAsOf } from "@/lib/key-facts";
import { formatBps, formatINR } from "@/lib/money";
import { serialiseQuote, type PricingQuote } from "@/lib/pricing";
import { assertTransition, sourcesFor } from "@/lib/state-machines";
import { recordAudit } from "../audit";
import { assertOrgType, type Actor } from "../auth/session";
import { db, type Tx } from "../db";
import { conflict, forbidden, notFound } from "../errors";
import { nextReference } from "../sequence";
import { idempotencyKeySchema, runIdempotent } from "./financing-idempotency";
import { invoiceDueDate, matchesQuote, pricingColumns, quoteInvoice, settlementDueDate, storedPricing, type InvoiceQuote } from "./financing-pricing";
import { assertStepUp } from "./financing-step-up";
import { assertCpEligibleForPayout } from "./kyc";
import { settlementStatusFor } from "./settlements";

export { CONSENT_TEXT } from "@/lib/key-facts";
export { assertStepUp } from "./financing-step-up";
export { effectiveSettlementStatus, recomputeSettlementStatuses, refreshSettlementStatuses, settlementStatusFor } from "./settlements";

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
  /** Today's price when eligible. */
  quote?: InvoiceQuote & { result: { ok: true; quote: PricingQuote } };
}

type EligibilityInvoice = Pick<Invoice, "status" | "financingStatus" | "approvedAmountPaise" | "dueDate" | "builderId" | "cpId" | "invoiceDate">;

/** Whether an invoice can be offered early payment now. Dates are evaluated on the IST calendar. */
export async function getEligibility(invoice: EligibilityInvoice, now: Date = new Date()): Promise<Eligibility> {
  if (invoice.status !== "ACCEPTED") return { eligible: false, reason: "Invoice must be accepted by the builder first.", programme: null };
  if (!["NOT_REQUESTED", "OFFER_GENERATED"].includes(invoice.financingStatus))
    return { eligible: false, reason: "Early payment has already been requested for this invoice.", programme: null };
  if (!invoice.approvedAmountPaise || invoice.approvedAmountPaise <= 0n)
    return { eligible: false, reason: "No builder-approved amount is recorded.", programme: null };
  if (invoice.dueDate && !isFutureInIst(toCalendarDate(invoice.dueDate), now))
    return { eligible: false, reason: "The invoice due date has passed.", programme: null };
  const programme = await getApplicableProgramme(invoice.builderId, now);
  if (!programme) return { eligible: false, reason: "No active financing programme is configured for this builder.", programme: null };
  const quote = await quoteInvoice(programme, invoice, now);
  if (!quote.result.ok) return { eligible: false, reason: quote.result.message, programme: null };
  return { eligible: true, reason: null, programme, quote: { ...quote, result: quote.result } };
}

function termsSnapshot(programme: ApplicableProgramme) {
  return JSON.stringify({
    programmeCode: programme.code,
    programmeName: programme.name,
    financier: programme.financier.name,
    discountRateBps: programme.discountRateBps,
    pricingMode: programme.pricingMode,
    offerValidityDays: programme.offerValidityDays,
    terms: programme.terms,
  });
}

export interface OfferTerms {
  programmeCode: string;
  programmeName: string;
  financier: string;
  discountRateBps: number;
  pricingMode?: ApplicableProgramme["pricingMode"];
  offerValidityDays: number;
  terms: string;
}

export function parseOfferTerms(snapshot: string): OfferTerms {
  return JSON.parse(snapshot) as OfferTerms;
}

/**
 * Last instant an offer can be accepted: the end of the IST day `offerValidityDays` ahead, or the end
 * of today for annual-rate programmes (their price changes with every day to the due date). Never
 * beyond the last day the invoice is eligible or the programme's minimum tenor still holds.
 */
export function offerValidUntil(
  programme: Pick<ApplicableProgramme, "pricingMode" | "offerValidityDays" | "minTenorDays">,
  invoiceDue: CalendarDate,
  settlementDue: CalendarDate,
  now: Date,
): Date {
  const today = istToday(now);
  const candidates = [
    programme.pricingMode === "ANNUAL_RATE" ? today : addDays(today, programme.offerValidityDays),
    addDays(invoiceDue, -1),
    addDays(settlementDue, -programme.minTenorDays),
  ];
  const last = candidates.reduce((a, b) => (compareCalendarDates(a, b) <= 0 ? a : b));
  return endOfIstDay(compareCalendarDates(last, today) < 0 ? today : last);
}

/** "GET DISCOUNTED AMOUNT": creates (or returns the still-valid) offer priced on the server from the programme's terms. */
export async function generateOffer(actor: Actor, invoiceId: string) {
  assertOrgType(actor, "CHANNEL_PARTNER");
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.cpId !== actor.orgId) throw notFound("Invoice not found.");

  const now = new Date();
  const { eligible, reason, programme, quote } = await getEligibility(invoice, now);
  if (!eligible || !programme || !quote) throw conflict(reason ?? "This invoice is not eligible for early payment.");
  const priced = quote.result.quote;

  const current = await db.financingOffer.findFirst({
    where: { invoiceId: invoice.id, status: "OFFERED", validUntil: { gt: now } },
    orderBy: { generatedAt: "desc" },
  });
  if (current && current.programmeId === programme.id && matchesQuote(current, priced)) return current;

  return db.$transaction(async (tx) => {
    await tx.financingOffer.updateMany({ where: { invoiceId: invoice.id, status: "OFFERED" }, data: { status: "SUPERSEDED" } });
    const reference = await nextReference(tx, "offer", now);
    const offer = await tx.financingOffer.create({
      data: {
        reference,
        invoiceId: invoice.id,
        programmeId: programme.id,
        invoiceAmountPaise: invoice.amountPaise,
        ...pricingColumns(priced, programme, quote.invoiceDueDate, now),
        termsSnapshot: termsSnapshot(programme),
        generatedById: actor.userId,
        generatedAt: now,
        validUntil: offerValidUntil(programme, quote.invoiceDueDate, quote.settlementDueDate, now),
      },
    });
    const moved = await tx.invoice.updateMany({
      where: { id: invoice.id, status: "ACCEPTED", financingStatus: { in: sourcesFor("financing", "OFFER_GENERATED", ["NOT_REQUESTED", "OFFER_GENERATED"]) } },
      data: { financingStatus: "OFFER_GENERATED" },
    });
    if (moved.count !== 1) throw conflict("Early payment has already been requested for this invoice.");
    await recordAudit(tx, actor, {
      action: "financing.offer_generated",
      entityType: "FinancingOffer",
      entityId: offer.id,
      summary: `Generated offer ${reference} on invoice ${invoice.invoiceNumber}: ${formatBps(offer.discountRateBps)} ${priced.pricingMode === "ANNUAL_RATE" ? "a year" : "discount"}, net ${formatINR(offer.netPayablePaise)}`,
      metadata: { invoiceId: invoice.id, programmeId: programme.id, ...serialiseQuote(priced) },
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

const optionalKey = idempotencyKeySchema.optional();

const acceptSchema = z.object({
  consent: z.literal(true, { error: "You must confirm the consent statement to proceed." }),
  idempotencyKey: optionalKey,
});

async function addEvent(tx: Tx, requestId: string, from: FinancingStatus | null, to: FinancingStatus, actor: Actor | null, note?: string) {
  await tx.financingEvent.create({
    data: { requestId, fromStatus: from, toStatus: to, note: note ?? null, actorUserId: actor?.userId ?? null, actorName: actor?.name ?? "System" },
  });
}

/** Moves an invoice's financing status in step with its request, along an allowed edge only. */
async function moveInvoiceFinancing(tx: Tx, invoiceId: string, from: FinancingStatus, to: FinancingStatus) {
  assertTransition("financing", from, to);
  const moved = await tx.invoice.updateMany({ where: { id: invoiceId, financingStatus: from }, data: { financingStatus: to } });
  if (moved.count !== 1) throw conflict("The invoice was updated by someone else. Refresh and try again.");
}

async function withdrawOffer(offerId: string, invoiceId: string) {
  await db.$transaction([
    db.financingOffer.updateMany({ where: { id: offerId, status: "OFFERED" }, data: { status: "SUPERSEDED" } }),
    db.invoice.updateMany({ where: { id: invoiceId, financingStatus: "OFFER_GENERATED" }, data: { financingStatus: "NOT_REQUESTED" } }),
  ]);
}

/**
 * CP accepts an offer. The offer is repriced against the live programme first; if any amount,
 * the rate or the settlement date differs, it is withdrawn and must be regenerated. The request
 * stores the full pricing snapshot, so later programme changes never alter an accepted transaction.
 * A repeated submission with the same idempotency key returns the original request.
 */
export async function acceptOffer(actor: Actor, offerId: string, raw: { consent: boolean; idempotencyKey?: string }) {
  assertOrgType(actor, "CHANNEL_PARTNER");
  const input = acceptSchema.parse(raw);
  const offer = await db.financingOffer.findUnique({ where: { id: offerId }, include: { invoice: true, programme: true } });
  if (!offer || offer.invoice.cpId !== actor.orgId) throw notFound("Offer not found.");
  await assertStepUp(actor, "financing.offer_accept");

  return runIdempotent(
    { actor, scope: "offer.accept", key: input.idempotencyKey, payload: { offerId: offer.id } },
    async (claim) => {
      if (offer.status === "ACCEPTED") throw conflict("This offer has already been accepted.");
      if (offer.status !== "OFFERED") throw conflict("This offer is no longer available. Generate a fresh offer.");
      // KYC payout gate (Verification & KYC area), before any state change; a no-op unless KYC_ENFORCED is on.
      await assertCpEligibleForPayout(offer.invoice.cpId);

      const now = new Date();
      if (offer.validUntil <= now) {
        await db.financingOffer.updateMany({ where: { id: offer.id, status: "OFFERED" }, data: { status: "EXPIRED" } });
        throw conflict("This offer has expired. Generate a fresh offer.");
      }
      const live = await getApplicableProgramme(offer.invoice.builderId, now);
      const liveQuote = live && live.id === offer.programmeId ? await quoteInvoice(live, offer.invoice, now) : null;
      if (!live || !liveQuote || !liveQuote.result.ok || !matchesQuote(offer, liveQuote.result.quote)) {
        await withdrawOffer(offer.id, offer.invoiceId);
        if (liveQuote && !liveQuote.result.ok) throw conflict(`${liveQuote.result.message} This offer has been withdrawn.`);
        throw conflict("The agreed financing terms for this builder have changed. Generate a fresh offer to see the current terms.");
      }
      const priced = liveQuote.result.quote;
      const columns = pricingColumns(priced, live, liveQuote.invoiceDueDate, now);
      const consentText = consentTextFor(keyFactsAsOf(storedPricing(columns), istToday(now)));

      try {
        return await db.$transaction(async (tx) => {
          const claimed = await tx.financingOffer.updateMany({
            where: { id: offer.id, status: "OFFERED" },
            data: { status: "ACCEPTED", acceptedById: actor.userId, acceptedAt: now, consentText },
          });
          if (claimed.count !== 1) throw conflict("This offer has already been accepted.");

          assertTransition("financing", "OFFER_GENERATED", "PENDING_APPROVAL");
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
              ...columns,
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
            metadata: { offerId: offer.id, invoiceId: offer.invoiceId, ...serialiseQuote(priced), consentText },
          });
          await claim(tx, request.id);
          return request;
        });
      } catch (error) {
        if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
          throw conflict("A financing request already exists for this invoice.");
        }
        throw error;
      }
    },
    async (requestId) => db.financingRequest.findUniqueOrThrow({ where: { id: requestId ?? "" } }),
  );
}

/* ----------------------------------------------------------------------------------------------
 * Financier operations
 * -------------------------------------------------------------------------------------------- */

async function loadRequestForFinancier(actor: Actor, requestId: string) {
  assertOrgType(actor, "FINANCIER");
  const request = await db.financingRequest.findUnique({
    where: { id: requestId },
    include: { invoice: true, cp: true, programme: { select: { holidayRule: true } } },
  });
  if (!request || request.financierId !== actor.orgId) throw notFound("Financing request not found.");
  return request;
}

async function moveRequest(tx: Tx, requestId: string, from: FinancingStatus, to: FinancingStatus, data: Prisma.FinancingRequestUpdateManyMutationInput = {}) {
  assertTransition("financing", from, to);
  const updated = await tx.financingRequest.updateMany({ where: { id: requestId, status: from }, data: { status: to, ...data } });
  if (updated.count !== 1) throw conflict("This request was updated by someone else. Refresh and try again.");
}

const noteSchema = z.object({ note: z.string().trim().max(1000).optional(), idempotencyKey: optionalKey });
const reasonSchema = z.object({
  reason: z.string().trim().min(10, "Provide a reason of at least 10 characters").max(1000),
  idempotencyKey: optionalKey,
});
const keyOnlySchema = z.object({ idempotencyKey: optionalKey });

export async function approveFinancingRequest(actor: Actor, requestId: string, raw: { note?: string; idempotencyKey?: string }) {
  const { note, idempotencyKey } = noteSchema.parse(raw);
  const request = await loadRequestForFinancier(actor, requestId);
  await assertStepUp(actor, "financing.approve");
  await runIdempotent(
    { actor, scope: "request.approve", key: idempotencyKey, payload: { requestId: request.id, note: note || null } },
    async (claim) => {
      if (request.status !== "PENDING_APPROVAL") throw conflict("Only requests pending approval can be approved.");
      const now = new Date();
      await db.$transaction(async (tx) => {
        await moveRequest(tx, request.id, "PENDING_APPROVAL", "APPROVED", { decidedById: actor.userId, decidedAt: now, decisionNote: note || null });
        await moveInvoiceFinancing(tx, request.invoiceId, "PENDING_APPROVAL", "APPROVED");
        await addEvent(tx, request.id, "PENDING_APPROVAL", "APPROVED", actor, note || "Approved for disbursement");
        await recordAudit(tx, actor, {
          action: "financing.approved",
          entityType: "FinancingRequest",
          entityId: request.id,
          summary: `Approved financing request ${request.reference} (${formatINR(request.netPayablePaise)})`,
          metadata: { note },
        });
        await claim(tx, request.id);
      });
    },
    async () => undefined,
  );
}

export async function rejectFinancingRequest(actor: Actor, requestId: string, raw: { reason: string; idempotencyKey?: string }) {
  const { reason, idempotencyKey } = reasonSchema.parse(raw);
  const request = await loadRequestForFinancier(actor, requestId);
  await assertStepUp(actor, "financing.reject");
  await runIdempotent(
    { actor, scope: "request.reject", key: idempotencyKey, payload: { requestId: request.id, reason } },
    async (claim) => {
      if (request.status !== "PENDING_APPROVAL") throw conflict("Only requests pending approval can be rejected.");
      const now = new Date();
      await db.$transaction(async (tx) => {
        await moveRequest(tx, request.id, "PENDING_APPROVAL", "REJECTED", { decidedById: actor.userId, decidedAt: now, decisionNote: reason });
        await moveInvoiceFinancing(tx, request.invoiceId, "PENDING_APPROVAL", "REJECTED");
        await addEvent(tx, request.id, "PENDING_APPROVAL", "REJECTED", actor, reason);
        await recordAudit(tx, actor, {
          action: "financing.rejected",
          entityType: "FinancingRequest",
          entityId: request.id,
          summary: `Rejected financing request ${request.reference}`,
          metadata: { reason },
        });
        await claim(tx, request.id);
      });
    },
    async () => undefined,
  );
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

/** Payout step 1: books the disbursement instruction for the request's net payable. */
export async function initiateDisbursement(actor: Actor, requestId: string, raw: { idempotencyKey?: string } = {}) {
  const { idempotencyKey } = keyOnlySchema.parse(raw);
  const request = await loadRequestForFinancier(actor, requestId);
  await assertStepUp(actor, "disbursement.initiate");
  return runIdempotent(
    { actor, scope: "disbursement.initiate", key: idempotencyKey, payload: { requestId: request.id } },
    async (claim) => {
      if (request.status !== "APPROVED") throw conflict("Only approved requests can be disbursed.");
      // KYC payout gate: no release to an unverified account or during the payout-account cooling-off.
      await assertCpEligibleForPayout(request.cpId, new Date(), { audience: "financier" });
      const now = new Date();
      return db.$transaction(async (tx) => {
        await moveRequest(tx, request.id, "APPROVED", "DISBURSEMENT_INITIATED");
        await moveInvoiceFinancing(tx, request.invoiceId, "APPROVED", "DISBURSEMENT_INITIATED");
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
        await addEvent(tx, request.id, "APPROVED", "DISBURSEMENT_INITIATED", actor, `Payout ${reference} initiated`);
        await recordAudit(tx, actor, {
          action: "disbursement.initiated",
          entityType: "Disbursement",
          entityId: disbursement.id,
          summary: `Initiated disbursement ${reference} of ${formatINR(request.netPayablePaise)} to ${request.cp.name}`,
          metadata: { requestId: request.id, simulated: true },
        });
        await claim(tx, disbursement.id);
        return disbursement;
      });
    },
    async (disbursementId) => db.disbursement.findUniqueOrThrow({ where: { id: disbursementId ?? "" } }),
  );
}

/**
 * Settlement due date the request was priced on. Requests accepted under the pricing engine carry it in
 * their snapshot and it is never recomputed, so later edits to the invoice due date, the programme's
 * holiday rule or the holiday calendar cannot move a date the partner and financier agreed to. Only
 * legacy requests (no snapshot) derive it from the invoice and programme.
 */
export async function agreedSettlementDueDate(
  request: Pick<Prisma.FinancingRequestGetPayload<object>, "pricedDueDate"> & {
    invoice: Pick<Invoice, "dueDate" | "invoiceDate" | "cpId" | "builderId">;
    programme: { holidayRule: ApplicableProgramme["holidayRule"] };
  },
): Promise<CalendarDate> {
  if (request.pricedDueDate) return toCalendarDate(request.pricedDueDate);
  return settlementDueDate(await invoiceDueDate(request.invoice), request.programme.holidayRule);
}

/**
 * Payout step 2: confirms the bank acknowledgement and opens the builder settlement for the financed
 * amount from the acceptance snapshot, due on the agreed settlement date.
 */
export async function completeDisbursement(actor: Actor, requestId: string, raw: { idempotencyKey?: string } = {}) {
  const { idempotencyKey } = keyOnlySchema.parse(raw);
  const request = await loadRequestForFinancier(actor, requestId);
  await assertStepUp(actor, "disbursement.complete");
  await runIdempotent(
    { actor, scope: "disbursement.complete", key: idempotencyKey, payload: { requestId: request.id } },
    async (claim) => {
      if (request.status !== "DISBURSEMENT_INITIATED") throw conflict("No disbursement is in progress for this request.");
      const now = new Date();
      const due = await agreedSettlementDueDate(request);
      const dueDate = toStorageDate(due);
      const utr = `DEMOUTR${now.getUTCFullYear()}${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;

      await db.$transaction(async (tx) => {
        const done = await tx.disbursement.updateMany({
          where: { requestId: request.id, status: "INITIATED" },
          data: { status: "SUCCESS", utr, completedById: actor.userId, completedAt: now },
        });
        if (done.count !== 1) throw conflict("This disbursement has already been completed.");
        await moveRequest(tx, request.id, "DISBURSEMENT_INITIATED", "DISBURSED");
        await moveInvoiceFinancing(tx, request.invoiceId, "DISBURSEMENT_INITIATED", "DISBURSED");
        const settlement = await tx.settlement.create({
          data: {
            requestId: request.id,
            builderId: request.builderId,
            financierId: request.financierId,
            amountPaise: request.financedAmountPaise,
            dueDate,
            status: settlementStatusFor(dueDate, now),
          },
        });
        await addEvent(tx, request.id, "DISBURSEMENT_INITIATED", "DISBURSED", actor, `Transfer confirmed (UTR ${utr})`);
        await recordAudit(tx, actor, {
          action: "disbursement.completed",
          entityType: "Disbursement",
          entityId: request.id,
          summary: `Disbursement for ${request.reference} completed; builder settlement of ${formatINR(settlement.amountPaise)} due ${due}`,
          metadata: { utr, settlementId: settlement.id, simulated: true },
        });
        await claim(tx, settlement.id);
      });
    },
    async () => undefined,
  );
}

const settleSchema = z.object({
  reference: z.string().trim().min(4, "Enter the settlement reference").max(60),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: optionalKey,
});

/** Records that the builder has paid the financier. Performed by the financier's operations user. */
export async function markSettlementSettled(actor: Actor, requestId: string, raw: { reference: string; note?: string; idempotencyKey?: string }) {
  const input = settleSchema.parse(raw);
  const request = await loadRequestForFinancier(actor, requestId);
  await assertStepUp(actor, "settlement.settle");
  await runIdempotent(
    { actor, scope: "settlement.settle", key: input.idempotencyKey, payload: { requestId: request.id, reference: input.reference, note: input.note || null } },
    async (claim) => {
      const settlement = await db.settlement.findUnique({ where: { requestId: request.id } });
      if (!settlement) throw conflict("No settlement exists for this request yet.");
      if (settlement.status === "SETTLED") throw conflict("This settlement is already marked as settled.");
      assertTransition("settlement", settlement.status, "SETTLED");
      const now = new Date();
      await db.$transaction(async (tx) => {
        const updated = await tx.settlement.updateMany({
          where: { id: settlement.id, status: { in: sourcesFor("settlement", "SETTLED") } },
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
        await claim(tx, settlement.id);
      });
    },
    async () => undefined,
  );
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
        { reference: { contains: q, mode: "insensitive" } },
        { invoice: { invoiceNumber: { contains: q, mode: "insensitive" } } },
        { cp: { name: { contains: q, mode: "insensitive" } } },
        { builder: { name: { contains: q, mode: "insensitive" } } },
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
