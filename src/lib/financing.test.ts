import { describe, expect, it } from "vitest";
import { calculateDiscount, MAX_DISCOUNT_RATE_BPS, MIN_DISCOUNT_RATE_BPS } from "./financing";

describe("calculateDiscount", () => {
  it("prices ₹5,00,000 at 3%: discount ₹15,000, net ₹4,85,000", () => {
    expect(calculateDiscount(5_00_000_00n, 300)).toEqual({
      approvedAmountPaise: 5_00_000_00n,
      discountRateBps: 300,
      discountAmountPaise: 15_000_00n,
      chargesPaise: 0n,
      netPayablePaise: 4_85_000_00n,
    });
  });

  it("prices ₹5,00,000 at 2.5% and 3.5%", () => {
    expect(calculateDiscount(5_00_000_00n, 250)).toMatchObject({ discountAmountPaise: 12_500_00n, netPayablePaise: 4_87_500_00n });
    expect(calculateDiscount(5_00_000_00n, 350)).toMatchObject({ discountAmountPaise: 17_500_00n, netPayablePaise: 4_82_500_00n });
  });

  it("prices a partially approved amount", () => {
    expect(calculateDiscount(4_00_000_00n, 250)).toMatchObject({ discountAmountPaise: 10_000_00n, netPayablePaise: 3_90_000_00n });
  });

  it("rounds half up to the nearest paisa", () => {
    expect(calculateDiscount(50n, 100).discountAmountPaise).toBe(1n);
    expect(calculateDiscount(49n, 100).discountAmountPaise).toBe(0n);
    expect(calculateDiscount(150n, 300).discountAmountPaise).toBe(5n);
    expect(calculateDiscount(1_234_57n, 350)).toMatchObject({ discountAmountPaise: 43_21n, netPayablePaise: 1_191_36n });
    expect(calculateDiscount(1_234_57n, 250)).toMatchObject({ discountAmountPaise: 30_86n, netPayablePaise: 1_203_71n });
  });

  it("deducts charges from the net payable", () => {
    expect(calculateDiscount(5_00_000_00n, 300, 100_00n)).toMatchObject({
      discountAmountPaise: 15_000_00n,
      chargesPaise: 100_00n,
      netPayablePaise: 4_84_900_00n,
    });
  });

  it("keeps discount + net equal to the approved amount", () => {
    for (const amount of [99n, 1_00_001n, 3_33_333_33n, 98_76_543_21n]) {
      for (const bps of [MIN_DISCOUNT_RATE_BPS, 250, 300, 350, 1_234, MAX_DISCOUNT_RATE_BPS]) {
        const result = calculateDiscount(amount, bps);
        expect(result.discountAmountPaise + result.netPayablePaise).toBe(amount);
      }
    }
  });

  it("accepts the boundary rates", () => {
    expect(calculateDiscount(10_000n, MIN_DISCOUNT_RATE_BPS).discountAmountPaise).toBe(1n);
    expect(calculateDiscount(10_000n, MAX_DISCOUNT_RATE_BPS).discountAmountPaise).toBe(3_000n);
  });

  it.each([
    ["a zero amount", 0n, 300, 0n],
    ["a negative amount", -1n, 300, 0n],
    ["a zero rate", 5_00_000_00n, 0, 0n],
    ["a rate above the maximum", 5_00_000_00n, MAX_DISCOUNT_RATE_BPS + 1, 0n],
    ["a fractional rate", 5_00_000_00n, 2.5, 0n],
    ["negative charges", 5_00_000_00n, 300, -1n],
    ["a non-positive net payable", 100n, 300, 97n],
  ])("rejects %s", (_label, amount, bps, charges) => {
    expect(() => calculateDiscount(amount, bps, charges)).toThrow(RangeError);
  });
});
