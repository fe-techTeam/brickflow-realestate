import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FinancingProgramme } from "@/generated/prisma/client";
import { addDays, dayOfWeek, endOfIstDay, istToday, toCalendarDate, toStorageDate } from "@/lib/calendar";
import { priceEarlyPayment, PRICING_RULE_VERSION, LEGACY_PRICING_RULE_VERSION } from "@/lib/pricing";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import { createProgramme, updateProgramme, type UpdateProgrammeInput } from "@/server/services/admin";
import {
  acceptOffer,
  approveFinancingRequest,
  completeDisbursement,
  generateOffer,
  getEligibility,
  initiateDisbursement,
} from "@/server/services/financing";
import { programmeTerms } from "@/server/services/financing-pricing";
import { runInvariantChecks } from "@/server/services/invariants";
import { acceptedInvoice, actors, expectDomainError, expectValidationError, isoDate, type DemoUser } from "./helpers";

let as: Record<DemoUser, Actor>;
let coastal: FinancingProgramme;
let godrej: FinancingProgramme;

function inputFrom(p: FinancingProgramme, overrides: Partial<UpdateProgrammeInput> = {}): UpdateProgrammeInput {
  return {
    name: p.name,
    discountRate: String(p.discountRateBps / 100),
    status: p.status,
    effectiveFrom: p.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: p.effectiveTo?.toISOString().slice(0, 10),
    offerValidityDays: String(p.offerValidityDays),
    terms: p.terms,
    ...overrides,
  };
}

async function restore(p: FinancingProgramme) {
  const { id, createdAt, updatedAt, ...data } = p;
  void createdAt;
  void updatedAt;
  await db.financingProgramme.update({ where: { id }, data });
}

async function errorsFor(ids: string[]) {
  const report = await runInvariantChecks();
  return report.violations.filter((v) => v.severity === "error" && ids.includes(v.entityId));
}

beforeAll(async () => {
  as = await actors();
  coastal = await db.financingProgramme.findUniqueOrThrow({ where: { code: "BF-PRG-0003" } });
  godrej = await db.financingProgramme.findUniqueOrThrow({ where: { code: "BF-PRG-0001" } });
});

afterAll(async () => {
  await restore(coastal);
  await restore(godrej);
});

describe("seeded and legacy data", () => {
  it("defaults every seeded programme to flat pricing with no TDS or charges", async () => {
    const programmes = await db.financingProgramme.findMany({ where: { code: { in: ["BF-PRG-0001", "BF-PRG-0002", "BF-PRG-0003"] } } });
    for (const p of programmes) {
      expect(p).toMatchObject({
        pricingMode: "FLAT_PERCENT",
        minTenorDays: 1,
        maxTenorDays: null,
        minDiscountPaise: 0n,
        tdsDeducted: false,
        tdsRateBps: 200,
        processingFeeFlatPaise: 0n,
        processingFeeBps: 0,
        feeGstRateBps: 1800,
        holidayRule: "NONE",
      });
    }
  });

  it("records seeded requests as legacy flat quotes whose financed amount is the approved amount", async () => {
    const seeded = await db.financingRequest.findMany({ where: { pricingRuleVersion: LEGACY_PRICING_RULE_VERSION } });
    expect(seeded.length).toBeGreaterThan(0);
    for (const r of seeded) {
      expect(r.financedAmountPaise).toBe(r.approvedAmountPaise);
      expect(r.tdsPaise).toBe(0n);
      expect(r.pricingSnapshot).toBeNull();
    }
  });
});

describe("annual-rate pricing with TDS and fees", () => {
  const dueDate = isoDate(61);
  let invoiceId: string;
  let offerId: string;
  let requestId: string;

  beforeAll(async () => {
    await updateProgramme(
      as.admin,
      coastal.id,
      inputFrom(coastal, {
        pricingMode: "ANNUAL_RATE",
        discountRate: "12",
        tdsDeducted: true,
        tdsRate: "2",
        invoiceGstRate: "18",
        processingFeeFlat: "500",
        processingFeeRate: "0.1",
        feeGstRate: "18",
        minTenorDays: "7",
        maxTenorDays: "120",
      }),
    );
  });

  afterAll(async () => {
    await restore(coastal);
  });

  it("stores the full pricing breakdown on the offer", async () => {
    const invoice = await acceptedInvoice(as.urbannest, as.coastal, { cp: "urbannest", builder: "coastal", amount: "590000", dueDate });
    invoiceId = invoice.id;
    const offer = await generateOffer(as.urbannest, invoiceId);
    offerId = offer.id;

    const programme = await db.financingProgramme.findUniqueOrThrow({ where: { id: coastal.id } });
    const today = istToday();
    const expected = priceEarlyPayment(programmeTerms(programme), { invoiceTotalPaise: 5_90_000_00n, valueDate: today, dueDate });
    if (!expected.ok) throw new Error(expected.message);
    const q = expected.quote;

    expect(offer).toMatchObject({
      pricingMode: "ANNUAL_RATE",
      pricingRuleVersion: PRICING_RULE_VERSION,
      approvedAmountPaise: 5_90_000_00n,
      discountRateBps: 1200,
      tenorDays: q.tenorDays,
      tdsPaise: q.tdsPaise,
      financedAmountPaise: q.financedAmountPaise,
      discountAmountPaise: q.discountAmountPaise,
      processingFeePaise: q.processingFeePaise,
      feeGstPaise: q.feeGstPaise,
      chargesPaise: q.chargesPaise,
      netPayablePaise: q.netPayablePaise,
      annualisedRateBps: q.annualisedRateBps,
    });
    // ₹5,90,000 incl. 18% GST: taxable ₹5,00,000, TDS ₹10,000, financed ₹5,80,000; fee ₹500 + 0.1% = ₹1,080 plus 18% GST.
    expect(offer).toMatchObject({ tdsPaise: 10_000_00n, financedAmountPaise: 5_80_000_00n, processingFeePaise: 1_080_00n, feeGstPaise: 194_40n, chargesPaise: 1_274_40n });
    expect(toCalendarDate(offer.pricedDueDate!)).toBe(dueDate);
    expect(offer.pricingSnapshot).toMatchObject({
      ruleVersion: PRICING_RULE_VERSION,
      invoiceDueDate: dueDate,
      holidayRule: "NONE",
      terms: { pricingMode: "ANNUAL_RATE", tdsDeducted: true, processingFeeFlatPaise: "50000" },
      quote: { netPayablePaise: q.netPayablePaise.toString(), settlementAmountPaise: "58000000" },
    });
    // Annual-rate offers are repriced daily, so they lapse at midnight IST.
    expect(offer.validUntil).toEqual(endOfIstDay(today));
  });

  it("copies the snapshot to the request and describes it in the consent", async () => {
    const request = await acceptOffer(as.urbannest, offerId, { consent: true });
    requestId = request.id;
    const offer = await db.financingOffer.findUniqueOrThrow({ where: { id: offerId } });
    for (const field of ["approvedAmountPaise", "tdsPaise", "financedAmountPaise", "discountAmountPaise", "processingFeePaise", "feeGstPaise", "chargesPaise", "netPayablePaise"] as const) {
      expect(request[field]).toBe(offer[field]);
    }
    expect(request).toMatchObject({ pricingMode: "ANNUAL_RATE", pricingRuleVersion: PRICING_RULE_VERSION, tenorDays: offer.tenorDays });
    expect(offer.consentText).toContain("after TDS of ₹10,000.00 deducted by the builder");
    expect(offer.consentText).toContain("(12% a year)");
  });

  it("disburses the net and opens a settlement for the financed amount", async () => {
    await approveFinancingRequest(as.finance, requestId, {});
    const disbursement = await initiateDisbursement(as.finance, requestId);
    await completeDisbursement(as.finance, requestId);
    const request = await db.financingRequest.findUniqueOrThrow({ where: { id: requestId }, include: { settlement: true } });
    expect(disbursement.amountPaise).toBe(request.netPayablePaise);
    expect(request.settlement).toMatchObject({ amountPaise: 5_80_000_00n, status: "NOT_DUE" });
    expect(toCalendarDate(request.settlement!.dueDate)).toBe(dueDate);
    expect(await errorsFor([invoiceId, offerId, requestId, disbursement.id, request.settlement!.id])).toEqual([]);
  });

  it("refuses invoices outside the tenor window", async () => {
    const short = await acceptedInvoice(as.urbannest, as.coastal, { cp: "urbannest", builder: "coastal", dueDate: isoDate(4) });
    await expectDomainError(generateOffer(as.urbannest, short.id), "CONFLICT", /at least 7 days/);
    const long = await acceptedInvoice(as.urbannest, as.coastal, { cp: "urbannest", builder: "coastal", dueDate: isoDate(200) });
    await expectDomainError(generateOffer(as.urbannest, long.id), "CONFLICT", /within 120 days/);
  });

  it("withdraws an offer at acceptance when the live terms no longer produce the same figures", async () => {
    const invoice = await acceptedInvoice(as.urbannest, as.coastal, { cp: "urbannest", builder: "coastal", dueDate: isoDate(40) });
    const offer = await generateOffer(as.urbannest, invoice.id);
    await db.financingProgramme.update({ where: { id: coastal.id }, data: { processingFeeFlatPaise: 900_00n } });
    try {
      await expectDomainError(acceptOffer(as.urbannest, offer.id, { consent: true }), "CONFLICT", /terms for this builder have changed/);
      expect((await db.financingOffer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("SUPERSEDED");
      expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).financingStatus).toBe("NOT_REQUESTED");
      const fresh = await generateOffer(as.urbannest, invoice.id);
      expect(fresh.processingFeePaise).toBeGreaterThan(offer.processingFeePaise);
    } finally {
      await db.financingProgramme.update({ where: { id: coastal.id }, data: { processingFeeFlatPaise: 500_00n } });
    }
  });

  it("supersedes open offers when the admin changes any pricing term", async () => {
    const invoice = await acceptedInvoice(as.urbannest, as.coastal, { cp: "urbannest", builder: "coastal", dueDate: isoDate(45) });
    const offer = await generateOffer(as.urbannest, invoice.id);
    const current = await db.financingProgramme.findUniqueOrThrow({ where: { id: coastal.id } });
    const result = await updateProgramme(as.admin, coastal.id, inputFrom(current, { minDiscount: "2500" }));
    expect(result.openOffersWithdrawn).toBeGreaterThanOrEqual(1);
    expect(result.programme.minDiscountPaise).toBe(2_500_00n);
    expect((await db.financingOffer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("SUPERSEDED");
  });
});

describe("holiday rule", () => {
  let holidayId: string;
  let sunday: string;
  let tuesday: string;

  beforeAll(async () => {
    const seeded = new Set((await db.businessHoliday.findMany()).map((h) => toCalendarDate(h.date)));
    let candidate = addDays(istToday(), 14);
    while (dayOfWeek(candidate) !== 0 || seeded.has(addDays(candidate, 1)) || seeded.has(addDays(candidate, 2))) candidate = addDays(candidate, 1);
    sunday = candidate;
    tuesday = addDays(sunday, 2);
    holidayId = (await db.businessHoliday.create({ data: { date: toStorageDate(addDays(sunday, 1)), name: "Test bank holiday" } })).id;
    await db.financingProgramme.update({ where: { id: godrej.id }, data: { holidayRule: "NEXT_BUSINESS_DAY" } });
  });

  afterAll(async () => {
    await db.businessHoliday.delete({ where: { id: holidayId } });
    await restore(godrej);
  });

  it("prices to and settles on the next business day after a Sunday and a holiday", async () => {
    const invoice = await acceptedInvoice(as.prestige, as.godrej, { dueDate: sunday });
    const offer = await generateOffer(as.prestige, invoice.id);
    expect(toCalendarDate(offer.pricedDueDate!)).toBe(tuesday);
    expect(offer.tenorDays).toBe(Math.round((toStorageDate(tuesday).getTime() - toStorageDate(istToday()).getTime()) / 86_400_000));
    expect(offer.pricingSnapshot).toMatchObject({ invoiceDueDate: sunday, holidayRule: "NEXT_BUSINESS_DAY", quote: { dueDate: tuesday } });

    const request = await acceptOffer(as.prestige, offer.id, { consent: true });
    await approveFinancingRequest(as.finance, request.id, {});
    await initiateDisbursement(as.finance, request.id);
    await completeDisbursement(as.finance, request.id);
    const settlement = await db.settlement.findUniqueOrThrow({ where: { requestId: request.id } });
    expect(toCalendarDate(settlement.dueDate)).toBe(tuesday);
  });

  it("keeps the invoice due date when the rule is NONE", async () => {
    await db.financingProgramme.update({ where: { id: godrej.id }, data: { holidayRule: "NONE" } });
    const invoice = await acceptedInvoice(as.prestige, as.godrej, { dueDate: sunday });
    const offer = await generateOffer(as.prestige, invoice.id);
    expect(toCalendarDate(offer.pricedDueDate!)).toBe(sunday);
    await db.financingProgramme.update({ where: { id: godrej.id }, data: { holidayRule: "NEXT_BUSINESS_DAY" } });
  });
});

describe("eligibility on the IST calendar", () => {
  const base = { status: "ACCEPTED" as const, financingStatus: "NOT_REQUESTED" as const, approvedAmountPaise: 1_00_000_00n, invoiceDate: new Date("2026-10-01T00:00:00.000Z") };

  it("treats the due date as passed from IST midnight, not 05:30 IST", async () => {
    const invoice = { ...base, builderId: as.godrej.orgId, cpId: as.prestige.orgId, dueDate: new Date("2026-11-20T00:00:00.000Z") };
    const lastEvening = await getEligibility(invoice, new Date("2026-11-19T18:29:00.000Z"));
    expect(lastEvening).toMatchObject({ eligible: true });
    expect(lastEvening.quote?.result.quote.tenorDays).toBe(1);

    const justAfterMidnight = await getEligibility(invoice, new Date("2026-11-19T18:31:00.000Z"));
    expect(justAfterMidnight).toMatchObject({ eligible: false, reason: "The invoice due date has passed." });
    const beforeUtcMidnight = await getEligibility(invoice, new Date("2026-11-19T23:00:00.000Z"));
    expect(beforeUtcMidnight).toMatchObject({ eligible: false });
  });

  it("prices the tenor in IST days", async () => {
    const invoice = { ...base, builderId: as.godrej.orgId, cpId: as.prestige.orgId, dueDate: new Date("2026-12-31T00:00:00.000Z") };
    const morningIst = await getEligibility(invoice, new Date("2026-11-30T20:00:00.000Z"));
    expect(morningIst.quote?.result.quote).toMatchObject({ valueDate: "2026-12-01", tenorDays: 30 });
  });
});

describe("programme pricing administration", () => {
  const base = {
    name: "Pricing validation programme",
    discountRate: "11",
    status: "DRAFT" as const,
    effectiveFrom: "2026-04-01",
    offerValidityDays: "5",
    terms: "Annual-rate pricing on the financed amount for validation tests.",
  };

  it("creates a programme with every pricing field", async () => {
    const programme = await createProgramme(as.admin, {
      ...base,
      builderId: as.skyline.orgId,
      financierId: as.finance.orgId,
      pricingMode: "ANNUAL_RATE",
      minTenorDays: "10",
      maxTenorDays: "90",
      minDiscount: "750.50",
      tdsDeducted: true,
      tdsRate: "2",
      invoiceGstRate: "18",
      processingFeeFlat: "250",
      processingFeeRate: "0.05",
      feeGstRate: "18",
      holidayRule: "NEXT_BUSINESS_DAY",
    });
    expect(programme).toMatchObject({
      pricingMode: "ANNUAL_RATE",
      discountRateBps: 1100,
      minTenorDays: 10,
      maxTenorDays: 90,
      minDiscountPaise: 750_50n,
      tdsDeducted: true,
      tdsRateBps: 200,
      invoiceGstRateBps: 1800,
      processingFeeFlatPaise: 250_00n,
      processingFeeBps: 5,
      feeGstRateBps: 1800,
      holidayRule: "NEXT_BUSINESS_DAY",
    });

    const updated = await updateProgramme(as.admin, programme.id, inputFrom(programme));
    expect(updated.programme).toMatchObject({ pricingMode: "ANNUAL_RATE", minDiscountPaise: 750_50n, maxTenorDays: 90, tdsDeducted: true });
    const cleared = await updateProgramme(as.admin, programme.id, inputFrom(programme, { maxTenorDays: "" }));
    expect(cleared.programme.maxTenorDays).toBeNull();
  });

  it("defaults omitted fields to flat pricing on create", async () => {
    const programme = await createProgramme(as.admin, { ...base, discountRate: "2", builderId: as.skyline.orgId, financierId: as.finance.orgId });
    expect(programme).toMatchObject({ pricingMode: "FLAT_PERCENT", tdsDeducted: false, processingFeeFlatPaise: 0n, minTenorDays: 1, maxTenorDays: null, holidayRule: "NONE" });
  });

  it("rejects inconsistent pricing terms with field errors", async () => {
    const create = (overrides: Record<string, unknown>) =>
      createProgramme(as.admin, { ...base, builderId: as.skyline.orgId, financierId: as.finance.orgId, ...overrides } as Parameters<typeof createProgramme>[1]);
    const fieldError = async (overrides: Record<string, unknown>, field: string) => {
      const error = await create(overrides).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toMatchObject({ name: "DomainError", code: "VALIDATION" });
      expect(Object.keys((error as { fieldErrors: Record<string, string[]> }).fieldErrors)).toContain(field);
    };
    await fieldError({ minTenorDays: "30", maxTenorDays: "10" }, "maxTenorDays");
    await fieldError({ tdsDeducted: true, tdsRate: "0" }, "tdsRate");
    await fieldError({ processingFeeRate: "6" }, "processingFeeRate");
    await fieldError({ tdsRate: "25" }, "tdsRate");
    await expectValidationError(create({ minDiscount: "12.345" }), "minDiscount");
    await expectValidationError(create({ minTenorDays: "0" }), "minTenorDays");
    await expectValidationError(create({ pricingMode: "TIERED" }), "pricingMode");
  });
});
