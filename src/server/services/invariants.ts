import "server-only";
import { db } from "../db";
import { checkFinancingInvariants, type InvariantReport } from "../invariants/financing-invariants";

export type { InvariantCode, InvariantReport, InvariantViolation } from "../invariants/financing-invariants";

/** Runs the financing invariant scan against the application database. */
export async function runInvariantChecks(now: Date = new Date()): Promise<InvariantReport> {
  return checkFinancingInvariants(db, now);
}
