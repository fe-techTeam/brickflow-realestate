"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { KycStatus, VerificationCheckStatus } from "@/generated/prisma/client";
import { runAction, type ActionResult } from "../action-result";
import { requireActor } from "../auth/session";
import { reviewVerificationCheck, setPrimaryBankAccount, submitBankAccount, submitGstin, submitPan, submitReraRegistration, submitUdyam, type UploadedDocument } from "../services/kyc";

type CheckResult = { status: VerificationCheckStatus | null; kycStatus: KycStatus; reasons: string[] };

async function requestId(): Promise<string> {
  const incoming = (await headers()).get("x-request-id");
  return incoming && /^[A-Za-z0-9._-]{8,128}$/.test(incoming) ? incoming : randomUUID();
}

function refresh() {
  revalidatePath("/", "layout");
}

const MESSAGES: Record<VerificationCheckStatus, string> = {
  VERIFIED: "Verified successfully.",
  REVIEW_REQUIRED: "Submitted. Our team will review the details shortly.",
  PENDING: "Submitted for review.",
  FAILED: "We could not verify these details.",
  REJECTED: "Rejected.",
  ERROR: "Verification could not be completed.",
};

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

async function file(formData: FormData, field: string): Promise<UploadedDocument | null> {
  const value = formData.get(field);
  if (!(value instanceof File) || value.size === 0) return null;
  return { name: value.name, type: value.type, bytes: new Uint8Array(await value.arrayBuffer()) };
}

async function respond(run: () => Promise<{ status?: VerificationCheckStatus; kycStatus: KycStatus; reasons?: string[] }>): Promise<ActionResult<CheckResult>> {
  let message: string | undefined;
  const result = await runAction(async () => {
    const outcome = await run();
    refresh();
    message = outcome.status ? MESSAGES[outcome.status] : "Saved.";
    return { status: outcome.status ?? null, kycStatus: outcome.kycStatus, reasons: outcome.reasons ?? [] };
  });
  return result.ok ? { ...result, message } : result;
}

export async function submitGstinAction(input: { gstin?: string; notRegistered?: boolean }): Promise<ActionResult<CheckResult>> {
  return respond(async () => submitGstin(await requireActor(), input, { requestId: await requestId() }));
}

export async function submitPanAction(input: { pan: string }): Promise<ActionResult<CheckResult>> {
  return respond(async () => submitPan(await requireActor(), input, { requestId: await requestId() }));
}

export async function submitUdyamAction(input: { udyamNumber: string }): Promise<ActionResult<CheckResult>> {
  return respond(async () => submitUdyam(await requireActor(), input, { requestId: await requestId() }));
}

export async function submitBankAccountAction(input: {
  accountNumber: string;
  confirmAccountNumber: string;
  ifsc: string;
  accountHolderName?: string;
  makePrimary?: boolean;
}): Promise<ActionResult<CheckResult>> {
  return respond(async () => submitBankAccount(await requireActor(), input, { requestId: await requestId() }));
}

export async function submitReraAction(formData: FormData): Promise<ActionResult<CheckResult>> {
  return respond(async () =>
    submitReraRegistration(await requireActor(), { registrationNumber: text(formData, "registrationNumber"), validUntil: text(formData, "validUntil") }, await file(formData, "certificate"), {
      requestId: await requestId(),
    }),
  );
}

export async function setPrimaryBankAccountAction(bankAccountId: string): Promise<ActionResult> {
  return runAction(async () => {
    await setPrimaryBankAccount(await requireActor(), bankAccountId, { requestId: await requestId() });
    refresh();
    return undefined;
  }, "Payout account updated. Early payments pause during the security cooling-off period.");
}

export async function approveVerificationAction(checkId: string, input: { note?: string }): Promise<ActionResult> {
  return runAction(async () => {
    await reviewVerificationCheck(await requireActor(), checkId, { decision: "APPROVE", note: input.note });
    refresh();
    return undefined;
  }, "Verification approved.");
}

export async function rejectVerificationAction(checkId: string, input: { reason: string }): Promise<ActionResult> {
  return runAction(async () => {
    await reviewVerificationCheck(await requireActor(), checkId, { decision: "REJECT", note: input.reason });
    refresh();
    return undefined;
  }, "Verification rejected.");
}
