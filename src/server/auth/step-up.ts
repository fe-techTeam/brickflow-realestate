import "server-only";
import { db } from "../db";
import { DomainError } from "../errors";
import { mfaEnforced, STEP_UP_WINDOW_MS } from "./config";
import type { Actor } from "./session";
import { isSessionActive } from "./sessions";

/**
 * Step-up confirmation for sensitive actions. A service calls `requireStepUp(actor, purpose)` before
 * acting; unless the user re-verified (authenticator code, or password for accounts without two-step
 * verification) in this session within `STEP_UP_WINDOW_MS`, it throws `StepUpRequiredError`.
 * Server actions surface that as `{ ok: false, code: "STEP_UP_REQUIRED" }`; the client then shows
 * `StepUpDialog` (components/security/step-up-dialog), which calls `confirmStepUpAction` and retries.
 *
 * Applies whenever `MFA_ENFORCED` is on, and always for users who have two-step verification. With
 * enforcement off, a user without an authenticator is not asked (there is no second factor to check),
 * which keeps the shared demo accounts usable.
 */
export const STEP_UP_PURPOSES = ["offer.accept", "bank.change", "invoice.approve", "payout.release", "mfa.disable", "mfa.recovery_codes"] as const;

export type StepUpPurpose = (typeof STEP_UP_PURPOSES)[number];

export const STEP_UP_PURPOSE_LABELS: Record<StepUpPurpose, string> = {
  "offer.accept": "accept this early-payment offer",
  "bank.change": "change bank account details",
  "invoice.approve": "approve this invoice",
  "payout.release": "release this payout",
  "mfa.disable": "turn off two-step verification",
  "mfa.recovery_codes": "generate new recovery codes",
};

export function isStepUpPurpose(value: unknown): value is StepUpPurpose {
  return typeof value === "string" && (STEP_UP_PURPOSES as readonly string[]).includes(value);
}

export class StepUpRequiredError extends DomainError {
  constructor(readonly purpose: StepUpPurpose) {
    super("STEP_UP_REQUIRED", `Verify your identity to ${STEP_UP_PURPOSE_LABELS[purpose]}.`);
  }
}

export async function requireStepUp(actor: Actor, purpose: StepUpPurpose, now: Date = new Date()): Promise<void> {
  if (!isStepUpPurpose(purpose)) throw new Error(`Unknown step-up purpose "${String(purpose)}"`);
  if (!mfaEnforced()) {
    const user = await db.user.findUnique({ where: { id: actor.userId }, select: { mfaEnabledAt: true } });
    if (!user?.mfaEnabledAt) return;
  }
  if (!actor.sessionId) throw new StepUpRequiredError(purpose);
  const session = await db.session.findUnique({ where: { id: actor.sessionId }, select: { userId: true, stepUpAt: true, revokedAt: true, expiresAt: true, lastSeenAt: true } });
  const fresh =
    session !== null &&
    session.userId === actor.userId &&
    isSessionActive(session, now) &&
    session.stepUpAt !== null &&
    now.getTime() - session.stepUpAt.getTime() <= STEP_UP_WINDOW_MS &&
    session.stepUpAt.getTime() <= now.getTime();
  if (!fresh) throw new StepUpRequiredError(purpose);
}
