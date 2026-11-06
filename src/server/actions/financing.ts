"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../action-result";
import { requireActor } from "../auth/session";
import { toOfferDto, type OfferDto } from "../dto";
import { invalid } from "../errors";
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

/** Money-moving actions must carry the client-generated key so a resubmission replays instead of repeating. */
function requireKey(input: { idempotencyKey?: string }): string {
  if (!input.idempotencyKey) throw invalid("This form has expired. Refresh the page and try again.");
  return input.idempotencyKey;
}

export async function generateOfferAction(invoiceId: string): Promise<ActionResult<OfferDto>> {
  return runAction(async () => {
    const offer = await generateOffer(await requireActor(), invoiceId);
    refresh();
    return toOfferDto(offer);
  });
}

export async function acceptOfferAction(
  offerId: string,
  input: { consent: boolean; idempotencyKey: string },
): Promise<ActionResult<{ requestId: string; reference: string }>> {
  return runAction(async () => {
    const request = await acceptOffer(await requireActor(), offerId, { consent: input.consent, idempotencyKey: requireKey(input) });
    refresh();
    return { requestId: request.id, reference: request.reference };
  }, "Offer accepted. Your request is pending Veefin approval.");
}

export async function approveFinancingRequestAction(requestId: string, input: { note?: string; idempotencyKey: string }): Promise<ActionResult> {
  return runAction(async () => {
    await approveFinancingRequest(await requireActor(), requestId, { note: input.note, idempotencyKey: requireKey(input) });
    refresh();
    return undefined;
  }, "Financing request approved. You can now initiate the disbursement.");
}

export async function rejectFinancingRequestAction(requestId: string, input: { reason: string; idempotencyKey: string }): Promise<ActionResult> {
  return runAction(async () => {
    await rejectFinancingRequest(await requireActor(), requestId, { reason: input.reason, idempotencyKey: requireKey(input) });
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

export async function initiateDisbursementAction(requestId: string, input: { idempotencyKey: string }): Promise<ActionResult<{ reference: string }>> {
  return runAction(async () => {
    const disbursement = await initiateDisbursement(await requireActor(), requestId, { idempotencyKey: requireKey(input) });
    refresh();
    return { reference: disbursement.reference };
  }, "Disbursement initiated.");
}

export async function completeDisbursementAction(requestId: string, input: { idempotencyKey: string }): Promise<ActionResult> {
  return runAction(async () => {
    await completeDisbursement(await requireActor(), requestId, { idempotencyKey: requireKey(input) });
    refresh();
    return undefined;
  }, "Transfer confirmed. The invoice is now marked as disbursed.");
}

export async function markSettlementSettledAction(
  requestId: string,
  input: { reference: string; note?: string; idempotencyKey: string },
): Promise<ActionResult> {
  return runAction(async () => {
    await markSettlementSettled(await requireActor(), requestId, { reference: input.reference, note: input.note, idempotencyKey: requireKey(input) });
    refresh();
    return undefined;
  }, "Settlement recorded.");
}
