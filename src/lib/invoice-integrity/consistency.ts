/**
 * Cross-field consistency rules for a brokerage tax invoice. Pure and framework-free: the server
 * enforces them on submission and the upload form runs the same rules for inline feedback.
 * Money is integer paise; rates are basis points.
 */
import { formatBps, formatINR } from "../money";
import { GST_RATES_BPS, gstinStateCode, isStateCode, supplyMode, type SupplyMode } from "./gst";
import { isAckNumberFormat, isIrnFormat } from "./irn";

export const BOOKING_TOWER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,19}$/;
export const BOOKING_UNIT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 /._-]{0,19}$/;
/** Up to four letters. Buyer names and other personal details are deliberately not accepted. */
export const BUYER_INITIALS_PATTERN = /^[A-Z]{1,4}$/;
export const AGREEMENT_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 /._-]{2,39}$/;

/** Rounding a GST invoice to the nearest rupee is permitted, so totals may differ by up to ₹1. */
export const ROUND_OFF_TOLERANCE_PAISE = 100n;
/** Invoiced brokerage may differ from the agreement's stated brokerage by up to 1% (rounding, part-rupee adjustments). */
export const BROKERAGE_TOLERANCE_BPS = 100n;
export const MAX_BROKERAGE_BPS = 1000;
export const MAX_TDS_BPS = 2000;
export const GST_START_DATE = new Date("2017-07-01T00:00:00.000Z");
const MAX_AGREEMENT_VALUE_PAISE = 10_000n * 1_00_00_000n * 100n;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Normalises typed initials ("a.k.", "A K") to "AK". */
export function normaliseBuyerInitials(value: string): string {
  return value.replace(/[\s.]/g, "").toUpperCase();
}

export interface ConsistencyInput {
  today: Date;
  invoiceDate: Date;
  dueDate?: Date | null;
  totalPaise: bigint;
  gstAmountPaise?: bigint | null;
  taxableValuePaise?: bigint | null;
  cgstPaise?: bigint | null;
  sgstPaise?: bigint | null;
  igstPaise?: bigint | null;
  gstRateBps?: number | null;
  supplierGstin?: string | null;
  recipientGstin?: string | null;
  placeOfSupplyStateCode?: string | null;
  agreementDate?: Date | null;
  agreementValuePaise?: bigint | null;
  agreementBrokerageBps?: number | null;
  agreementBrokeragePaise?: bigint | null;
  tdsRateBps?: number | null;
  irn?: string | null;
  eInvoiceAckNumber?: string | null;
  eInvoiceAckDate?: Date | null;
}

/** Field keys match the upload form and the server action's field errors. */
export type ConsistencyField =
  | "invoiceDate"
  | "dueDate"
  | "amount"
  | "gstAmount"
  | "taxableValue"
  | "cgst"
  | "sgst"
  | "igst"
  | "gstRate"
  | "placeOfSupply"
  | "agreementDate"
  | "agreementValue"
  | "agreementBrokerageRate"
  | "agreementBrokerageAmount"
  | "tdsRate"
  | "irn"
  | "ackNumber"
  | "ackDate";

export interface ConsistencyIssue {
  field: ConsistencyField;
  message: string;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** value × bps / 10 000, rounded half up to the paisa. */
export function applyBps(valuePaise: bigint, bps: number | bigint): bigint {
  return (valuePaise * BigInt(bps) + 5_000n) / 10_000n;
}

/** The brokerage the agreement states: the explicit amount, else agreement value × rate. */
export function agreedBrokeragePaise(input: Pick<ConsistencyInput, "agreementBrokeragePaise" | "agreementBrokerageBps" | "agreementValuePaise">): bigint | null {
  if (input.agreementBrokeragePaise != null) return input.agreementBrokeragePaise;
  if (input.agreementBrokerageBps != null && input.agreementValuePaise != null) return applyBps(input.agreementValuePaise, input.agreementBrokerageBps);
  return null;
}

/** Taxable value as stated, else derived from the total and the GST amount. */
export function invoicedTaxablePaise(input: Pick<ConsistencyInput, "taxableValuePaise" | "totalPaise" | "gstAmountPaise">): bigint | null {
  if (input.taxableValuePaise != null) return input.taxableValuePaise;
  if (input.gstAmountPaise != null) return input.totalPaise - input.gstAmountPaise;
  return null;
}

export function brokerageTolerancePaise(expectedPaise: bigint): bigint {
  const relative = (expectedPaise * BROKERAGE_TOLERANCE_BPS) / 10_000n;
  return relative > 100n ? relative : 100n;
}

/** Expected GST treatment from the supplier's state and the place of supply (default: recipient's state). */
export function expectedSupplyMode(input: Pick<ConsistencyInput, "supplierGstin" | "recipientGstin" | "placeOfSupplyStateCode">): SupplyMode | null {
  return supplyMode(gstinStateCode(input.supplierGstin), input.placeOfSupplyStateCode ?? gstinStateCode(input.recipientGstin));
}

/** Splits a GST-inclusive total at a rate (bps) into taxable value and CGST/SGST or IGST, exact to the paisa. */
export function splitInclusiveTotal(totalPaise: bigint, rateBps: number, mode: SupplyMode) {
  const rate = BigInt(rateBps);
  const taxablePaise = (totalPaise * 10_000n + (10_000n + rate) / 2n) / (10_000n + rate);
  const tax = totalPaise - taxablePaise;
  if (mode === "INTER") return { taxablePaise, cgstPaise: 0n, sgstPaise: 0n, igstPaise: tax };
  const cgstPaise = tax / 2n;
  return { taxablePaise, cgstPaise, sgstPaise: tax - cgstPaise, igstPaise: 0n };
}

/** Infers the GST slab from taxable value and tax when it lies within rounding of a standard rate. */
export function inferGstRateBps(taxablePaise: bigint, taxPaise: bigint): number | null {
  if (taxablePaise <= 0n) return null;
  for (const rate of GST_RATES_BPS) {
    if (abs(applyBps(taxablePaise, rate) - taxPaise) <= ROUND_OFF_TOLERANCE_PAISE) return rate;
  }
  return null;
}

export function checkInvoiceConsistency(input: ConsistencyInput): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const add = (field: ConsistencyField, message: string) => {
    if (!issues.some((i) => i.field === field)) issues.push({ field, message });
  };
  const latestAllowed = new Date(input.today.getTime() + DAY_MS);

  if (input.invoiceDate < GST_START_DATE) add("invoiceDate", "Invoice date must be on or after 1 July 2017 (GST)");
  if (input.dueDate && input.dueDate.getTime() > input.invoiceDate.getTime() + 366 * DAY_MS) add("dueDate", "Due date must be within a year of the invoice date");

  const components = [input.cgstPaise, input.sgstPaise, input.igstPaise];
  const hasComponents = components.some((c) => c != null);
  if ([...components, input.taxableValuePaise, input.gstAmountPaise].some((v) => v != null && v < 0n)) add("gstAmount", "Amounts cannot be negative");

  if (hasComponents && input.taxableValuePaise == null) add("taxableValue", "Enter the taxable value for the GST breakdown");

  const tax = hasComponents ? components.reduce<bigint>((sum, c) => sum + (c ?? 0n), 0n) : (input.gstAmountPaise ?? null);
  if (hasComponents && input.gstAmountPaise != null && input.gstAmountPaise !== tax) {
    add("gstAmount", `GST amount must equal CGST + SGST + IGST (${formatINR(tax!)})`);
  }

  if (input.taxableValuePaise != null) {
    if (input.taxableValuePaise <= 0n) add("taxableValue", "Taxable value must be greater than zero");
    const expectedTotal = input.taxableValuePaise + (tax ?? 0n);
    if (abs(expectedTotal - input.totalPaise) > ROUND_OFF_TOLERANCE_PAISE) {
      add("amount", `Invoice total must equal taxable value + GST (${formatINR(expectedTotal)})`);
    }
  }

  if (input.placeOfSupplyStateCode != null && !isStateCode(input.placeOfSupplyStateCode)) add("placeOfSupply", "Select a valid place of supply");

  const mode = expectedSupplyMode(input);
  const cgst = input.cgstPaise ?? 0n;
  const sgst = input.sgstPaise ?? 0n;
  const igst = input.igstPaise ?? 0n;
  if (hasComponents && mode === "INTRA") {
    if (igst !== 0n) add("igst", "Intra-state supply: charge CGST and SGST, not IGST");
    if (abs(cgst - sgst) > 1n) add("sgst", "CGST and SGST must be equal");
  } else if (hasComponents && mode === "INTER") {
    if (cgst !== 0n || sgst !== 0n) add(cgst !== 0n ? "cgst" : "sgst", "Inter-state supply: charge IGST, not CGST and SGST");
  }

  if (input.gstRateBps != null) {
    if (!(GST_RATES_BPS as readonly number[]).includes(input.gstRateBps)) add("gstRate", "Select a standard GST rate");
    else if (input.taxableValuePaise != null && tax != null) {
      const expectedTax = applyBps(input.taxableValuePaise, input.gstRateBps);
      if (abs(expectedTax - tax) > ROUND_OFF_TOLERANCE_PAISE) add("gstRate", `GST at ${formatBps(input.gstRateBps)} of the taxable value is ${formatINR(expectedTax)}`);
    }
  }

  if (input.tdsRateBps != null && (input.tdsRateBps < 0 || input.tdsRateBps > MAX_TDS_BPS)) add("tdsRate", "TDS rate must be between 0% and 20%");

  if (input.agreementDate) {
    if (input.agreementDate > input.invoiceDate) add("agreementDate", "The agreement must be dated on or before the invoice");
    else if (input.agreementDate.getTime() < input.invoiceDate.getTime() - 10 * 366 * DAY_MS) add("agreementDate", "Agreement date is more than ten years before the invoice");
  }
  if (input.agreementValuePaise != null && (input.agreementValuePaise <= 0n || input.agreementValuePaise > MAX_AGREEMENT_VALUE_PAISE)) {
    add("agreementValue", "Enter the agreement value stated in the registered agreement");
  }
  if (input.agreementBrokerageBps != null && (input.agreementBrokerageBps <= 0 || input.agreementBrokerageBps > MAX_BROKERAGE_BPS)) {
    add("agreementBrokerageRate", "Brokerage rate must be between 0.01% and 10%");
  }
  if (input.agreementBrokerageBps != null && input.agreementValuePaise == null && input.agreementBrokeragePaise == null) {
    add("agreementValue", "Enter the agreement value so the brokerage rate can be checked");
  }
  if (input.agreementBrokeragePaise != null && input.agreementBrokeragePaise <= 0n) add("agreementBrokerageAmount", "Brokerage amount must be greater than zero");
  if (input.agreementBrokeragePaise != null && input.agreementBrokerageBps != null && input.agreementValuePaise != null) {
    const fromRate = applyBps(input.agreementValuePaise, input.agreementBrokerageBps);
    if (abs(fromRate - input.agreementBrokeragePaise) > brokerageTolerancePaise(fromRate)) {
      add("agreementBrokerageAmount", `${formatBps(input.agreementBrokerageBps)} of the agreement value is ${formatINR(fromRate)}`);
    }
  }

  const agreed = agreedBrokeragePaise(input);
  const invoiced = invoicedTaxablePaise(input);
  if (agreed != null && agreed > 0n && invoiced != null && abs(invoiced - agreed) > brokerageTolerancePaise(agreed)) {
    add(
      input.agreementBrokeragePaise != null ? "agreementBrokerageAmount" : "agreementBrokerageRate",
      `Invoiced taxable value ${formatINR(invoiced)} differs from the brokerage in the agreement (${formatINR(agreed)}) by more than 1%`,
    );
  }
  if (input.agreementValuePaise != null && invoiced != null && invoiced >= input.agreementValuePaise) {
    add("agreementValue", "Agreement value must exceed the invoiced brokerage");
  }

  if (input.irn != null && !isIrnFormat(input.irn)) add("irn", "IRN must be the 64-character code from the e-invoice");
  if (input.eInvoiceAckNumber != null) {
    if (!isAckNumberFormat(input.eInvoiceAckNumber)) add("ackNumber", "Acknowledgement number must be 15 digits");
    if (input.irn == null) add("irn", "Enter the IRN this acknowledgement belongs to");
  }
  if (input.eInvoiceAckDate) {
    if (input.eInvoiceAckNumber == null) add("ackNumber", "Enter the acknowledgement number");
    if (input.eInvoiceAckDate < input.invoiceDate) add("ackDate", "Acknowledgement date cannot be before the invoice date");
    else if (input.eInvoiceAckDate > latestAllowed) add("ackDate", "Acknowledgement date cannot be in the future");
  }
  if (input.eInvoiceAckNumber != null && !input.eInvoiceAckDate) add("ackDate", "Enter the acknowledgement date");

  return issues;
}
