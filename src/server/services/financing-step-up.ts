import "server-only";
import type { Actor } from "../auth/session";

export type StepUpPurpose =
  | "financing.offer_accept"
  | "financing.approve"
  | "financing.reject"
  | "disbursement.initiate"
  | "disbursement.complete"
  | "settlement.settle";

/**
 * Hook point for step-up authentication before a money-moving action. Intentionally a no-op until
 * the step-up service is available; it will then delegate to `requireStepUp(actor, purpose)` and
 * throw when the actor has not recently re-verified.
 */
export async function assertStepUp(actor: Actor, purpose: StepUpPurpose): Promise<void> {
  void actor;
  void purpose;
}
