import { addDays, istToday } from "@/lib/calendar";
import { parsePercentToBps, parseRupeesToPaise } from "@/lib/money";
import { DEFAULT_PRICING_TERMS, priceEarlyPayment, pricingTermsIssues, type PricingResult, type PricingTerms } from "@/lib/pricing";
import type { ProgrammeFormValues } from "./types";

export type PricingValues = Pick<
  ProgrammeFormValues,
  | "pricingMode"
  | "minTenorDays"
  | "maxTenorDays"
  | "minDiscount"
  | "tdsDeducted"
  | "tdsRate"
  | "invoiceGstRate"
  | "processingFeeFlat"
  | "processingFeeRate"
  | "feeGstRate"
  | "holidayRule"
>;

/** Form defaults: flat percentage, no TDS, no charges — the original pricing behaviour. */
export const DEFAULT_PRICING_VALUES: PricingValues = {
  pricingMode: "FLAT_PERCENT",
  minTenorDays: String(DEFAULT_PRICING_TERMS.minTenorDays),
  maxTenorDays: "",
  minDiscount: "0",
  tdsDeducted: false,
  tdsRate: "2",
  invoiceGstRate: "18",
  processingFeeFlat: "0",
  processingFeeRate: "0",
  feeGstRate: "18",
  holidayRule: "NONE",
};

function wholeDays(value: string): number | null {
  const trimmed = value.trim();
  return /^\d{1,3}$/.test(trimmed) ? Number(trimmed) : null;
}

/** Reads typed form values into pricing terms; null with problems when any value is unreadable or out of range. */
export function termsFromValues(values: Pick<ProgrammeFormValues, "discountRate"> & PricingValues): { terms: PricingTerms | null; problems: string[] } {
  const discountRateBps = parsePercentToBps(values.discountRate);
  const minTenorDays = wholeDays(values.minTenorDays);
  const maxTenorDays = values.maxTenorDays.trim() === "" ? null : wholeDays(values.maxTenorDays);
  const minDiscountPaise = parseRupeesToPaise(values.minDiscount || "0");
  const tdsRateBps = parsePercentToBps(values.tdsRate || "0");
  const invoiceGstRateBps = parsePercentToBps(values.invoiceGstRate || "0");
  const processingFeeFlatPaise = parseRupeesToPaise(values.processingFeeFlat || "0");
  const processingFeeBps = parsePercentToBps(values.processingFeeRate || "0");
  const feeGstRateBps = parsePercentToBps(values.feeGstRate || "0");

  const unreadable = [
    discountRateBps === null && "discount rate",
    minTenorDays === null && "minimum tenor",
    values.maxTenorDays.trim() !== "" && maxTenorDays === null && "maximum tenor",
    minDiscountPaise === null && "minimum discount",
    tdsRateBps === null && "TDS rate",
    invoiceGstRateBps === null && "invoice GST rate",
    processingFeeFlatPaise === null && "processing fee",
    processingFeeBps === null && "processing fee rate",
    feeGstRateBps === null && "GST on fees",
  ].filter((v): v is string => Boolean(v));
  if (unreadable.length) return { terms: null, problems: unreadable.map((f) => `Check the ${f}.`) };

  const terms: PricingTerms = {
    pricingMode: values.pricingMode,
    discountRateBps: discountRateBps!,
    minTenorDays: minTenorDays!,
    maxTenorDays,
    minDiscountPaise: minDiscountPaise!,
    tdsDeducted: values.tdsDeducted,
    tdsRateBps: tdsRateBps!,
    invoiceGstRateBps: invoiceGstRateBps!,
    processingFeeFlatPaise: processingFeeFlatPaise!,
    processingFeeBps: processingFeeBps!,
    feeGstRateBps: feeGstRateBps!,
  };
  const issues = pricingTermsIssues(terms);
  return issues.length ? { terms: null, problems: issues.map((i) => `${i.message}.`) } : { terms, problems: [] };
}

export const SAMPLE_INVOICE_PAISE = 5_00_000_00n;
export const SAMPLE_TENOR_DAYS = 60;

/** Prices the worked example: a ₹5,00,000 GST-inclusive invoice due `days` from today (IST). */
export function sampleQuote(terms: PricingTerms, days: number = SAMPLE_TENOR_DAYS, now: Date = new Date()): PricingResult {
  const valueDate = istToday(now);
  return priceEarlyPayment(terms, { invoiceTotalPaise: SAMPLE_INVOICE_PAISE, valueDate, dueDate: addDays(valueDate, days) });
}
