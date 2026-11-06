import { describe, expect, it } from "vitest";
import { addDays } from "./calendar";
import { calculateDiscount } from "./financing";
import {
  annualisedRateBps,
  DEFAULT_PRICING_TERMS,
  divideRoundHalfUp,
  figuresOfQuote,
  priceEarlyPayment,
  pricedFiguresKey,
  PRICING_RULE_VERSION,
  pricingTermsIssues,
  serialiseQuote,
  type PricingMode,
  type PricingTerms,
} from "./pricing";

const VALUE_DATE = "2026-11-06";

interface Case {
  total: bigint;
  mode: PricingMode;
  rate: number;
  days: number;
  tds: boolean;
  tdsBps: number;
  gstBps: number;
  minDiscount: bigint;
  feeFlat: bigint;
  feeBps: number;
  feeGstBps: number;
}

interface Expected {
  taxable: bigint;
  tds: bigint;
  financed: bigint;
  computed: bigint;
  discount: bigint;
  fee: bigint;
  feeGst: bigint;
  charges: bigint;
  net: bigint;
  annualised: number;
}

function termsOf(c: Case): PricingTerms {
  return {
    pricingMode: c.mode,
    discountRateBps: c.rate,
    minTenorDays: 1,
    maxTenorDays: null,
    minDiscountPaise: c.minDiscount,
    tdsDeducted: c.tds,
    tdsRateBps: c.tdsBps,
    invoiceGstRateBps: c.gstBps,
    processingFeeFlatPaise: c.feeFlat,
    processingFeeBps: c.feeBps,
    feeGstRateBps: c.feeGstBps,
  };
}

/**
 * Golden table. Expected figures were computed independently with decimal arithmetic and
 * ROUND_HALF_UP at each step (taxable value, TDS, discount, fee, GST on fee, annualised rate).
 */
const GOLDEN: [string, Case, Expected][] = [
  ["flat 3% on 5,00,000, 75 days", { total: 50000000n, mode: "FLAT_PERCENT", rate: 300, days: 75, tds: false, tdsBps: 200, gstBps: 1800, minDiscount: 0n, feeFlat: 0n, feeBps: 0, feeGstBps: 1800 }, { taxable: 42372881n, tds: 0n, financed: 50000000n, computed: 1500000n, discount: 1500000n, fee: 0n, feeGst: 0n, charges: 0n, net: 48500000n, annualised: 1505 }],
  ["flat 3% with TDS 2% at GST 18%", { total: 50000000n, mode: "FLAT_PERCENT", rate: 300, days: 75, tds: true, tdsBps: 200, gstBps: 1800, minDiscount: 0n, feeFlat: 0n, feeBps: 0, feeGstBps: 1800 }, { taxable: 42372881n, tds: 847458n, financed: 49152542n, computed: 1474576n, discount: 1474576n, fee: 0n, feeGst: 0n, charges: 0n, net: 47677966n, annualised: 1505 }],
  ["annual 12% on 5,00,000, 60 days", { total: 50000000n, mode: "ANNUAL_RATE", rate: 1200, days: 60, tds: false, tdsBps: 200, gstBps: 1800, minDiscount: 0n, feeFlat: 0n, feeBps: 0, feeGstBps: 1800 }, { taxable: 42372881n, tds: 0n, financed: 50000000n, computed: 986301n, discount: 986301n, fee: 0n, feeGst: 0n, charges: 0n, net: 49013699n, annualised: 1224 }],
  ["annual 12% with TDS, 60 days", { total: 50000000n, mode: "ANNUAL_RATE", rate: 1200, days: 60, tds: true, tdsBps: 200, gstBps: 1800, minDiscount: 0n, feeFlat: 0n, feeBps: 0, feeGstBps: 1800 }, { taxable: 42372881n, tds: 847458n, financed: 49152542n, computed: 969584n, discount: 969584n, fee: 0n, feeGst: 0n, charges: 0n, net: 48182958n, annualised: 1224 }],
  ["annual 10.5%, 1 day, minimum discount 500", { total: 10000000n, mode: "ANNUAL_RATE", rate: 1050, days: 1, tds: false, tdsBps: 200, gstBps: 1800, minDiscount: 50000n, feeFlat: 0n, feeBps: 0, feeGstBps: 1800 }, { taxable: 8474576n, tds: 0n, financed: 10000000n, computed: 2877n, discount: 50000n, fee: 0n, feeGst: 0n, charges: 0n, net: 9950000n, annualised: 18342 }],
  ["flat 2.5% with fee 1,000 + 0.1% and GST 18%", { total: 40000000n, mode: "FLAT_PERCENT", rate: 250, days: 45, tds: false, tdsBps: 200, gstBps: 1800, minDiscount: 0n, feeFlat: 100000n, feeBps: 10, feeGstBps: 1800 }, { taxable: 33898305n, tds: 0n, financed: 40000000n, computed: 1000000n, discount: 1000000n, fee: 140000n, feeGst: 25200n, charges: 165200n, net: 38834800n, annualised: 2434 }],
  ["annual 15%, 90 days, TDS, fee 0.25%", { total: 123456789n, mode: "ANNUAL_RATE", rate: 1500, days: 90, tds: true, tdsBps: 200, gstBps: 1800, minDiscount: 0n, feeFlat: 0n, feeBps: 25, feeGstBps: 1800 }, { taxable: 104624397n, tds: 2092488n, financed: 121364301n, computed: 4488817n, discount: 4488817n, fee: 303411n, feeGst: 54614n, charges: 358025n, net: 116517459n, annualised: 1687 }],
  ["annual exact half paisa rounds up", { total: 1825n, mode: "ANNUAL_RATE", rate: 1000, days: 1, tds: false, tdsBps: 200, gstBps: 1800, minDiscount: 0n, feeFlat: 0n, feeBps: 0, feeGstBps: 1800 }, { taxable: 1547n, tds: 0n, financed: 1825n, computed: 1n, discount: 1n, fee: 0n, feeGst: 0n, charges: 0n, net: 1824n, annualised: 2001 }],
  ["flat 3.5% on 1,234.57", { total: 123457n, mode: "FLAT_PERCENT", rate: 350, days: 30, tds: false, tdsBps: 200, gstBps: 1800, minDiscount: 0n, feeFlat: 0n, feeBps: 0, feeGstBps: 1800 }, { taxable: 104625n, tds: 0n, financed: 123457n, computed: 4321n, discount: 4321n, fee: 0n, feeGst: 0n, charges: 0n, net: 119136n, annualised: 4413 }],
  ["TDS on GST-exempt invoice", { total: 10000000n, mode: "FLAT_PERCENT", rate: 200, days: 30, tds: true, tdsBps: 500, gstBps: 0, minDiscount: 0n, feeFlat: 0n, feeBps: 0, feeGstBps: 1800 }, { taxable: 10000000n, tds: 500000n, financed: 9500000n, computed: 190000n, discount: 190000n, fee: 0n, feeGst: 0n, charges: 0n, net: 9310000n, annualised: 2483 }],
  ["annual 9%, 365 days, TDS 10%", { total: 98765432n, mode: "ANNUAL_RATE", rate: 900, days: 365, tds: true, tdsBps: 1000, gstBps: 1800, minDiscount: 0n, feeFlat: 25000n, feeBps: 0, feeGstBps: 1800 }, { taxable: 83699519n, tds: 8369952n, financed: 90395480n, computed: 8135593n, discount: 8135593n, fee: 25000n, feeGst: 4500n, charges: 29500n, net: 82230387n, annualised: 993 }],
  ["flat 0.01% on 1 crore with every charge", { total: 1000000000n, mode: "FLAT_PERCENT", rate: 1, days: 7, tds: true, tdsBps: 200, gstBps: 1800, minDiscount: 100n, feeFlat: 999n, feeBps: 1, feeGstBps: 1200 }, { taxable: 847457627n, tds: 16949153n, financed: 983050847n, computed: 98305n, discount: 98305n, fee: 99304n, feeGst: 11916n, charges: 111220n, net: 982841322n, annualised: 111 }],
];

describe("priceEarlyPayment golden table", () => {
  it.each(GOLDEN)("%s", (_label, c, e) => {
    const result = priceEarlyPayment(termsOf(c), { invoiceTotalPaise: c.total, valueDate: VALUE_DATE, dueDate: addDays(VALUE_DATE, c.days) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote).toEqual({
      ruleVersion: PRICING_RULE_VERSION,
      pricingMode: c.mode,
      discountRateBps: c.rate,
      valueDate: VALUE_DATE,
      dueDate: addDays(VALUE_DATE, c.days),
      tenorDays: c.days,
      invoiceTotalPaise: c.total,
      taxableValuePaise: e.taxable,
      tdsRateBps: c.tds ? c.tdsBps : 0,
      tdsPaise: e.tds,
      financedAmountPaise: e.financed,
      computedDiscountPaise: e.computed,
      minDiscountPaise: c.minDiscount,
      minimumDiscountApplied: e.discount !== e.computed,
      discountAmountPaise: e.discount,
      processingFeePaise: e.fee,
      feeGstRateBps: c.feeGstBps,
      feeGstPaise: e.feeGst,
      chargesPaise: e.charges,
      netPayablePaise: e.net,
      settlementAmountPaise: e.financed,
      annualisedRateBps: e.annualised,
    });
  });

  it.each(GOLDEN)("%s: the parts add up", (_label, c) => {
    const result = priceEarlyPayment(termsOf(c), { invoiceTotalPaise: c.total, valueDate: VALUE_DATE, dueDate: addDays(VALUE_DATE, c.days) });
    if (!result.ok) throw new Error(result.message);
    const q = result.quote;
    expect(q.invoiceTotalPaise - q.tdsPaise).toBe(q.financedAmountPaise);
    expect(q.discountAmountPaise + q.chargesPaise + q.netPayablePaise).toBe(q.financedAmountPaise);
    expect(q.processingFeePaise + q.feeGstPaise).toBe(q.chargesPaise);
    expect(q.settlementAmountPaise).toBe(q.financedAmountPaise);
  });
});

describe("backward compatibility", () => {
  it("prices FLAT_PERCENT with default terms exactly like calculateDiscount", () => {
    for (const amount of [1n, 99n, 150n, 1_00_001n, 1_234_57n, 3_33_333_33n, 5_00_000_00n, 98_76_543_21n]) {
      for (const bps of [1, 250, 275, 300, 350, 1_234, 3_000]) {
        const legacy = (() => {
          try {
            return calculateDiscount(amount, bps);
          } catch {
            return null;
          }
        })();
        const result = priceEarlyPayment({ ...DEFAULT_PRICING_TERMS, discountRateBps: bps }, { invoiceTotalPaise: amount, valueDate: VALUE_DATE, dueDate: addDays(VALUE_DATE, 60) });
        if (!legacy) {
          expect(result.ok).toBe(false);
          continue;
        }
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        expect(result.quote.discountAmountPaise).toBe(legacy.discountAmountPaise);
        expect(result.quote.netPayablePaise).toBe(legacy.netPayablePaise);
        expect(result.quote.chargesPaise).toBe(0n);
        expect(result.quote.tdsPaise).toBe(0n);
        expect(result.quote.financedAmountPaise).toBe(amount);
      }
    }
  });

  it("does not depend on tenor in flat mode", () => {
    const terms = { ...DEFAULT_PRICING_TERMS, discountRateBps: 300 };
    const short = priceEarlyPayment(terms, { invoiceTotalPaise: 5_00_000_00n, valueDate: VALUE_DATE, dueDate: addDays(VALUE_DATE, 1) });
    const long = priceEarlyPayment(terms, { invoiceTotalPaise: 5_00_000_00n, valueDate: VALUE_DATE, dueDate: addDays(VALUE_DATE, 365) });
    if (!short.ok || !long.ok) throw new Error("expected quotes");
    expect(short.quote.netPayablePaise).toBe(long.quote.netPayablePaise);
    expect(short.quote.annualisedRateBps).toBeGreaterThan(long.quote.annualisedRateBps);
  });
});

describe("tenor limits and rejections", () => {
  const base: PricingTerms = { ...DEFAULT_PRICING_TERMS, discountRateBps: 1200, pricingMode: "ANNUAL_RATE", minTenorDays: 7, maxTenorDays: 180 };
  const quote = (days: number, terms: PricingTerms = base, total = 5_00_000_00n) =>
    priceEarlyPayment(terms, { invoiceTotalPaise: total, valueDate: VALUE_DATE, dueDate: addDays(VALUE_DATE, days) });

  it.each([
    [-3, "DUE_DATE_NOT_IN_FUTURE"],
    [0, "DUE_DATE_NOT_IN_FUTURE"],
    [6, "TENOR_TOO_SHORT"],
    [181, "TENOR_TOO_LONG"],
  ] as const)("refuses a tenor of %i days with %s", (days, code) => {
    const result = quote(days);
    expect(result).toMatchObject({ ok: false, code, tenorDays: days });
  });

  it.each([7, 180])("accepts the boundary tenor of %i days", (days) => {
    expect(quote(days)).toMatchObject({ ok: true, quote: { tenorDays: days } });
  });

  it("explains a short tenor in plain words", () => {
    const result = quote(6);
    expect(!result.ok && result.message).toBe("The invoice is due in 6 days; this programme finances invoices due in at least 7 days.");
  });

  it("refuses when the discount and charges consume the invoice", () => {
    expect(quote(30, { ...base, minDiscountPaise: 10_000n }, 10_000n)).toMatchObject({ ok: false, code: "NET_NOT_POSITIVE" });
    expect(quote(30, { ...base, processingFeeFlatPaise: 9_000n }, 10_000n)).toMatchObject({ ok: false, code: "NET_NOT_POSITIVE" });
  });

  it("applies the minimum discount only when the computed discount is lower", () => {
    const floor = { ...base, minDiscountPaise: 5_000_00n };
    const low = quote(7, floor);
    const high = quote(180, floor);
    if (!low.ok || !high.ok) throw new Error("expected quotes");
    expect(low.quote).toMatchObject({ minimumDiscountApplied: true, discountAmountPaise: 5_000_00n });
    expect(high.quote.minimumDiscountApplied).toBe(false);
    expect(high.quote.discountAmountPaise).toBe(high.quote.computedDiscountPaise);
  });
});

describe("invalid terms", () => {
  const valid: PricingTerms = { ...DEFAULT_PRICING_TERMS, discountRateBps: 300 };

  it.each<[string, Partial<PricingTerms>, keyof PricingTerms]>([
    ["a zero rate", { discountRateBps: 0 }, "discountRateBps"],
    ["a rate above 30%", { discountRateBps: 3001 }, "discountRateBps"],
    ["a fractional rate", { discountRateBps: 2.5 }, "discountRateBps"],
    ["a zero minimum tenor", { minTenorDays: 0 }, "minTenorDays"],
    ["a maximum below the minimum", { minTenorDays: 30, maxTenorDays: 10 }, "maxTenorDays"],
    ["a maximum above a year", { maxTenorDays: 366 }, "maxTenorDays"],
    ["a negative minimum discount", { minDiscountPaise: -1n }, "minDiscountPaise"],
    ["TDS without a rate", { tdsDeducted: true, tdsRateBps: 0 }, "tdsRateBps"],
    ["a TDS rate above 20%", { tdsRateBps: 2001 }, "tdsRateBps"],
    ["a GST rate above 28%", { invoiceGstRateBps: 2801 }, "invoiceGstRateBps"],
    ["a negative processing fee", { processingFeeFlatPaise: -100n }, "processingFeeFlatPaise"],
    ["a processing fee above 5%", { processingFeeBps: 501 }, "processingFeeBps"],
    ["a negative GST on fees", { feeGstRateBps: -1 }, "feeGstRateBps"],
  ])("reports %s", (_label, override, field) => {
    const terms = { ...valid, ...override };
    expect(pricingTermsIssues(terms).map((i) => i.field)).toContain(field);
    expect(() => priceEarlyPayment(terms, { invoiceTotalPaise: 1_000_00n, valueDate: VALUE_DATE, dueDate: addDays(VALUE_DATE, 30) })).toThrow(RangeError);
  });

  it("accepts the defaults", () => {
    expect(pricingTermsIssues(valid)).toEqual([]);
  });

  it("refuses a non-positive invoice amount", () => {
    expect(() => priceEarlyPayment(valid, { invoiceTotalPaise: 0n, valueDate: VALUE_DATE, dueDate: addDays(VALUE_DATE, 30) })).toThrow(RangeError);
  });
});

describe("arithmetic helpers", () => {
  it.each([
    [0n, 1n, 0n],
    [4n, 10n, 0n],
    [5n, 10n, 1n],
    [15n, 10n, 2n],
    [14n, 10n, 1n],
    [25n, 10n, 3n],
    [1n, 3n, 0n],
    [2n, 3n, 1n],
  ])("divideRoundHalfUp(%s, %s) = %s", (n, d, expected) => {
    expect(divideRoundHalfUp(n, d)).toBe(expected);
  });

  it("refuses negative numerators and non-positive denominators", () => {
    expect(() => divideRoundHalfUp(-1n, 10n)).toThrow(RangeError);
    expect(() => divideRoundHalfUp(1n, 0n)).toThrow(RangeError);
  });

  it.each([
    [15_000_00n, 4_85_000_00n, 75, 1505],
    [15_000_00n, 4_85_000_00n, 30, 3763],
    [0n, 1_00_000_00n, 30, 0],
  ])("annualisedRateBps(%s, %s, %i) = %i", (cost, net, days, bps) => {
    expect(annualisedRateBps(cost, net, days)).toBe(bps);
  });

  it("refuses an annualised rate without days or a positive net", () => {
    expect(() => annualisedRateBps(1n, 100n, 0)).toThrow(RangeError);
    expect(() => annualisedRateBps(1n, 0n, 30)).toThrow(RangeError);
  });

  it("identifies commercial figures independently of the day they are viewed", () => {
    const terms = { ...DEFAULT_PRICING_TERMS, discountRateBps: 300 };
    const today = priceEarlyPayment(terms, { invoiceTotalPaise: 5_00_000_00n, valueDate: VALUE_DATE, dueDate: "2027-01-20" });
    const tomorrow = priceEarlyPayment(terms, { invoiceTotalPaise: 5_00_000_00n, valueDate: addDays(VALUE_DATE, 1), dueDate: "2027-01-20" });
    const moved = priceEarlyPayment(terms, { invoiceTotalPaise: 5_00_000_00n, valueDate: VALUE_DATE, dueDate: "2027-01-21" });
    if (!today.ok || !tomorrow.ok || !moved.ok) throw new Error("expected quotes");
    expect(pricedFiguresKey(figuresOfQuote(today.quote))).toBe(pricedFiguresKey(figuresOfQuote(tomorrow.quote)));
    expect(pricedFiguresKey(figuresOfQuote(today.quote))).not.toBe(pricedFiguresKey(figuresOfQuote(moved.quote)));
  });

  it("serialises bigint amounts as decimal strings", () => {
    const result = priceEarlyPayment({ ...DEFAULT_PRICING_TERMS, discountRateBps: 300 }, { invoiceTotalPaise: 5_00_000_00n, valueDate: VALUE_DATE, dueDate: "2027-01-20" });
    if (!result.ok) throw new Error(result.message);
    const json = serialiseQuote(result.quote);
    expect(json).toMatchObject({ netPayablePaise: "48500000", tenorDays: 75, annualisedRateBps: 1505 });
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});
