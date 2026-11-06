import "server-only";
import { appendAuditEntry, AuditChainIntegrityError } from "@/lib/audit-chain";
import type { Actor } from "./auth/session";
import type { Tx } from "./db";
import { logger } from "./observability/logger";

export interface AuditEntry {
  action: string;
  entityType: "Organisation" | "User" | "Invoice" | "FinancingProgramme" | "FinancingOffer" | "FinancingRequest" | "Disbursement" | "Settlement" | "PlatformSetting" | "Session" | "AuditLog";
  entityId: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

function serialiseMetadata(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null;
  return JSON.stringify(metadata, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
}

/**
 * Appends an entry to the hash-chained audit log inside the caller's transaction. Concurrent writers are
 * serialised by a transaction-scoped advisory lock, so call this late in the transaction to keep the
 * lock window short.
 */
export async function recordAudit(tx: Tx, actor: Actor | null, entry: AuditEntry): Promise<void> {
  try {
    await appendAuditEntry(tx, {
      actorUserId: actor?.userId ?? null,
      actorName: actor?.name ?? "System",
      actorOrgId: actor?.orgId ?? null,
      actorRole: actor?.role ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      metadata: serialiseMetadata(entry.metadata),
    });
  } catch (error) {
    // Fail closed: the state change is rolled back together with the refused audit entry.
    if (error instanceof AuditChainIntegrityError) {
      logger.error("audit.chain_append_refused", { err: error, code: error.code, seq: error.seq, action: entry.action, entityType: entry.entityType, entityId: entry.entityId });
    }
    throw error;
  }
}
