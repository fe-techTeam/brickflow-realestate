import type { Actor } from "@/server/auth/session";
import { acceptOffer, approveFinancingRequest, completeDisbursement, generateOffer, initiateDisbursement } from "@/server/services/financing";
import { acceptedInvoice, type DemoUser, type SubmitOptions } from "./helpers";

/** Drives a fresh Godrej invoice through the real services to the requested financing stage. */
export async function financedTo(as: Record<DemoUser, Actor>, stage: "OFFER_GENERATED" | "PENDING_APPROVAL" | "APPROVED" | "DISBURSED", options: SubmitOptions = {}) {
  const invoice = await acceptedInvoice(as.prestige, as.godrej, options);
  const offer = await generateOffer(as.prestige, invoice.id);
  if (stage === "OFFER_GENERATED") return { invoiceId: invoice.id, offerId: offer.id, requestId: null };
  const request = await acceptOffer(as.prestige, offer.id, { consent: true });
  if (stage !== "PENDING_APPROVAL") await approveFinancingRequest(as.finance, request.id, {});
  if (stage === "DISBURSED") {
    await initiateDisbursement(as.finance, request.id);
    await completeDisbursement(as.finance, request.id);
  }
  return { invoiceId: invoice.id, offerId: offer.id, requestId: request.id };
}
