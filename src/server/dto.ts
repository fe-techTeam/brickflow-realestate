import "server-only";
import type { FinancingOffer } from "@/generated/prisma/client";
import { parseOfferTerms, type OfferTerms } from "./services/financing";

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
  generatedAt: string;
  validUntil: string;
  terms: OfferTerms;
}

export function toOfferDto(offer: FinancingOffer): OfferDto {
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
    generatedAt: offer.generatedAt.toISOString(),
    validUntil: offer.validUntil.toISOString(),
    terms: parseOfferTerms(offer.termsSnapshot),
  };
}
