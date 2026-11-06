import { readdir } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildInvoiceDocument, SAMPLE_INVOICES } from "@/lib/demo/catalogue";
import { renderBrokerageInvoicePdf } from "@/lib/pdf/brokerage-invoice";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { sha256, storage } from "@/server/storage";
import { actorFor } from "../../../test/integration/helpers";
import { startFakeClamd, type FakeClamd } from "../../../test/support/fake-clamd";
import { acceptInvoiceDocument, assertPdfUpload, discardDocument, safeFileName } from "./invoice-document";

let partner: Actor;
let validPdf: Uint8Array;
let clamd: FakeClamd | null = null;

beforeAll(async () => {
  partner = await actorFor("prestige");
  validPdf = await renderBrokerageInvoicePdf(buildInvoiceDocument(SAMPLE_INVOICES[0]!));
});

afterEach(async () => {
  delete process.env.CLAMAV_HOST;
  delete process.env.CLAMAV_PORT;
  delete process.env.CLAMAV_TIMEOUT_MS;
  await clamd?.close();
  clamd = null;
});

async function quarantinedFiles(): Promise<string[]> {
  const root = path.resolve(process.env.STORAGE_DIR!, "quarantine");
  try {
    return (await readdir(root, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function scriptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.catalog.set(PDFName.of("OpenAction"), doc.context.obj({ S: "JavaScript", JS: PDFString.of("app.alert(1)") }));
  return doc.save();
}

async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect(error).toMatchObject({ code: "VALIDATION" });
  return error as DomainError;
}

async function lastRejectionAudit(digest: string) {
  const rows = await db.auditLog.findMany({ where: { action: "invoice.document_rejected", actorUserId: partner.userId }, orderBy: { createdAt: "desc" }, take: 20 });
  const row = rows.find((r) => r.metadata && (JSON.parse(r.metadata) as { sha256: string }).sha256 === digest);
  return row ? { ...row, metadata: JSON.parse(row.metadata!) as Record<string, unknown> } : null;
}

describe("assertPdfUpload", () => {
  it("keeps the established messages for missing, oversized and non-PDF files", () => {
    expect(() => assertPdfUpload(null)).toThrow("Attach the invoice PDF.");
    expect(() => assertPdfUpload({ name: "x.pdf", type: "application/pdf", bytes: new Uint8Array(0) })).toThrow("Attach the invoice PDF.");
    expect(() => assertPdfUpload({ name: "x.pdf", type: "application/pdf", bytes: new TextEncoder().encode("<html>not a pdf</html>") })).toThrow("Only PDF documents are accepted.");
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(new TextEncoder().encode("%PDF-"));
    let caught: unknown = null;
    try {
      assertPdfUpload({ name: "x.pdf", type: "application/pdf", bytes: big });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ message: "The PDF must be 10 MB or smaller.", fieldErrors: { file: ["The PDF must be 10 MB or smaller"] } });
  });

  it("sanitises file names", () => {
    expect(safeFileName("../../etc/passwd")).toBe(".._.._etc_passwd.pdf");
    expect(safeFileName("Invoice 18.PDF")).toBe("Invoice 18.PDF");
  });
});

describe("acceptInvoiceDocument", () => {
  it("validates in quarantine and promotes a clean PDF", async () => {
    const accepted = await acceptInvoiceDocument(partner, { name: "GFH 001.pdf", type: "application/pdf", bytes: validPdf }, { invoiceNumber: "GFH/2026/001" });

    expect(accepted).toMatchObject({ fileName: "GFH 001.pdf", mimeType: "application/pdf", sizeBytes: validPdf.byteLength, sha256: sha256(validPdf), pageCount: 1, scanStatus: "NOT_SCANNED" });
    expect(accepted.storageKey).toMatch(/^invoices\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
    expect(Buffer.from(await storage().get(accepted.storageKey)).equals(Buffer.from(validPdf))).toBe(true);
    expect(await quarantinedFiles()).toEqual([]);

    await discardDocument(accepted.storageKey);
    await expect(storage().get(accepted.storageKey)).rejects.toThrow();
  });

  it("rejects active content, deletes the upload and records an audit entry", async () => {
    const bytes = await scriptedPdf();
    const error = await rejection(acceptInvoiceDocument(partner, { name: "script.pdf", type: "application/pdf", bytes }, { invoiceNumber: "INV/9" }));

    expect(error.message).toMatch(/scripts, automatic actions or embedded files/);
    expect(error.fieldErrors?.file?.[0]).toMatch(/scripts, automatic actions/);
    expect(await quarantinedFiles()).toEqual([]);
    const audit = await lastRejectionAudit(sha256(bytes));
    expect(audit).toMatchObject({ entityType: "InvoiceDocument", actorOrgId: partner.orgId });
    expect(audit?.metadata).toMatchObject({ reason: "active_content", fileName: "script.pdf", invoiceNumber: "INV/9", sizeBytes: bytes.byteLength });
  });

  it("marks the document clean when the antivirus scan passes", async () => {
    clamd = await startFakeClamd("clean");
    process.env.CLAMAV_HOST = "127.0.0.1";
    process.env.CLAMAV_PORT = String(clamd.port);
    const accepted = await acceptInvoiceDocument(partner, { name: "ok.pdf", type: "application/pdf", bytes: validPdf });
    expect(accepted.scanStatus).toBe("CLEAN");
    expect(clamd.received()?.equals(Buffer.from(validPdf))).toBe(true);
    await discardDocument(accepted.storageKey);
  });

  it("rejects files the antivirus flags", async () => {
    clamd = await startFakeClamd("infected");
    process.env.CLAMAV_HOST = "127.0.0.1";
    process.env.CLAMAV_PORT = String(clamd.port);
    const bytes = await PDFDocument.create().then(async (d) => (d.addPage(), d.save()));
    const error = await rejection(acceptInvoiceDocument(partner, { name: "eicar.pdf", type: "application/pdf", bytes }));
    expect(error.message).toMatch(/failed the security scan/);
    expect((await lastRejectionAudit(sha256(bytes)))?.metadata).toMatchObject({ reason: "malware", detail: "Eicar-Test-Signature" });
    expect(await quarantinedFiles()).toEqual([]);
  });

  it("fails closed when the configured scanner is unavailable", async () => {
    clamd = await startFakeClamd("silent");
    process.env.CLAMAV_HOST = "127.0.0.1";
    process.env.CLAMAV_PORT = String(clamd.port);
    process.env.CLAMAV_TIMEOUT_MS = "200";
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.setTitle("scanner offline");
    const bytes = await doc.save();
    const error = await rejection(acceptInvoiceDocument(partner, { name: "x.pdf", type: "application/pdf", bytes }));
    expect(error.message).toMatch(/try again shortly/);
    expect((await lastRejectionAudit(sha256(bytes)))?.metadata).toMatchObject({ reason: "scan_unavailable" });
  });
});
