import "server-only";
import type { Actor } from "../auth/session";
import { requireStepUp, type StepUpPurpose as AuthStepUpPurpose } from "../auth/step-up";

export type StepUpPurpose =
  | "financing.offer_accept"
  | "financing.approve"
  | "financing.reject"
  | "disbursement.initiate"
  | "disbursement.complete"
  | "settlement.settle";

/**
 * Step-up for money-moving financing actions, delegating to `requireStepUp`. Accepting an offer and
 * releasing a payout (initiating and completing a disbursement) require a fresh confirmation;
 * approval, rejection and settlement recording do not.
 */
const REQUIRED: Record<StepUpPurpose, AuthStepUpPurpose | null> = {
  "financing.offer_accept": "offer.accept",
  "disbursement.initiate": "payout.release",
  "disbursement.complete": "payout.release",
  "financing.approve": null,
  "financing.reject": null,
  "settlement.settle": null,
};

export async function assertStepUp(actor: Actor, purpose: StepUpPurpose): Promise<void> {
  const required = REQUIRED[purpose];
  if (required) await requireStepUp(actor, required);
}
