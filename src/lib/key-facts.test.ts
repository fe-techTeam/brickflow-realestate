import { describe, expect, it } from "vitest";
import { consentTextFor, CONSENT_TEXT, describeRate, keyFactsAsOf, type StoredPricing } from "./key-facts";

const stored: StoredPricing = {
  pricingMode: "FLAT_PERCENT",
  discountRateBps: 300,
  financedAmountPaise: 5_00_000_00n,
  tdsPaise: 0n,
  discountAmountPaise: 15_000_00n,
  chargesPaise: 0n,
  netPayablePaise: 4_85_000_00n,
  settlementDueDate: "2027-01-20",
};

describe("keyFactsAsOf", () => {
  it("derives days and the annualised rate for the viewing day", () => {
    expect(keyFactsAsOf(stored, "2026-11-06")).toMatchObject({ tenorDays: 75, annualisedRateBps: 1505, settlementAmountPaise: 5_00_000_00n });
    expect(keyFactsAsOf(stored, "2026-12-21")).toMatchObject({ tenorDays: 30, annualisedRateBps: 3763 });
  });

  it("returns nothing for legacy offers or past settlement dates", () => {
    expect(keyFactsAsOf({ ...stored, settlementDueDate: null }, "2026-11-06")).toBeNull();
    expect(keyFactsAsOf(stored, "2027-01-20")).toBeNull();
  });
});

describe("consentTextFor", () => {
  it("appends the key facts to the consent statement", () => {
    expect(consentTextFor(keyFactsAsOf(stored, "2026-11-06"))).toBe(
      `${CONSENT_TEXT} Key facts: I receive ₹4,85,000.00 now; the builder settles ₹5,00,000.00 on 20 Jan 2027, 75 days away; ` +
        "the discount of ₹15,000.00 (3% flat) and charges of ₹0.00 are equivalent to an annualised rate of 15.05% (ACT/365).",
    );
  });

  it("mentions TDS and annual pricing when they apply", () => {
    const text = consentTextFor(
      keyFactsAsOf({ ...stored, pricingMode: "ANNUAL_RATE", discountRateBps: 1200, tdsPaise: 8_474_58n, financedAmountPaise: 4_91_525_42n, discountAmountPaise: 9_695_88n, netPayablePaise: 4_81_829_54n }, "2026-11-21"),
    );
    expect(text).toContain("the builder settles ₹4,91,525.42 after TDS of ₹8,474.58 deducted by the builder on 20 Jan 2027, 60 days away");
    expect(text).toContain("(12% a year)");
  });

  it("falls back to the plain statement without key facts", () => {
    expect(consentTextFor(null)).toBe(CONSENT_TEXT);
  });

  it("describes both pricing modes", () => {
    expect(describeRate("FLAT_PERCENT", 275)).toBe("2.75% flat");
    expect(describeRate("ANNUAL_RATE", 1050)).toBe("10.5% a year");
  });
});
