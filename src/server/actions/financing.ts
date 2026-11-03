"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../action-result";
import { requireActor } from "../auth/session";
import { toOfferDto, type OfferDto } from "../dto";
import {
  acceptOffer,
  addInternalComment,
  approveFinancingRequest,
  completeDisbursement,
  generateOffer,
  initiateDisbursement,
  markSettlementSettled,
  rejectFinancingRequest,
} from "../services/financing";

function refresh() {
  revalidatePath("/", "layout");
}

export async function generateOfferAction(invoiceId: string): Promise<ActionResult<OfferDto>> {
  return runAction(async () => {
    const offer = await generateOffer(await requireActor(), invoiceId);
    refresh();
    return toOfferDto(offer);
  });
}

export async function acceptOfferAction(offerId: string, input: { consent: boolean }): Promise<ActionResult<{ requestId: string; reference: string }>> {
  return runAction(async () => {
    const request = await acceptOffer(await requireActor(), offerId, input);
    refresh();
    return { requestId: request.id, reference: request.reference };
  }, "Offer accepted. Your request is pending Veefin approval.");
}

export async function approveFinancingRequestAction(requestId: string, input: { note?: string }): Promise<ActionResult> {
  return runAction(async () => {
    await approveFinancingRequest(await requireActor(), requestId, input);
    refresh();
    return undefined;
  }, "Financing request approved. You can now initiate the disbursement.");
}

export async function rejectFinancingRequestAction(requestId: string, input: { reason: string }): Promise<ActionResult> {
  return runAction(async () => {
    await rejectFinancingRequest(await requireActor(), requestId, input);
    refresh();
    return undefined;
  }, "Financing request rejected.");
}

export async function addInternalCommentAction(requestId: string, input: { body: string }): Promise<ActionResult> {
  return runAction(async () => {
    await addInternalComment(await requireActor(), requestId, input);
    refresh();
    return undefined;
  }, "Internal comment added.");
}

export async function initiateDisbursementAction(requestId: string): Promise<ActionResult<{ reference: string }>> {
  return runAction(async () => {
    const disbursement = await initiateDisbursement(await requireActor(), requestId);
    refresh();
    return { reference: disbursement.reference };
  }, "Disbursement initiated.");
}

export async function completeDisbursementAction(requestId: string): Promise<ActionResult> {
  return runAction(async () => {
    await completeDisbursement(await requireActor(), requestId);
    refresh();
    return undefined;
  }, "Transfer confirmed. The invoice is now marked as disbursed.");
}

export async function markSettlementSettledAction(requestId: string, input: { reference: string; note?: string }): Promise<ActionResult> {
  return runAction(async () => {
    await markSettlementSettled(await requireActor(), requestId, input);
    refresh();
    return undefined;
  }, "Settlement recorded.");
}
