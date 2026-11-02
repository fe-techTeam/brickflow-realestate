import "server-only";
import type { Tx } from "./db";

export type ReferenceKind = "invoice" | "offer" | "request" | "payment" | "programme";

const PREFIX: Record<ReferenceKind, string> = {
  invoice: "BF-INV",
  offer: "BF-OFR",
  request: "BF-FIN",
  payment: "BFPAY-DEMO",
  programme: "BF-PRG",
};

/** Allocates the next human-readable reference inside the caller's transaction, e.g. BF-INV-2026-000042. */
export async function nextReference(tx: Tx, kind: ReferenceKind, now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const name = kind === "programme" ? kind : `${kind}:${year}`;
  const row = await tx.sequence.upsert({
    where: { name },
    create: { name, value: 1 },
    update: { value: { increment: 1 } },
  });
  const serial = String(row.value).padStart(kind === "programme" ? 4 : 6, "0");
  return kind === "programme" ? `${PREFIX[kind]}-${serial}` : `${PREFIX[kind]}-${year}-${serial}`;
}
