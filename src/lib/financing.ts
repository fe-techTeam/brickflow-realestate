/**
 * Discount calculation shared by the server (authoritative) and the UI (preview only).
 *
 *   discountAmount = approvedAmount × rate / 100      (rate held as basis points → ÷ 10,000)
 *   netPayable     = approvedAmount − discountAmount
 *
 * Integer arithmetic on paise with round-half-up to the nearest paisa.
 */

export const MAX_DISCOUNT_RATE_BPS = 3000;
export const MIN_DISCOUNT_RATE_BPS = 1;

export interface DiscountBreakdown {
  approvedAmountPaise: bigint;
  discountRateBps: number;
  discountAmountPaise: bigint;
  chargesPaise: bigint;
  netPayablePaise: bigint;
}

export function calculateDiscount(
  approvedAmountPaise: bigint,
  discountRateBps: number,
  chargesPaise: bigint = 0n,
): DiscountBreakdown {
  if (approvedAmountPaise <= 0n) throw new RangeError("Approved amount must be positive");
  if (!Number.isInteger(discountRateBps) || discountRateBps < MIN_DISCOUNT_RATE_BPS || discountRateBps > MAX_DISCOUNT_RATE_BPS) {
    throw new RangeError("Discount rate is outside the permitted range");
  }
  if (chargesPaise < 0n) throw new RangeError("Charges cannot be negative");

  const numerator = approvedAmountPaise * BigInt(discountRateBps);
  const discountAmountPaise = (numerator + 5_000n) / 10_000n;
  const netPayablePaise = approvedAmountPaise - discountAmountPaise - chargesPaise;
  if (netPayablePaise <= 0n) throw new RangeError("Net payable must be positive");

  return { approvedAmountPaise, discountRateBps, discountAmountPaise, chargesPaise, netPayablePaise };
}
