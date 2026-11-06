import "server-only";
import type { Actor } from "./auth/session";
import type { Tx } from "./db";

export interface AuditEntry {
  action: string;
  entityType: "Organisation" | "User" | "Invoice" | "InvoiceDocument" |"FinancingProgramme" | "FinancingOffer" | "FinancingRequest" | "Disbursement" | "Settlement" | "PlatformSetting" | "Session";
  entityId: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

function serialiseMetadata(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null;
  return JSON.stringify(metadata, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
}

export async function recordAudit(tx: Tx, actor: Actor | null, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: actor?.userId ?? null,
      actorName: actor?.name ?? "System",
      actorOrgId: actor?.orgId ?? null,
      actorRole: actor?.role ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      metadata: serialiseMetadata(entry.metadata),
    },
  });
}
