import { beforeAll, describe, expect, it } from "vitest";
import { addDays, endOfIstDay, istToday } from "@/lib/calendar";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import {
  acceptOffer,
  addInternalComment,
  approveFinancingRequest,
  completeDisbursement,
  CONSENT_TEXT,
  effectiveSettlementStatus,
  generateOffer,
  getFinancingRequestDetail,
  getOfferForActor,
  initiateDisbursement,
  listFinancingRequests,
  listOpenOffers,
  markSettlementSettled,
  rejectFinancingRequest,
  settlementStatusFor,
} from "@/server/services/financing";
import { approveInvoice, getInvoiceDetail, listInvoices } from "@/server/services/invoices";
import { acceptedInvoice, actors, auditActions, expectDomainError, expectValidationError, isoDate, submitTestInvoice, utcDate, type DemoUser } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

let as: Record<DemoUser, Actor>;

beforeAll(async () => {
  as = await actors();
});

describe("end-to-end financing of a ₹5,00,000 invoice at 3%", () => {
  let invoiceId: string;
  let offerId: string;
  let requestId: string;
  const dueDate = isoDate(75);

  it("refuses an offer before the builder accepts the invoice", async () => {
    const invoice = await submitTestInvoice(as.prestige, { amount: "500000", dueDate });
    invoiceId = invoice.id;
    await expectDomainError(generateOffer(as.prestige, invoiceId), "CONFLICT", /accepted by the builder first/);
  });

  it("generates an offer once the invoice is accepted, priced on the server", async () => {
    await approveInvoice(as.godrej, invoiceId, { comment: "Verified." });
    const offer = await generateOffer(as.prestige, invoiceId);
    offerId = offer.id;

    expect(offer.reference).toMatch(/^BF-OFR-\d{4}-\d{6}$/);
    expect(offer).toMatchObject({
      status: "OFFERED",
      invoiceAmountPaise: 5_00_000_00n,
      approvedAmountPaise: 5_00_000_00n,
      discountRateBps: 300,
      discountAmountPaise: 15_000_00n,
      chargesPaise: 0n,
      netPayablePaise: 4_85_000_00n,
    });
    expect(typeof offer.discountAmountPaise).toBe("bigint");
    // Valid through the end of the IST day seven days after generation.
    expect(offer.validUntil).toEqual(endOfIstDay(addDays(istToday(offer.generatedAt), 7)));
    expect(JSON.parse(offer.termsSnapshot)).toMatchObject({ programmeCode: "BF-PRG-0001", discountRateBps: 300, offerValidityDays: 7 });

    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.financingStatus).toBe("OFFER_GENERATED");
    expect(await auditActions(offerId)).toEqual(["financing.offer_generated"]);
  });

  it("returns the same open offer when requested again", async () => {
    const again = await generateOffer(as.prestige, invoiceId);
    expect(again.id).toBe(offerId);
    expect(await db.financingOffer.count({ where: { invoiceId } })).toBe(1);
    expect((await listOpenOffers(as.prestige)).find((o) => o.id === offerId)).toMatchObject({ status: "OFFERED" });
  });

  it("requires explicit consent to accept", async () => {
    await expectValidationError(acceptOffer(as.prestige, offerId, { consent: false }), "consent");
    expect((await db.financingOffer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe("OFFERED");
  });

  it("creates a financing request with a snapshot of the offer when the partner accepts", async () => {
    const request = await acceptOffer(as.prestige, offerId, { consent: true });
    requestId = request.id;

    expect(request.reference).toMatch(/^BF-FIN-\d{4}-\d{6}$/);
    expect(request).toMatchObject({
      status: "PENDING_APPROVAL",
      invoiceId,
      offerId,
      cpId: as.prestige.orgId,
      builderId: as.godrej.orgId,
      financierId: as.finance.orgId,
      approvedAmountPaise: 5_00_000_00n,
      discountRateBps: 300,
      discountAmountPaise: 15_000_00n,
      chargesPaise: 0n,
      netPayablePaise: 4_85_000_00n,
      acceptedById: as.prestige.userId,
    });
    const persisted = await db.financingRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(persisted.approvedAmountPaise - persisted.discountAmountPaise - persisted.chargesPaise).toBe(persisted.netPayablePaise);

    const offer = await db.financingOffer.findUniqueOrThrow({ where: { id: offerId } });
    // The stored consent is the standard statement followed by the key facts the partner saw.
    expect(offer).toMatchObject({ status: "ACCEPTED", acceptedById: as.prestige.userId });
    expect(offer.consentText).toContain(CONSENT_TEXT);
    expect(offer.consentText).toContain("I receive ₹4,85,000.00 now");
    expect(offer.consentText).toMatch(/annualised rate of [\d.]+% \(ACT\/365\)/);

    const invoice = await getInvoiceDetail(as.prestige, invoiceId);
    expect(invoice.financingStatus).toBe("PENDING_APPROVAL");
    expect(invoice.financingRequest!.events.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      [null, "ACCEPTED_BY_CP"],
      ["ACCEPTED_BY_CP", "PENDING_APPROVAL"],
    ]);
    expect(await auditActions(requestId)).toEqual(["financing.offer_accepted"]);
  });

  it("prevents duplicate financing of the same invoice", async () => {
    await expectDomainError(acceptOffer(as.prestige, offerId, { consent: true }), "CONFLICT", /already been accepted/);
    await expectDomainError(generateOffer(as.prestige, invoiceId), "CONFLICT", /already been requested/);
    expect(await db.financingRequest.count({ where: { invoiceId } })).toBe(1);
  });

  it("shows the request to the builder without internal comments", async () => {
    const list = await listFinancingRequests(as.godrej);
    expect(list.map((r) => r.id)).toContain(requestId);
    expect(list.every((r) => r.builderId === as.godrej.orgId)).toBe(true);

    const detail = await getFinancingRequestDetail(as.godrej, requestId);
    expect(detail).toMatchObject({ status: "PENDING_APPROVAL", netPayablePaise: 4_85_000_00n, discountRateBps: 300 });
    expect(detail.invoice.id).toBe(invoiceId);
    expect(detail.comments).toBeUndefined();
  });

  it("lets Veefin add internal comments that only the financier and platform see", async () => {
    await addInternalComment(as.analyst, requestId, { body: "KYC verified; within programme limits." });
    expect((await getFinancingRequestDetail(as.finance, requestId)).comments).toHaveLength(1);
    expect((await getFinancingRequestDetail(as.admin, requestId)).comments).toHaveLength(1);
    expect((await getFinancingRequestDetail(as.prestige, requestId)).comments).toBeUndefined();
    await expectDomainError(addInternalComment(as.prestige, requestId, { body: "Hello" }), "FORBIDDEN");
  });

  it("refuses disbursement before approval", async () => {
    await expectDomainError(initiateDisbursement(as.finance, requestId), "CONFLICT", /Only approved requests/);
  });

  it("lets Veefin approve once", async () => {
    await approveFinancingRequest(as.finance, requestId, { note: "Within programme limits." });
    const request = await db.financingRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(request).toMatchObject({ status: "APPROVED", decidedById: as.finance.userId, decisionNote: "Within programme limits." });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).financingStatus).toBe("APPROVED");

    await expectDomainError(approveFinancingRequest(as.finance, requestId, {}), "CONFLICT");
    await expectDomainError(rejectFinancingRequest(as.finance, requestId, { reason: "Too late to reject this request." }), "CONFLICT");
  });

  it("simulates the disbursement and opens the builder settlement", async () => {
    const disbursement = await initiateDisbursement(as.finance, requestId);
    expect(disbursement).toMatchObject({ status: "INITIATED", amountPaise: 4_85_000_00n, mode: "DEMO_SIMULATED", utr: null });
    expect(disbursement.reference).toMatch(/^BFPAY-DEMO-\d{4}-\d{6}$/);
    expect(disbursement.beneficiaryAccount).toMatch(/^XXXX\d{4}$/);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).financingStatus).toBe("DISBURSEMENT_INITIATED");
    await expectDomainError(initiateDisbursement(as.finance, requestId), "CONFLICT");

    await completeDisbursement(as.finance, requestId);
    await expectDomainError(completeDisbursement(as.finance, requestId), "CONFLICT");

    const detail = await getFinancingRequestDetail(as.finance, requestId);
    expect(detail.status).toBe("DISBURSED");
    expect(detail.disbursement).toMatchObject({ status: "SUCCESS", reference: disbursement.reference, completedById: as.finance.userId });
    expect(detail.disbursement!.utr).toMatch(/^DEMOUTR\d{4}\d{9}$/);
    expect(detail.settlement).toMatchObject({
      amountPaise: 5_00_000_00n,
      builderId: as.godrej.orgId,
      financierId: as.finance.orgId,
      status: "NOT_DUE",
      settledAt: null,
    });
    expect(detail.settlement!.dueDate.toISOString()).toBe(utcDate(dueDate).toISOString());
    expect(detail.events.map((e) => e.toStatus)).toEqual(["ACCEPTED_BY_CP", "PENDING_APPROVAL", "APPROVED", "DISBURSEMENT_INITIATED", "DISBURSED"]);

    const invoice = await getInvoiceDetail(as.prestige, invoiceId);
    expect(invoice).toMatchObject({ status: "ACCEPTED", financingStatus: "DISBURSED" });
    expect(invoice.financingRequest!.disbursement!.utr).toBe(detail.disbursement!.utr);
  });

  it("records the builder's settlement", async () => {
    await expectValidationError(markSettlementSettled(as.finance, requestId, { reference: "x" }), "reference");
    await expectDomainError(markSettlementSettled(as.godrej, requestId, { reference: "NEFT-TEST-0001" }), "FORBIDDEN");

    await markSettlementSettled(as.finance, requestId, { reference: "NEFT-TEST-0001", note: "Received on the due date." });
    const settlement = await db.settlement.findUniqueOrThrow({ where: { requestId } });
    expect(settlement).toMatchObject({ status: "SETTLED", reference: "NEFT-TEST-0001", settledById: as.finance.userId });
    expect(effectiveSettlementStatus(settlement)).toBe("SETTLED");

    await expectDomainError(markSettlementSettled(as.finance, requestId, { reference: "NEFT-TEST-0002" }), "CONFLICT", /already marked as settled/);
    expect(await auditActions(settlement.id)).toEqual(["settlement.settled"]);
  });

  it("writes an audit trail for every step", async () => {
    const disbursement = await db.disbursement.findUniqueOrThrow({ where: { requestId } });
    expect(await auditActions(invoiceId)).toEqual(["invoice.submitted", "invoice.approved"]);
    expect(await auditActions(requestId)).toEqual([
      "financing.offer_accepted",
      "financing.comment_added",
      "financing.approved",
      "disbursement.completed",
    ]);
    expect(await auditActions(disbursement.id)).toEqual(["disbursement.initiated"]);
  });
});

describe("financing rules", () => {
  it("prices a partially approved invoice on the approved amount at the builder's rate", async () => {
    const invoice = await acceptedInvoice(as.prestige, as.skyline, { builder: "skyline", amount: "420000", approvedAmount: "400000" });
    const offer = await generateOffer(as.prestige, invoice.id);
    expect(offer).toMatchObject({
      invoiceAmountPaise: 4_20_000_00n,
      approvedAmountPaise: 4_00_000_00n,
      discountRateBps: 250,
      discountAmountPaise: 10_000_00n,
      netPayablePaise: 3_90_000_00n,
    });
  });

  it("prices Coastal invoices at 3.5%", async () => {
    const invoice = await acceptedInvoice(as.urbannest, as.coastal, { cp: "urbannest", builder: "coastal", amount: "500000" });
    const offer = await generateOffer(as.urbannest, invoice.id);
    expect(offer).toMatchObject({ discountRateBps: 350, discountAmountPaise: 17_500_00n, netPayablePaise: 4_82_500_00n });
  });

  it("refuses an invoice whose due date has passed", async () => {
    const invoice = await acceptedInvoice(as.prestige, as.godrej, { invoiceDate: isoDate(-40), dueDate: isoDate(-1) });
    await expectDomainError(generateOffer(as.prestige, invoice.id), "CONFLICT", /due date has passed/);
  });

  it("falls back to the empanelment credit period when the invoice has no due date", async () => {
    const invoiceDate = isoDate(-5);
    const invoice = await acceptedInvoice(as.prestige, as.skyline, { builder: "skyline", invoiceDate, dueDate: null, amount: "200000" });
    const offer = await generateOffer(as.prestige, invoice.id);
    const request = await acceptOffer(as.prestige, offer.id, { consent: true });
    await approveFinancingRequest(as.finance, request.id, {});
    await initiateDisbursement(as.finance, request.id);
    await completeDisbursement(as.finance, request.id);

    const settlement = await db.settlement.findUniqueOrThrow({ where: { requestId: request.id } });
    expect(settlement.dueDate.getTime()).toBe(utcDate(invoiceDate).getTime() + 45 * DAY_MS);
    expect(settlement.amountPaise).toBe(2_00_000_00n);
  });

  it("expires an offer past its validity", async () => {
    const invoice = await acceptedInvoice(as.prestige, as.godrej);
    const offer = await generateOffer(as.prestige, invoice.id);
    await db.financingOffer.update({ where: { id: offer.id }, data: { validUntil: new Date(Date.now() - 1000) } });

    await expectDomainError(acceptOffer(as.prestige, offer.id, { consent: true }), "CONFLICT", /expired/);
    expect((await db.financingOffer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("EXPIRED");

    const fresh = await generateOffer(as.prestige, invoice.id);
    expect(fresh.id).not.toBe(offer.id);
    expect(fresh.status).toBe("OFFERED");
  });

  it("makes a Veefin rejection final and requires a reason", async () => {
    const invoice = await acceptedInvoice(as.prestige, as.godrej);
    const offer = await generateOffer(as.prestige, invoice.id);
    const request = await acceptOffer(as.prestige, offer.id, { consent: true });

    await expectValidationError(rejectFinancingRequest(as.finance, request.id, { reason: "no" }), "reason");
    await rejectFinancingRequest(as.finance, request.id, { reason: "Exposure limit for this partner reached." });

    expect(await db.financingRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "REJECTED", decisionNote: "Exposure limit for this partner reached." });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).financingStatus).toBe("REJECTED");
    await expectDomainError(generateOffer(as.prestige, invoice.id), "CONFLICT");
    await expectDomainError(approveFinancingRequest(as.finance, request.id, {}), "CONFLICT");
    expect(await auditActions(request.id)).toEqual(["financing.offer_accepted", "financing.rejected"]);
  });

  it("lets only one of two concurrent acceptances create a request", async () => {
    const invoice = await acceptedInvoice(as.prestige, as.godrej);
    const offer = await generateOffer(as.prestige, invoice.id);
    const results = await Promise.allSettled([acceptOffer(as.prestige, offer.id, { consent: true }), acceptOffer(as.prestige, offer.id, { consent: true })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.financingRequest.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it("derives settlement status from the due date", () => {
    const now = new Date("2026-11-02T10:00:00.000Z");
    expect(settlementStatusFor(new Date("2026-11-03T00:00:00.000Z"), now)).toBe("NOT_DUE");
    expect(settlementStatusFor(new Date("2026-11-02T00:00:00.000Z"), now)).toBe("DUE");
    expect(settlementStatusFor(new Date("2026-11-01T00:00:00.000Z"), now)).toBe("OVERDUE");
    expect(effectiveSettlementStatus({ status: "NOT_DUE", dueDate: new Date("2026-10-01T00:00:00.000Z") }, now)).toBe("OVERDUE");
  });
});

describe("financing access control", () => {
  let invoiceId: string;
  let offerId: string;
  let requestId: string;

  beforeAll(async () => {
    const invoice = await acceptedInvoice(as.prestige, as.godrej);
    invoiceId = invoice.id;
    offerId = (await generateOffer(as.prestige, invoiceId)).id;
  });

  it("stops another partner from reading or acting on the invoice and offer", async () => {
    await expectDomainError(generateOffer(as.urbannest, invoiceId), "NOT_FOUND");
    await expectDomainError(acceptOffer(as.urbannest, offerId, { consent: true }), "NOT_FOUND");
    await expectDomainError(getOfferForActor(as.urbannest, offerId), "NOT_FOUND");
    await expectDomainError(getOfferForActor(as.skyline, offerId), "NOT_FOUND");
    await expect(getOfferForActor(as.godrej, offerId)).resolves.toMatchObject({ id: offerId });
    await expectDomainError(generateOffer(as.godrej, invoiceId), "FORBIDDEN");
    await expectDomainError(acceptOffer(as.finance, offerId, { consent: true }), "FORBIDDEN");

    requestId = (await acceptOffer(as.prestige, offerId, { consent: true })).id;
    await expectDomainError(getFinancingRequestDetail(as.urbannest, requestId), "NOT_FOUND");
    await expectDomainError(getFinancingRequestDetail(as.skyline, requestId), "NOT_FOUND");
    expect((await listFinancingRequests(as.urbannest)).map((r) => r.id)).not.toContain(requestId);
    expect((await listInvoices(as.urbannest)).map((i) => i.id)).not.toContain(invoiceId);
  });

  it("keeps financier actions away from partners, builders and the admin", async () => {
    for (const actor of [as.prestige, as.godrej, as.admin]) {
      await expectDomainError(approveFinancingRequest(actor, requestId, {}), "FORBIDDEN");
      await expectDomainError(rejectFinancingRequest(actor, requestId, { reason: "Not allowed to do this here." }), "FORBIDDEN");
      await expectDomainError(initiateDisbursement(actor, requestId), "FORBIDDEN");
      await expectDomainError(completeDisbursement(actor, requestId), "FORBIDDEN");
    }
    expect((await db.financingRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("PENDING_APPROVAL");
  });

  it("only lists requests within each organisation's scope", async () => {
    const [cp, builder, financier, platform] = await Promise.all([
      listFinancingRequests(as.prestige),
      listFinancingRequests(as.skyline),
      listFinancingRequests(as.finance),
      listFinancingRequests(as.admin),
    ]);
    expect(cp.every((r) => r.cpId === as.prestige.orgId)).toBe(true);
    expect(builder.every((r) => r.builderId === as.skyline.orgId)).toBe(true);
    expect(builder.map((r) => r.id)).not.toContain(requestId);
    expect(financier.map((r) => r.id)).toContain(requestId);
    expect(platform.length).toBe(await db.financingRequest.count());
  });
});
