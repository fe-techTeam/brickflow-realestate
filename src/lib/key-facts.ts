/**
 * Key facts shown to a channel partner before accepting an early payment, and the consent text
 * built from them. Pure, so the server and the offer screen describe an offer identically.
 */

import { daysBetween, formatCalendarDate, type CalendarDate } from "./calendar";
import { formatBps, formatINR } from "./money";
import { annualisedRateBps, type PricingMode } from "./pricing";

export const CONSENT_TEXT =
  "I confirm that I wish to receive early payment for this builder-approved invoice at the discount shown. " +
  "I understand the discount and any charges are deducted upfront, that the net amount will be paid to my registered bank account, " +
  "and that the builder will settle the financed amount with the financier on the settlement date shown.";

export interface KeyFacts {
  pricingMode: PricingMode;
  discountRateBps: number;
  financedAmountPaise: bigint;
  tdsPaise: bigint;
  discountAmountPaise: bigint;
  chargesPaise: bigint;
  netPayablePaise: bigint;
  settlementAmountPaise: bigint;
  settlementDueDate: CalendarDate;
  tenorDays: number;
  annualisedRateBps: number;
}

export interface StoredPricing {
  pricingMode: PricingMode;
  discountRateBps: number;
  financedAmountPaise: bigint;
  tdsPaise: bigint;
  discountAmountPaise: bigint;
  chargesPaise: bigint;
  netPayablePaise: bigint;
  /** Settlement due date the offer was priced to; null on offers priced before the engine existed. */
  settlementDueDate: CalendarDate | null;
}

/**
 * Key facts of stored figures as of a given day: days to the settlement date and the all-in
 * annualised rate both shorten as the date approaches, while the amounts stay fixed.
 */
export function keyFactsAsOf(stored: StoredPricing, today: CalendarDate): KeyFacts | null {
  if (!stored.settlementDueDate || stored.netPayablePaise <= 0n) return null;
  const tenorDays = daysBetween(today, stored.settlementDueDate);
  if (tenorDays < 1) return null;
  return {
    pricingMode: stored.pricingMode,
    discountRateBps: stored.discountRateBps,
    financedAmountPaise: stored.financedAmountPaise,
    tdsPaise: stored.tdsPaise,
    discountAmountPaise: stored.discountAmountPaise,
    chargesPaise: stored.chargesPaise,
    netPayablePaise: stored.netPayablePaise,
    settlementAmountPaise: stored.financedAmountPaise,
    settlementDueDate: stored.settlementDueDate,
    tenorDays,
    annualisedRateBps: annualisedRateBps(stored.discountAmountPaise + stored.chargesPaise, stored.netPayablePaise, tenorDays),
  };
}

export function describeRate(mode: PricingMode, bps: number): string {
  return mode === "ANNUAL_RATE" ? `${formatBps(bps)} a year` : `${formatBps(bps)} flat`;
}

/** Consent statement with the offer's key facts appended, stored verbatim on acceptance. */
export function consentTextFor(facts: KeyFacts | null): string {
  if (!facts) return CONSENT_TEXT;
  const days = `${facts.tenorDays} ${facts.tenorDays === 1 ? "day" : "days"}`;
  const tds = facts.tdsPaise > 0n ? ` after TDS of ${formatINR(facts.tdsPaise)} deducted by the builder` : "";
  return (
    `${CONSENT_TEXT} Key facts: I receive ${formatINR(facts.netPayablePaise)} now; ` +
    `the builder settles ${formatINR(facts.settlementAmountPaise)}${tds} on ${formatCalendarDate(facts.settlementDueDate)}, ${days} away; ` +
    `the discount of ${formatINR(facts.discountAmountPaise)} (${describeRate(facts.pricingMode, facts.discountRateBps)}) and charges of ${formatINR(facts.chargesPaise)} ` +
    `are equivalent to an annualised rate of ${formatBps(facts.annualisedRateBps)} (ACT/365).`
  );
}
