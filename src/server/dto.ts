import "server-only";
import type { FinancingOffer } from "@/generated/prisma/client";
import { consentTextFor } from "@/lib/key-facts";
import type { PricingMode } from "@/lib/pricing";
import { keyFactsForRow } from "./services/financing-pricing";
import { parseOfferTerms, type OfferTerms } from "./services/financing";

/** Key facts as of the day the offer is shown; null for offers priced before the pricing engine. */
export interface OfferKeyFactsDto {
  tenorDays: number;
  settlementDueDate: string;
  settlementAmountPaise: string;
  annualisedRateBps: number;
}

/** Client-safe offer payload (BigInt values as decimal paise strings). */
export interface OfferDto {
  id: string;
  reference: string;
  invoiceId: string;
  status: FinancingOffer["status"];
  invoiceAmountPaise: string;
  approvedAmountPaise: string;
  discountRateBps: number;
  discountAmountPaise: string;
  chargesPaise: string;
  netPayablePaise: string;
  pricingMode: PricingMode;
  pricingRuleVersion: string;
  tdsPaise: string;
  financedAmountPaise: string;
  processingFeePaise: string;
  feeGstPaise: string;
  keyFacts: OfferKeyFactsDto | null;
  consentText: string;
  generatedAt: string;
  validUntil: string;
  terms: OfferTerms;
}

export function toOfferDto(offer: FinancingOffer, now: Date = new Date()): OfferDto {
  const facts = keyFactsForRow(offer, now);
  return {
    id: offer.id,
    reference: offer.reference,
    invoiceId: offer.invoiceId,
    status: offer.status,
    invoiceAmountPaise: offer.invoiceAmountPaise.toString(),
    approvedAmountPaise: offer.approvedAmountPaise.toString(),
    discountRateBps: offer.discountRateBps,
    discountAmountPaise: offer.discountAmountPaise.toString(),
    chargesPaise: offer.chargesPaise.toString(),
    netPayablePaise: offer.netPayablePaise.toString(),
    pricingMode: offer.pricingMode,
    pricingRuleVersion: offer.pricingRuleVersion,
    tdsPaise: offer.tdsPaise.toString(),
    financedAmountPaise: offer.financedAmountPaise.toString(),
    processingFeePaise: offer.processingFeePaise.toString(),
    feeGstPaise: offer.feeGstPaise.toString(),
    keyFacts: facts
      ? {
          tenorDays: facts.tenorDays,
          settlementDueDate: facts.settlementDueDate,
          settlementAmountPaise: facts.settlementAmountPaise.toString(),
          annualisedRateBps: facts.annualisedRateBps,
        }
      : null,
    consentText: consentTextFor(facts),
    generatedAt: offer.generatedAt.toISOString(),
    validUntil: offer.validUntil.toISOString(),
    terms: parseOfferTerms(offer.termsSnapshot),
  };
}
