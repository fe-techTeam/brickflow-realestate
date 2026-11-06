import "server-only";
import type { FinancingOffer, FinancingProgramme, FinancingRequest, Invoice, Prisma } from "@/generated/prisma/client";
import { addDays, adjustDueDate, istToday, toCalendarDate, toStorageDate, type CalendarDate } from "@/lib/calendar";
import { keyFactsAsOf, type StoredPricing } from "@/lib/key-facts";
import { figuresOfQuote, priceEarlyPayment, pricedFiguresKey, serialiseQuote, type PricedFigures, type PricingQuote, type PricingResult, type PricingTerms } from "@/lib/pricing";
import { db, type Tx } from "../db";

type Client = Tx | typeof db;

export const DEFAULT_CREDIT_PERIOD_DAYS = 60;

export type ProgrammePricing = Pick<
  FinancingProgramme,
  | "discountRateBps"
  | "pricingMode"
  | "minTenorDays"
  | "maxTenorDays"
  | "minDiscountPaise"
  | "tdsDeducted"
  | "tdsRateBps"
  | "invoiceGstRateBps"
  | "processingFeeFlatPaise"
  | "processingFeeBps"
  | "feeGstRateBps"
  | "holidayRule"
>;

export function programmeTerms(p: ProgrammePricing): PricingTerms {
  return {
    pricingMode: p.pricingMode,
    discountRateBps: p.discountRateBps,
    minTenorDays: p.minTenorDays,
    maxTenorDays: p.maxTenorDays,
    minDiscountPaise: p.minDiscountPaise,
    tdsDeducted: p.tdsDeducted,
    tdsRateBps: p.tdsRateBps,
    invoiceGstRateBps: p.invoiceGstRateBps,
    processingFeeFlatPaise: p.processingFeeFlatPaise,
    processingFeeBps: p.processingFeeBps,
    feeGstRateBps: p.feeGstRateBps,
  };
}

/** Holidays between two dates inclusive, as calendar dates. */
export async function loadHolidaySet(from: CalendarDate, to: CalendarDate, client: Client = db): Promise<Set<CalendarDate>> {
  const rows = await client.businessHoliday.findMany({
    where: { date: { gte: toStorageDate(from), lte: toStorageDate(to) } },
    select: { date: true },
  });
  return new Set(rows.map((r) => toCalendarDate(r.date)));
}

type DueDateInvoice = Pick<Invoice, "dueDate" | "invoiceDate" | "cpId" | "builderId">;

/** The invoice's own due date, or the invoice date plus the empanelment credit period when none was given. */
export async function invoiceDueDate(invoice: DueDateInvoice, client: Client = db): Promise<CalendarDate> {
  if (invoice.dueDate) return toCalendarDate(invoice.dueDate);
  const relationship = await client.cpBuilderRelationship.findUnique({
    where: { cpId_builderId: { cpId: invoice.cpId, builderId: invoice.builderId } },
    select: { creditPeriodDays: true },
  });
  return addDays(toCalendarDate(invoice.invoiceDate), relationship?.creditPeriodDays ?? DEFAULT_CREDIT_PERIOD_DAYS);
}

/** Settlement due date after the programme's holiday rule. */
export async function settlementDueDate(dueDate: CalendarDate, rule: ProgrammePricing["holidayRule"], client: Client = db): Promise<CalendarDate> {
  if (rule === "NONE") return dueDate;
  const holidays = await loadHolidaySet(dueDate, addDays(dueDate, 31), client);
  return adjustDueDate(dueDate, rule, holidays);
}

export interface InvoiceQuote {
  valueDate: CalendarDate;
  invoiceDueDate: CalendarDate;
  settlementDueDate: CalendarDate;
  result: PricingResult;
}

/** Prices an invoice under a programme as of `now` (IST). The quote is priced to the holiday-adjusted settlement date. */
export async function quoteInvoice(
  programme: ProgrammePricing,
  invoice: DueDateInvoice & Pick<Invoice, "approvedAmountPaise">,
  now: Date,
  client: Client = db,
): Promise<InvoiceQuote> {
  if (!invoice.approvedAmountPaise || invoice.approvedAmountPaise <= 0n) throw new RangeError("Invoice has no approved amount");
  const valueDate = istToday(now);
  const due = await invoiceDueDate(invoice, client);
  const settlement = await settlementDueDate(due, programme.holidayRule, client);
  const result = priceEarlyPayment(programmeTerms(programme), { invoiceTotalPaise: invoice.approvedAmountPaise, valueDate, dueDate: settlement });
  return { valueDate, invoiceDueDate: due, settlementDueDate: settlement, result };
}

/** Columns persisted on an offer and copied to the request. */
export function pricingColumns(quote: PricingQuote, programme: ProgrammePricing, invoiceDue: CalendarDate, now: Date) {
  return {
    approvedAmountPaise: quote.invoiceTotalPaise,
    discountRateBps: quote.discountRateBps,
    discountAmountPaise: quote.discountAmountPaise,
    chargesPaise: quote.chargesPaise,
    netPayablePaise: quote.netPayablePaise,
    pricingMode: quote.pricingMode,
    pricingRuleVersion: quote.ruleVersion,
    tenorDays: quote.tenorDays,
    pricedDueDate: toStorageDate(quote.dueDate),
    tdsPaise: quote.tdsPaise,
    financedAmountPaise: quote.financedAmountPaise,
    processingFeePaise: quote.processingFeePaise,
    feeGstPaise: quote.feeGstPaise,
    annualisedRateBps: quote.annualisedRateBps,
    pricingSnapshot: pricingSnapshot(quote, programme, invoiceDue, now),
  } satisfies Partial<Prisma.FinancingOfferUncheckedCreateInput>;
}

/** Complete, self-describing record of how a quote was produced. */
export function pricingSnapshot(quote: PricingQuote, programme: ProgrammePricing, invoiceDue: CalendarDate, now: Date): Prisma.InputJsonObject {
  const terms = programmeTerms(programme);
  return {
    ruleVersion: quote.ruleVersion,
    pricedAt: now.toISOString(),
    invoiceDueDate: invoiceDue,
    holidayRule: programme.holidayRule,
    terms: Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])),
    quote: serialiseQuote(quote),
  };
}

type StoredRow = Pick<
  FinancingOffer | FinancingRequest,
  | "pricingMode"
  | "discountRateBps"
  | "pricedDueDate"
  | "approvedAmountPaise"
  | "tdsPaise"
  | "financedAmountPaise"
  | "discountAmountPaise"
  | "processingFeePaise"
  | "feeGstPaise"
  | "chargesPaise"
  | "netPayablePaise"
>;

export function storedFigures(row: StoredRow): PricedFigures {
  return {
    pricingMode: row.pricingMode,
    discountRateBps: row.discountRateBps,
    dueDate: row.pricedDueDate ? toCalendarDate(row.pricedDueDate) : null,
    invoiceTotalPaise: row.approvedAmountPaise,
    tdsPaise: row.tdsPaise,
    financedAmountPaise: row.financedAmountPaise,
    discountAmountPaise: row.discountAmountPaise,
    processingFeePaise: row.processingFeePaise,
    feeGstPaise: row.feeGstPaise,
    chargesPaise: row.chargesPaise,
    netPayablePaise: row.netPayablePaise,
  };
}

/** True when a stored offer carries exactly the commercial figures of a fresh quote. */
export function matchesQuote(row: StoredRow, quote: PricingQuote): boolean {
  return pricedFiguresKey(storedFigures(row)) === pricedFiguresKey(figuresOfQuote(quote));
}

export function storedPricing(row: StoredRow): StoredPricing {
  return {
    pricingMode: row.pricingMode,
    discountRateBps: row.discountRateBps,
    financedAmountPaise: row.financedAmountPaise,
    tdsPaise: row.tdsPaise,
    discountAmountPaise: row.discountAmountPaise,
    chargesPaise: row.chargesPaise,
    netPayablePaise: row.netPayablePaise,
    settlementDueDate: row.pricedDueDate ? toCalendarDate(row.pricedDueDate) : null,
  };
}

export function keyFactsForRow(row: StoredRow, now: Date = new Date()) {
  return keyFactsAsOf(storedPricing(row), istToday(now));
}
