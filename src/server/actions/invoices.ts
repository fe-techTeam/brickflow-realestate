"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../action-result";
import { requireActor } from "../auth/session";
import {
  approveInvoice,
  markUnderReview,
  rejectInvoice,
  requestClarification,
  resubmitInvoice,
  submitInvoice,
  type UploadedFile,
} from "../services/invoices";
import { resolveDuplicateFlag, setMatchPolicy } from "../services/invoice-integrity";

const INVOICE_DETAIL_FIELDS = [
  "bookingTower",
  "bookingUnit",
  "buyerInitials",
  "agreementRegistrationNumber",
  "agreementDate",
  "agreementValue",
  "agreementBrokerageRate",
  "agreementBrokerageAmount",
  "taxableValue",
  "cgst",
  "sgst",
  "igst",
  "gstRate",
  "tdsRate",
  "irn",
  "ackNumber",
  "ackDate",
  "placeOfSupply",
] as const;

async function readFile(formData: FormData, field = "file"): Promise<UploadedFile | null> {
  const value = formData.get(field);
  if (!(value instanceof File) || value.size === 0) return null;
  return { name: value.name, type: value.type, bytes: new Uint8Array(await value.arrayBuffer()) };
}

function text(formData: FormData, field: string): string | undefined {
  const value = formData.get(field);
  return typeof value === "string" ? value : undefined;
}

function refresh() {
  revalidatePath("/", "layout");
}

export async function submitInvoiceAction(formData: FormData): Promise<ActionResult<{ id: string; reference: string }>> {
  return runAction(async () => {
    const actor = await requireActor();
    const result = await submitInvoice(
      actor,
      {
        builderId: text(formData, "builderId") ?? "",
        projectId: text(formData, "projectId") ?? "",
        invoiceNumber: text(formData, "invoiceNumber") ?? "",
        invoiceDate: text(formData, "invoiceDate") ?? "",
        dueDate: text(formData, "dueDate"),
        amount: text(formData, "amount") ?? "",
        gstAmount: text(formData, "gstAmount"),
        description: text(formData, "description"),
        ...Object.fromEntries(INVOICE_DETAIL_FIELDS.map((field) => [field, text(formData, field)])),
      },
      await readFile(formData),
    );
    refresh();
    return result;
  }, "Invoice submitted to the builder for approval.");
}

export async function resubmitInvoiceAction(invoiceId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await resubmitInvoice(actor, invoiceId, { note: text(formData, "note") ?? "" }, await readFile(formData));
    refresh();
    return undefined;
  }, "Clarification sent. The invoice is back with the builder.");
}

export async function markUnderReviewAction(invoiceId: string): Promise<ActionResult> {
  return runAction(async () => {
    await markUnderReview(await requireActor(), invoiceId);
    refresh();
    return undefined;
  }, "Invoice marked as under review.");
}

export async function approveInvoiceAction(invoiceId: string, input: { approvedAmount?: string; comment?: string; attestations?: string[] }): Promise<ActionResult> {
  return runAction(async () => {
    await approveInvoice(await requireActor(), invoiceId, input);
    refresh();
    return undefined;
  }, "Invoice approved. The channel partner can now request early payment.");
}

export async function rejectInvoiceAction(invoiceId: string, input: { reason: string }): Promise<ActionResult> {
  return runAction(async () => {
    await rejectInvoice(await requireActor(), invoiceId, input);
    refresh();
    return undefined;
  }, "Invoice rejected. The channel partner can see your reason.");
}

export async function requestClarificationAction(invoiceId: string, input: { reason: string }): Promise<ActionResult> {
  return runAction(async () => {
    await requestClarification(await requireActor(), invoiceId, input);
    refresh();
    return undefined;
  }, "Clarification requested from the channel partner.");
}

export async function resolveDuplicateFlagAction(flagId: string, resolution: "CLEARED" | "CONFIRMED", input: { note: string }): Promise<ActionResult> {
  return runAction(async () => {
    await resolveDuplicateFlag(await requireActor(), flagId, { resolution, note: input.note });
    refresh();
    return undefined;
  }, resolution === "CLEARED" ? "Marked as not a duplicate." : "Recorded as a confirmed duplicate.");
}

export async function setMatchPolicyAction(programmeId: string, input: { attestationOptional: boolean }): Promise<ActionResult> {
  return runAction(async () => {
    await setMatchPolicy(await requireActor(), programmeId, input.attestationOptional);
    refresh();
    return undefined;
  }, input.attestationOptional ? "Three-way match is now optional for this programme." : "Three-way match is now required for this programme.");
}
