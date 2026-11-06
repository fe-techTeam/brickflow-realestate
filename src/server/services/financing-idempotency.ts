import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../auth/session";
import { db, type Tx } from "../db";
import { conflict } from "../errors";

/** Client-generated key sent with a money-moving action; a UUID or similar opaque token. */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{16,128}$/, "Invalid request reference. Refresh the page and try again.");

export type IdempotencyScope =
  | "offer.accept"
  | "request.approve"
  | "request.reject"
  | "disbursement.initiate"
  | "disbursement.complete"
  | "settlement.settle";

/** Records the claimed key inside the caller's state-changing transaction. */
export type ClaimKey = (tx: Tx, resultId: string) => Promise<void>;

interface IdempotencyContext {
  actor: Actor;
  scope: IdempotencyScope;
  key?: string | null;
  /** Everything that defines the request; reusing a key with a different payload is refused. */
  payload: unknown;
}

function fingerprintOf(scope: IdempotencyScope, payload: unknown): string {
  return createHash("sha256").update(JSON.stringify([scope, payload])).digest("hex");
}

async function findClaim(actorUserId: string, scope: IdempotencyScope, key: string) {
  return db.financingIdempotencyKey.findUnique({ where: { actorUserId_scope_key: { actorUserId, scope, key } } });
}

/**
 * Runs a state change at most once per (user, scope, key). The body must call `claim` inside the
 * transaction that performs the change, so the key and the change commit or roll back together.
 *
 * A submission whose key was already claimed returns `replay(resultId)` without running the body.
 * Two concurrent submissions with the same key race on the state change's conditional update and
 * the key's unique index; the loser's error is swallowed and it replays the winner's result.
 * Failed attempts claim nothing, so the client may retry with the same key.
 */
export async function runIdempotent<T>(
  context: IdempotencyContext,
  body: (claim: ClaimKey) => Promise<T>,
  replay: (resultId: string | null) => Promise<T>,
): Promise<T> {
  if (!context.key) return body(async () => undefined);
  const key = idempotencyKeySchema.parse(context.key);
  const { actor, scope } = context;
  const fingerprint = fingerprintOf(scope, context.payload);

  const replayClaim = async (claim: { fingerprint: string; resultId: string | null }) => {
    if (claim.fingerprint !== fingerprint) {
      throw conflict("This submission reference was already used for a different action. Refresh the page and try again.");
    }
    return replay(claim.resultId);
  };

  const existing = await findClaim(actor.userId, scope, key);
  if (existing) return replayClaim(existing);

  try {
    return await body(async (tx, resultId) => {
      await tx.financingIdempotencyKey.create({ data: { actorUserId: actor.userId, scope, key, fingerprint, resultId } });
    });
  } catch (error) {
    const winner = await findClaim(actor.userId, scope, key);
    if (winner) return replayClaim(winner);
    throw error;
  }
}

/** Removes replay records older than the cut-off; for the scheduled housekeeping job. */
export async function purgeIdempotencyKeys(olderThan: Date): Promise<number> {
  const { count } = await db.financingIdempotencyKey.deleteMany({ where: { createdAt: { lt: olderThan } } });
  return count;
}
