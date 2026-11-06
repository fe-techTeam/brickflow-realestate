import "server-only";
import { recordAudit } from "../audit";
import type { Actor } from "../auth/session";
import { db } from "../db";
import { invalid } from "../errors";
import { isPdf, MAX_PDF_BYTES, newStorageKey, QUARANTINE_SCOPE, sha256, storage } from "../storage";
import { ClamavUnavailableError, clamavConfigFromEnv, scanWithClamd } from "./clamav";
import { inspectPdf, maxPdfPagesFromEnv, type PdfRejectionReason } from "./pdf-inspect";
import type { UploadedFile } from "./types";

export type { UploadedFile } from "./types";

export interface AcceptedDocument {
  storageKey: string;
  fileName: string;
  mimeType: "application/pdf";
  sizeBytes: number;
  sha256: string;
  pageCount: number;
  scanStatus: "CLEAN" | "NOT_SCANNED";
  validatedAt: Date;
}

type RejectionReason = PdfRejectionReason | "malware" | "scan_unavailable";

const MALWARE_MESSAGE = "This file failed the security scan and was rejected. Upload a clean copy of the invoice.";
const SCAN_UNAVAILABLE_MESSAGE = "We couldn't complete the security scan of this file. Please try again shortly.";

let warnedUnscanned = false;

function reject(message: string): never {
  throw invalid(message, { file: [message.replace(/\.$/, "")] });
}

/** Presence, size and file-signature checks that run before anything is stored. */
export function assertPdfUpload(file: UploadedFile | null | undefined): UploadedFile {
  if (!file || file.bytes.length === 0) reject("Attach the invoice PDF.");
  if (file.bytes.length > MAX_PDF_BYTES) reject("The PDF must be 10 MB or smaller.");
  if (!isPdf(file.bytes)) reject("Only PDF documents are accepted.");
  return file;
}

export function safeFileName(name: string): string {
  const base = name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(-120);
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

async function recordRejection(
  actor: Actor,
  entry: { quarantineId: string; reason: RejectionReason; detail?: string; digest: string; file: UploadedFile; fileName: string; context: { invoiceId?: string; invoiceNumber?: string } },
) {
  const metadata = {
    reason: entry.reason,
    detail: entry.detail ?? null,
    sha256: entry.digest,
    sizeBytes: entry.file.bytes.length,
    fileName: entry.fileName,
    invoiceId: entry.context.invoiceId ?? null,
    invoiceNumber: entry.context.invoiceNumber ?? null,
  };
  console.warn(JSON.stringify({ level: "warn", event: "invoice.document_rejected", actorUserId: actor.userId, actorOrgId: actor.orgId, ...metadata }));
  try {
    await db.$transaction(async (tx) => {
      await recordAudit(tx, actor, {
        action: "invoice.document_rejected",
        entityType: "InvoiceDocument",
        entityId: entry.quarantineId,
        summary: `Rejected uploaded document ${entry.fileName}${entry.context.invoiceNumber ? ` for invoice ${entry.context.invoiceNumber}` : ""} (${entry.reason.replace(/_/g, " ")})`,
        metadata,
      });
    });
  } catch (error) {
    console.error("[uploads] failed to record the rejection audit entry", error);
  }
}

/**
 * Quarantined upload pipeline: the file is stored under the quarantine scope, checked (signature,
 * size, PDF structure, page count, optional antivirus) and only then moved to the clean invoices
 * scope. Rejected files are deleted, audited and reported to the user as a field error on `file`.
 */
export async function acceptInvoiceDocument(actor: Actor, rawFile: UploadedFile, context: { invoiceId?: string; invoiceNumber?: string } = {}): Promise<AcceptedDocument> {
  const file = assertPdfUpload(rawFile);
  const digest = sha256(file.bytes);
  const fileName = safeFileName(file.name);
  const quarantineKey = newStorageKey(QUARANTINE_SCOPE, "pdf");
  const quarantineId = quarantineKey.slice(quarantineKey.lastIndexOf("/") + 1).replace(/\.pdf$/, "");
  const store = storage();

  await store.put(quarantineKey, file.bytes, "application/pdf");

  const refuse = async (reason: RejectionReason, message: string, detail?: string): Promise<never> => {
    await store.delete(quarantineKey).catch(() => undefined);
    await recordRejection(actor, { quarantineId, reason, detail, digest, file, fileName, context });
    reject(message);
  };

  const inspection = await inspectPdf(file.bytes, { maxPages: maxPdfPagesFromEnv() });
  if (!inspection.ok) return refuse(inspection.reason, inspection.message, inspection.detail);

  let scanStatus: AcceptedDocument["scanStatus"] = "NOT_SCANNED";
  const clamav = clamavConfigFromEnv();
  if (clamav) {
    try {
      const result = await scanWithClamd(file.bytes, clamav);
      if (!result.clean) return refuse("malware", MALWARE_MESSAGE, result.signature);
      scanStatus = "CLEAN";
    } catch (error) {
      const detail = error instanceof ClamavUnavailableError ? error.message : String(error);
      return refuse("scan_unavailable", SCAN_UNAVAILABLE_MESSAGE, detail);
    }
  } else if (process.env.NODE_ENV === "production" && !warnedUnscanned) {
    warnedUnscanned = true;
    console.warn("[uploads] WARNING: CLAMAV_HOST is not set; uploaded documents are NOT virus-scanned.");
  }

  const storageKey = newStorageKey("invoices", "pdf");
  try {
    await store.move(quarantineKey, storageKey);
  } catch (error) {
    await store.delete(quarantineKey).catch(() => undefined);
    throw error;
  }

  return {
    storageKey,
    fileName,
    mimeType: "application/pdf",
    sizeBytes: file.bytes.length,
    sha256: digest,
    pageCount: inspection.pageCount,
    scanStatus,
    validatedAt: new Date(),
  };
}

/** Best-effort removal of a promoted document whose database record could not be written. */
export async function discardDocument(storageKey: string): Promise<void> {
  await storage()
    .delete(storageKey)
    .catch((error) => console.error("[uploads] failed to discard stored document", storageKey, error));
}
