/**
 * Early-payment pricing engine, shared by the server (authoritative) and the UI (preview only).
 *
 * All amounts are integer paise and all rates integer basis points. Every division rounds half-up
 * to the nearest paisa (or basis point), so the same inputs always give the same figures.
 *
 *   taxable value   = invoice total ÷ (1 + invoice GST rate)
 *   TDS             = taxable value × TDS rate                       (only when the builder deducts TDS)
 *   financed base   = invoice total − TDS                            (what the builder actually remits)
 *   discount        = base × rate                                    (FLAT_PERCENT)
 *                   = base × annual rate × days ÷ 365                (ANNUAL_RATE, ACT/365)
 *                     raised to the programme's minimum discount when lower
 *   processing fee  = flat fee + base × fee rate;  GST on fee = fee × fee GST rate
 *   charges         = processing fee + GST on fee
 *   net payable     = base − discount − charges                      (paid to the channel partner)
 *   settlement      = base                                           (paid by the builder on the due date)
 *   annualised rate = (base − net) ÷ net × 365 ÷ days                (all-in simple annual cost, ACT/365)
 */

import { daysBetween, DAYS_IN_YEAR_ACT365, type CalendarDate } from "./calendar";
import { MAX_DISCOUNT_RATE_BPS, MIN_DISCOUNT_RATE_BPS } from "./financing";

export type PricingMode = "FLAT_PERCENT" | "ANNUAL_RATE";

/** Identifies the formula set that produced a quote; stored with every offer and request. */
export const PRICING_RULE_VERSION = "pricing/2026-11";
/** Rule version recorded on offers and requests created before the pricing engine existed. */
export const LEGACY_PRICING_RULE_VERSION = "flat/2026-04";

/** One permitted range for both modes: a flat percentage or an annual rate. */
export const MIN_RATE_BPS = MIN_DISCOUNT_RATE_BPS;
export const MAX_RATE_BPS = MAX_DISCOUNT_RATE_BPS;
export const MAX_TDS_RATE_BPS = 2000;
export const MAX_GST_RATE_BPS = 2800;
export const MAX_PROCESSING_FEE_BPS = 500;
export const MAX_TENOR_DAYS = 365;
export const DEFAULT_TDS_RATE_BPS = 200;
export const DEFAULT_INVOICE_GST_RATE_BPS = 1800;
export const DEFAULT_FEE_GST_RATE_BPS = 1800;

export interface PricingTerms {
  pricingMode: PricingMode;
  /** Flat percentage of the base (FLAT_PERCENT) or annual rate (ANNUAL_RATE). */
  discountRateBps: number;
  minTenorDays: number;
  maxTenorDays: number | null;
  minDiscountPaise: bigint;
  tdsDeducted: boolean;
  tdsRateBps: number;
  invoiceGstRateBps: number;
  processingFeeFlatPaise: bigint;
  processingFeeBps: number;
  feeGstRateBps: number;
}

/** Defaults that reproduce the original flat-percentage behaviour exactly. */
export const DEFAULT_PRICING_TERMS: Omit<PricingTerms, "discountRateBps"> = {
  pricingMode: "FLAT_PERCENT",
  minTenorDays: 1,
  maxTenorDays: null,
  minDiscountPaise: 0n,
  tdsDeducted: false,
  tdsRateBps: DEFAULT_TDS_RATE_BPS,
  invoiceGstRateBps: DEFAULT_INVOICE_GST_RATE_BPS,
  processingFeeFlatPaise: 0n,
  processingFeeBps: 0,
  feeGstRateBps: DEFAULT_FEE_GST_RATE_BPS,
};

export interface PricingInput {
  /** Builder-approved invoice amount, GST-inclusive. */
  invoiceTotalPaise: bigint;
  /** Date the channel partner is paid (today in IST when quoting). */
  valueDate: CalendarDate;
  /** Date the builder settles with the financier. */
  dueDate: CalendarDate;
}

export interface PricingQuote {
  ruleVersion: string;
  pricingMode: PricingMode;
  discountRateBps: number;
  valueDate: CalendarDate;
  dueDate: CalendarDate;
  tenorDays: number;
  invoiceTotalPaise: bigint;
  taxableValuePaise: bigint;
  tdsRateBps: number;
  tdsPaise: bigint;
  financedAmountPaise: bigint;
  computedDiscountPaise: bigint;
  minDiscountPaise: bigint;
  minimumDiscountApplied: boolean;
  discountAmountPaise: bigint;
  processingFeePaise: bigint;
  feeGstRateBps: number;
  feeGstPaise: bigint;
  chargesPaise: bigint;
  netPayablePaise: bigint;
  settlementAmountPaise: bigint;
  annualisedRateBps: number;
}

export type PricingRejectionCode = "DUE_DATE_NOT_IN_FUTURE" | "TENOR_TOO_SHORT" | "TENOR_TOO_LONG" | "NET_NOT_POSITIVE";

export type PricingResult = { ok: true; quote: PricingQuote } | { ok: false; code: PricingRejectionCode; message: string; tenorDays: number };

/** Integer division of non-negative values, rounding half-up. */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("Denominator must be positive");
  if (numerator < 0n) throw new RangeError("Numerator must not be negative");
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function isBps(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Returns human-readable problems with a set of terms; empty when valid. */
export function pricingTermsIssues(terms: PricingTerms): { field: keyof PricingTerms; message: string }[] {
  const issues: { field: keyof PricingTerms; message: string }[] = [];
  const maxRate = MAX_RATE_BPS;
  if (terms.pricingMode !== "FLAT_PERCENT" && terms.pricingMode !== "ANNUAL_RATE") issues.push({ field: "pricingMode", message: "Unknown pricing mode" });
  if (!isBps(terms.discountRateBps, MIN_RATE_BPS, maxRate)) issues.push({ field: "discountRateBps", message: `Rate must be between 0.01% and ${maxRate / 100}%` });
  if (!Number.isInteger(terms.minTenorDays) || terms.minTenorDays < 1 || terms.minTenorDays > MAX_TENOR_DAYS)
    issues.push({ field: "minTenorDays", message: `Minimum tenor must be 1–${MAX_TENOR_DAYS} days` });
  if (terms.maxTenorDays !== null) {
    if (!Number.isInteger(terms.maxTenorDays) || terms.maxTenorDays < 1 || terms.maxTenorDays > MAX_TENOR_DAYS)
      issues.push({ field: "maxTenorDays", message: `Maximum tenor must be 1–${MAX_TENOR_DAYS} days` });
    else if (terms.maxTenorDays < terms.minTenorDays) issues.push({ field: "maxTenorDays", message: "Maximum tenor must not be below the minimum" });
  }
  if (terms.minDiscountPaise < 0n) issues.push({ field: "minDiscountPaise", message: "Minimum discount cannot be negative" });
  if (!isBps(terms.tdsRateBps, 0, MAX_TDS_RATE_BPS)) issues.push({ field: "tdsRateBps", message: `TDS rate must be between 0% and ${MAX_TDS_RATE_BPS / 100}%` });
  if (terms.tdsDeducted && terms.tdsRateBps === 0) issues.push({ field: "tdsRateBps", message: "Enter the TDS rate the builder deducts" });
  if (!isBps(terms.invoiceGstRateBps, 0, MAX_GST_RATE_BPS)) issues.push({ field: "invoiceGstRateBps", message: `GST rate must be between 0% and ${MAX_GST_RATE_BPS / 100}%` });
  if (terms.processingFeeFlatPaise < 0n) issues.push({ field: "processingFeeFlatPaise", message: "Processing fee cannot be negative" });
  if (!isBps(terms.processingFeeBps, 0, MAX_PROCESSING_FEE_BPS))
    issues.push({ field: "processingFeeBps", message: `Processing fee rate must be between 0% and ${MAX_PROCESSING_FEE_BPS / 100}%` });
  if (!isBps(terms.feeGstRateBps, 0, MAX_GST_RATE_BPS)) issues.push({ field: "feeGstRateBps", message: `GST on fees must be between 0% and ${MAX_GST_RATE_BPS / 100}%` });
  return issues;
}

/** Prices an early payment. Throws RangeError for invalid terms or amounts; returns a rejection for business limits. */
export function priceEarlyPayment(terms: PricingTerms, input: PricingInput): PricingResult {
  const issues = pricingTermsIssues(terms);
  if (issues.length) throw new RangeError(`Invalid pricing terms: ${issues.map((i) => i.message).join("; ")}`);
  if (input.invoiceTotalPaise <= 0n) throw new RangeError("Invoice amount must be positive");

  const tenorDays = daysBetween(input.valueDate, input.dueDate);
  if (tenorDays < 1) return { ok: false, code: "DUE_DATE_NOT_IN_FUTURE", message: "The invoice due date has passed.", tenorDays };
  if (tenorDays < terms.minTenorDays) {
    return {
      ok: false,
      code: "TENOR_TOO_SHORT",
      message: `The invoice is due in ${tenorDays} ${tenorDays === 1 ? "day" : "days"}; this programme finances invoices due in at least ${terms.minTenorDays} days.`,
      tenorDays,
    };
  }
  if (terms.maxTenorDays !== null && tenorDays > terms.maxTenorDays) {
    return {
      ok: false,
      code: "TENOR_TOO_LONG",
      message: `The invoice is due in ${tenorDays} days; this programme finances invoices due within ${terms.maxTenorDays} days.`,
      tenorDays,
    };
  }

  const total = input.invoiceTotalPaise;
  const taxableValuePaise = divideRoundHalfUp(total * 10_000n, 10_000n + BigInt(terms.invoiceGstRateBps));
  const tdsRateBps = terms.tdsDeducted ? terms.tdsRateBps : 0;
  const tdsPaise = divideRoundHalfUp(taxableValuePaise * BigInt(tdsRateBps), 10_000n);
  const base = total - tdsPaise;

  const rate = BigInt(terms.discountRateBps);
  const computedDiscountPaise =
    terms.pricingMode === "ANNUAL_RATE"
      ? divideRoundHalfUp(base * rate * BigInt(tenorDays), 10_000n * BigInt(DAYS_IN_YEAR_ACT365))
      : divideRoundHalfUp(base * rate, 10_000n);
  const minimumDiscountApplied = terms.minDiscountPaise > computedDiscountPaise;
  const discountAmountPaise = minimumDiscountApplied ? terms.minDiscountPaise : computedDiscountPaise;

  const processingFeePaise = terms.processingFeeFlatPaise + divideRoundHalfUp(base * BigInt(terms.processingFeeBps), 10_000n);
  const feeGstPaise = divideRoundHalfUp(processingFeePaise * BigInt(terms.feeGstRateBps), 10_000n);
  const chargesPaise = processingFeePaise + feeGstPaise;
  const netPayablePaise = base - discountAmountPaise - chargesPaise;
  if (netPayablePaise <= 0n) {
    return { ok: false, code: "NET_NOT_POSITIVE", message: "The discount and charges exceed the invoice amount.", tenorDays };
  }

  return {
    ok: true,
    quote: {
      ruleVersion: PRICING_RULE_VERSION,
      pricingMode: terms.pricingMode,
      discountRateBps: terms.discountRateBps,
      valueDate: input.valueDate,
      dueDate: input.dueDate,
      tenorDays,
      invoiceTotalPaise: total,
      taxableValuePaise,
      tdsRateBps,
      tdsPaise,
      financedAmountPaise: base,
      computedDiscountPaise,
      minDiscountPaise: terms.minDiscountPaise,
      minimumDiscountApplied,
      discountAmountPaise,
      processingFeePaise,
      feeGstRateBps: terms.feeGstRateBps,
      feeGstPaise,
      chargesPaise,
      netPayablePaise,
      settlementAmountPaise: base,
      annualisedRateBps: annualisedRateBps(discountAmountPaise + chargesPaise, netPayablePaise, tenorDays),
    },
  };
}

/** All-in simple annual cost of receiving `netPaise` now against `costPaise` deducted, over `days` (ACT/365), in basis points. */
export function annualisedRateBps(costPaise: bigint, netPaise: bigint, days: number): number {
  if (!Number.isInteger(days) || days < 1) throw new RangeError("Days must be a positive integer");
  if (netPaise <= 0n) throw new RangeError("Net amount must be positive");
  return Number(divideRoundHalfUp(costPaise * 10_000n * BigInt(DAYS_IN_YEAR_ACT365), netPaise * BigInt(days)));
}

export interface PricedFigures {
  pricingMode: PricingMode;
  discountRateBps: number;
  dueDate: CalendarDate | null;
  invoiceTotalPaise: bigint;
  tdsPaise: bigint;
  financedAmountPaise: bigint;
  discountAmountPaise: bigint;
  processingFeePaise: bigint;
  feeGstPaise: bigint;
  chargesPaise: bigint;
  netPayablePaise: bigint;
}

/**
 * Identity of the commercial terms of a quote: rate, settlement date and every amount. Tenor and
 * annualised rate are excluded because they change daily while the amounts a partner agreed to do not.
 */
export function pricedFiguresKey(f: PricedFigures): string {
  return [
    f.pricingMode,
    f.discountRateBps,
    f.dueDate ?? "-",
    f.invoiceTotalPaise,
    f.tdsPaise,
    f.financedAmountPaise,
    f.discountAmountPaise,
    f.processingFeePaise,
    f.feeGstPaise,
    f.chargesPaise,
    f.netPayablePaise,
  ].join("|");
}

export function figuresOfQuote(q: PricingQuote): PricedFigures {
  return {
    pricingMode: q.pricingMode,
    discountRateBps: q.discountRateBps,
    dueDate: q.dueDate,
    invoiceTotalPaise: q.invoiceTotalPaise,
    tdsPaise: q.tdsPaise,
    financedAmountPaise: q.financedAmountPaise,
    discountAmountPaise: q.discountAmountPaise,
    processingFeePaise: q.processingFeePaise,
    feeGstPaise: q.feeGstPaise,
    chargesPaise: q.chargesPaise,
    netPayablePaise: q.netPayablePaise,
  };
}

export type SerialisedQuote = { [K in keyof PricingQuote]: PricingQuote[K] extends bigint ? string : PricingQuote[K] };

/** JSON-safe quote (bigint paise as decimal strings) for snapshots and client props. */
export function serialiseQuote(quote: PricingQuote): SerialisedQuote {
  return Object.fromEntries(Object.entries(quote).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])) as SerialisedQuote;
}

export function describePricingMode(mode: PricingMode): string {
  return mode === "ANNUAL_RATE" ? "Annual rate × days to due date ÷ 365" : "Flat percentage of the financed amount";
}
