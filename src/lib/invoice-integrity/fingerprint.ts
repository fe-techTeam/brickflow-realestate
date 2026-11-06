/**
 * Canonical invoice fingerprint (node only; uses node:crypto).
 *
 * fingerprint = SHA-256 of
 *   "v1|<supplier>|<recipient>|<number>|<yyyy-mm-dd>|<total paise>|<irn>"
 * where supplier/recipient are the normalised GSTINs (or "ORG:<organisation id>" when an
 * organisation has no GSTIN), number keeps only letters and digits in upper case (so
 * "inv/2026-001" and "INV 2026 001" collide), and irn is the lower-case IRN or empty.
 *
 * The migration that backfills existing invoices computes the same string in SQL; keep both in step
 * and bump FINGERPRINT_VERSION when the format changes.
 */
import { createHash } from "node:crypto";
import { financialYear, normaliseGstin } from "./gst";
import { normaliseIrn } from "./irn";

export const FINGERPRINT_VERSION = 1;

export interface FingerprintSource {
  supplierGstin: string | null | undefined;
  recipientGstin: string | null | undefined;
  /** Used in place of a missing supplier GSTIN. */
  cpId: string;
  /** Used in place of a missing recipient GSTIN. */
  builderId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  totalPaise: bigint;
  irn?: string | null;
}

export interface FingerprintParts {
  fingerprint: string;
  version: number;
  supplierKey: string;
  recipientKey: string;
  numberKey: string;
  invoiceDate: Date;
  totalPaise: bigint;
  irn: string | null;
}

export function normaliseInvoiceNumber(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function partyKey(gstin: string | null | undefined, organisationId: string): string {
  return normaliseGstin(gstin) ?? `ORG:${organisationId}`;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function canonicalFingerprintInput(source: FingerprintSource): string {
  return [
    `v${FINGERPRINT_VERSION}`,
    partyKey(source.supplierGstin, source.cpId),
    partyKey(source.recipientGstin, source.builderId),
    normaliseInvoiceNumber(source.invoiceNumber),
    isoDay(source.invoiceDate),
    source.totalPaise.toString(),
    normaliseIrn(source.irn) ?? "",
  ].join("|");
}

export function computeFingerprint(source: FingerprintSource): FingerprintParts {
  return {
    fingerprint: createHash("sha256").update(canonicalFingerprintInput(source), "utf8").digest("hex"),
    version: FINGERPRINT_VERSION,
    supplierKey: partyKey(source.supplierGstin, source.cpId),
    recipientKey: partyKey(source.recipientGstin, source.builderId),
    numberKey: normaliseInvoiceNumber(source.invoiceNumber),
    invoiceDate: new Date(`${isoDay(source.invoiceDate)}T00:00:00.000Z`),
    totalPaise: source.totalPaise,
    irn: normaliseIrn(source.irn),
  };
}

/**
 * IRN as the IRP derives it: SHA-256 of supplier GSTIN, financial year, document type and number.
 * Used to give generated sample invoices a realistic IRN.
 */
export function deriveIrn(supplierGstin: string, invoiceDate: Date, invoiceNumber: string, documentType: "INV" | "CRN" | "DBN" = "INV"): string {
  return createHash("sha256")
    .update(`${normaliseGstin(supplierGstin)}${financialYear(invoiceDate)}${documentType}${invoiceNumber.trim()}`, "utf8")
    .digest("hex");
}
