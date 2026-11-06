import "server-only";
import type { PrimaryChange } from "./store";

/**
 * In-process events for KYC changes that other modules (notifications) react to. Listeners run after
 * the database transaction has committed; a failing listener is logged and never undoes the change.
 */
export const PAYOUT_ACCOUNT_CHANGED = "payout_account.changed" as const;

export type PayoutAccountChangedEvent = PrimaryChange & { type: typeof PAYOUT_ACCOUNT_CHANGED };

type Listener = (event: PayoutAccountChangedEvent) => void | Promise<void>;

const listeners = new Set<Listener>();

export function onPayoutAccountChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function emitPayoutAccountChanged(change: PrimaryChange): Promise<void> {
  const event: PayoutAccountChangedEvent = { type: PAYOUT_ACCOUNT_CHANGED, ...change };
  for (const listener of listeners) {
    try {
      await listener(event);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", component: "kyc", msg: "payout account listener failed", error: error instanceof Error ? error.message : String(error) }));
    }
  }
}
