import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import {
  approveInvoice,
  getDocumentForActor,
  getInvoiceDetail,
  listInvoiceableBuilders,
  listInvoices,
  markUnderReview,
  rejectInvoice,
  requestClarification,
  resubmitInvoice,
  submitInvoice,
} from "@/server/services/invoices";
import { storage } from "@/server/storage";
import {
  actors,
  auditActions,
  expectDomainError,
  expectValidationError,
  invoicePdf,
  isoDate,
  orgId,
  submitTestInvoice,
  uniqueInvoiceNumber,
  type DemoUser,
} from "./helpers";

let as: Record<DemoUser, Actor>;

beforeAll(async () => {
  as = await actors();
});

describe("invoice upload", () => {
  it("submits an invoice with a generated brokerage PDF", async () => {
    const invoice = await submitTestInvoice(as.prestige, { amount: "5,00,000", gstAmount: "76271.19" });

    expect(invoice.reference).toMatch(/^BF-INV-\d{4}-\d{6}$/);
    const stored = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { documents: true, approvals: true } });
    expect(stored).toMatchObject({
      invoiceNumber: invoice.invoiceNumber,
      cpId: as.prestige.orgId,
      builderId: as.godrej.orgId,
      status: "SUBMITTED",
      financingStatus: "NOT_REQUESTED",
      amountPaise: 5_00_000_00n,
      gstAmountPaise: 76_271_19n,
      approvedAmountPaise: null,
      createdById: as.prestige.userId,
    });
    expect(stored.documents).toHaveLength(1);
    expect(stored.documents[0]).toMatchObject({ mimeType: "application/pdf", sizeBytes: invoice.file.bytes.length });
    expect(stored.documents[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.approvals.map((a) => a.action)).toEqual(["SUBMITTED"]);
    expect(await auditActions(invoice.id)).toEqual(["invoice.submitted"]);
  });

  it("lists only the builders and projects the partner is empanelled with", async () => {
    const builders = await listInvoiceableBuilders(as.prestige);
    expect(builders.map((b) => b.name).sort()).toEqual(["Godrej Properties Demo", "Skyline Habitat Developers"]);
    expect(builders.find((b) => b.id === as.godrej.orgId)).toMatchObject({ creditPeriodDays: 60 });
    await expectDomainError(listInvoiceableBuilders(as.godrej), "FORBIDDEN");
  });

  it("rejects a file that is not a PDF", async () => {
    const project = await db.project.findFirstOrThrow({ where: { builderId: as.godrej.orgId } });
    const input = { builderId: as.godrej.orgId, projectId: project.id, invoiceNumber: uniqueInvoiceNumber("NOPDF"), invoiceDate: isoDate(-5), amount: "100000" };
    const notPdf = { name: "invoice.pdf", type: "application/pdf", bytes: new TextEncoder().encode("<html>not a pdf</html>") };

    await expectDomainError(submitInvoice(as.prestige, input, notPdf), "VALIDATION", /Only PDF documents/);
    await expectDomainError(submitInvoice(as.prestige, input, null), "VALIDATION", /Attach the invoice PDF/);
    expect(await db.invoice.count({ where: { invoiceNumber: input.invoiceNumber } })).toBe(0);
  });

  it("validates the invoice fields", async () => {
    const project = await db.project.findFirstOrThrow({ where: { builderId: as.godrej.orgId } });
    const pdf = { name: "x.pdf", type: "application/pdf", bytes: await invoicePdf({ invoiceNumber: "VAL/1", cp: "prestige", builder: "godrej", amountPaise: 1_00n, invoiceDate: isoDate(-1) }) };
    const base = { builderId: as.godrej.orgId, projectId: project.id, invoiceNumber: uniqueInvoiceNumber("VAL"), invoiceDate: isoDate(-5), amount: "1000" };

    await expectValidationError(submitInvoice(as.prestige, { ...base, amount: "0" }, pdf), "amount");
    await expectValidationError(submitInvoice(as.prestige, { ...base, amount: "12.345" }, pdf), "amount");
    await expectValidationError(submitInvoice(as.prestige, { ...base, invoiceDate: isoDate(5) }, pdf), "invoiceDate");
    await expectValidationError(submitInvoice(as.prestige, { ...base, dueDate: isoDate(-6) }, pdf), "dueDate");
    await expectValidationError(submitInvoice(as.prestige, { ...base, gstAmount: "1000" }, pdf), "gstAmount");
    await expectValidationError(submitInvoice(as.prestige, { ...base, invoiceNumber: "bad number!" }, pdf), "invoiceNumber");
  });

  it("refuses builders the partner is not empanelled with and foreign projects", async () => {
    const coastalId = await orgId("coastal");
    const coastalProject = await db.project.findFirstOrThrow({ where: { builderId: coastalId } });
    const pdf = { name: "x.pdf", type: "application/pdf", bytes: await invoicePdf({ invoiceNumber: "EMP/1", cp: "prestige", builder: "coastal", amountPaise: 1_00_000_00n, invoiceDate: isoDate(-3) }) };
    const input = { builderId: coastalId, projectId: coastalProject.id, invoiceNumber: uniqueInvoiceNumber("EMP"), invoiceDate: isoDate(-3), amount: "100000" };

    await expectDomainError(submitInvoice(as.prestige, input, pdf), "VALIDATION", /not empanelled/);
    await expectDomainError(submitInvoice(as.prestige, { ...input, builderId: as.godrej.orgId }, pdf), "VALIDATION", /project belonging to this builder/);
    await expectDomainError(submitInvoice(as.godrej, input, pdf), "FORBIDDEN");
  });

  it("prevents duplicate invoice numbers and duplicate PDFs", async () => {
    const first = await submitTestInvoice(as.prestige);

    const samePdfNewNumber = submitInvoice(
      as.prestige,
      { builderId: first.builderId, projectId: first.projectId, invoiceNumber: uniqueInvoiceNumber("DUPPDF"), invoiceDate: isoDate(-10), amount: "500000" },
      first.file,
    );
    await expectDomainError(samePdfNewNumber, "CONFLICT", /already submitted as invoice/);

    const sameNumber = submitTestInvoice(as.prestige, { invoiceNumber: first.invoiceNumber, amount: "1000" });
    await expectDomainError(sameNumber, "CONFLICT", /already been submitted/);

    expect(await db.invoice.count({ where: { cpId: as.prestige.orgId, invoiceNumber: first.invoiceNumber } })).toBe(1);
  });
});

describe("invoice documents", () => {
  it("serves the stored PDF to the owner, the builder and the platform", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    const detail = await getInvoiceDetail(as.prestige, invoice.id);
    const documentId = detail.documents[0]!.id;

    for (const actor of [as.prestige, as.godrej, as.admin]) {
      const document = await getDocumentForActor(actor, documentId);
      const bytes = await storage().get(document.storageKey);
      expect(Buffer.from(bytes).equals(Buffer.from(invoice.file.bytes))).toBe(true);
    }
  });

  it("hides the PDF from other partners, other builders and the financier before acceptance", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    const documentId = (await getInvoiceDetail(as.prestige, invoice.id)).documents[0]!.id;

    await expectDomainError(getDocumentForActor(as.urbannest, documentId), "NOT_FOUND");
    await expectDomainError(getDocumentForActor(as.skyline, documentId), "NOT_FOUND");
    await expectDomainError(getDocumentForActor(as.finance, documentId), "NOT_FOUND");
    await expectDomainError(getDocumentForActor(as.prestige, "missing-document"), "NOT_FOUND");
  });

  it("serves seeded invoice PDFs from storage", async () => {
    const seeded = await db.invoiceDocument.findFirstOrThrow({ where: { invoice: { invoiceNumber: "GFH/2026/001" } } });
    const document = await getDocumentForActor(as.prestige, seeded.id);
    const bytes = await storage().get(document.storageKey);
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(bytes.byteLength).toBe(seeded.sizeBytes);
  });
});

describe("builder review", () => {
  it("approves the full invoice amount", async () => {
    const invoice = await submitTestInvoice(as.prestige, { amount: "350000" });
    await markUnderReview(as.godrej, invoice.id);
    await approveInvoice(as.godrej, invoice.id, { comment: "Verified." });

    const stored = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { approvals: { orderBy: { createdAt: "asc" } } } });
    expect(stored).toMatchObject({ status: "ACCEPTED", approvedAmountPaise: 3_50_000_00n, latestReviewNote: "Verified." });
    expect(stored.decidedAt).toBeInstanceOf(Date);
    expect(stored.approvals.map((a) => [a.action, a.fromStatus, a.toStatus])).toEqual([
      ["SUBMITTED", null, "SUBMITTED"],
      ["UNDER_REVIEW", "SUBMITTED", "UNDER_REVIEW"],
      ["APPROVED", "UNDER_REVIEW", "ACCEPTED"],
    ]);
    expect(await auditActions(invoice.id)).toEqual(["invoice.submitted", "invoice.under_review", "invoice.approved"]);
  });

  it("approves a partial amount", async () => {
    const invoice = await submitTestInvoice(as.prestige, { amount: "420000" });
    await approveInvoice(as.godrej, invoice.id, { approvedAmount: "4,00,000", comment: "Capped as per empanelment schedule." });
    const stored = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(stored).toMatchObject({ status: "ACCEPTED", amountPaise: 4_20_000_00n, approvedAmountPaise: 4_00_000_00n });
  });

  it("refuses an approved amount above the invoice amount or not positive", async () => {
    const invoice = await submitTestInvoice(as.prestige, { amount: "100000" });
    await expectDomainError(approveInvoice(as.godrej, invoice.id, { approvedAmount: "100000.01" }), "VALIDATION", /cannot exceed/);
    await expectDomainError(approveInvoice(as.godrej, invoice.id, { approvedAmount: "0" }), "VALIDATION");
    await expectDomainError(approveInvoice(as.godrej, invoice.id, { approvedAmount: "ten" }), "VALIDATION");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("SUBMITTED");
  });

  it("rejects with a mandatory reason", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    await expectValidationError(rejectInvoice(as.godrej, invoice.id, { reason: "too short" }), "reason");
    await expectValidationError(rejectInvoice(as.godrej, invoice.id, { reason: "          " }), "reason");

    const reason = "Brokerage slab does not match the empanelment schedule.";
    await rejectInvoice(as.godrej, invoice.id, { reason });
    const stored = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { approvals: true } });
    expect(stored).toMatchObject({ status: "REJECTED", latestReviewNote: reason, approvedAmountPaise: null });
    expect(stored.approvals.find((a) => a.action === "REJECTED")).toMatchObject({ comment: reason, actorOrgId: as.godrej.orgId });
    expect(await auditActions(invoice.id)).toContain("invoice.rejected");
  });

  it("blocks double approval and decisions on decided invoices", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    await approveInvoice(as.godrej, invoice.id, {});
    await expectDomainError(approveInvoice(as.godrej, invoice.id, {}), "CONFLICT", /already accepted/);
    await expectDomainError(rejectInvoice(as.godrej, invoice.id, { reason: "Changed our mind about this one." }), "CONFLICT");
    await expectDomainError(markUnderReview(as.godrej, invoice.id), "CONFLICT");
    expect((await db.invoiceApproval.count({ where: { invoiceId: invoice.id, action: "APPROVED" } }))).toBe(1);
  });

  it("allows only one of two concurrent approvals to succeed", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    const results = await Promise.allSettled([approveInvoice(as.godrej, invoice.id, {}), approveInvoice(as.godrej, invoice.id, {})]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.invoiceApproval.count({ where: { invoiceId: invoice.id, action: "APPROVED" } })).toBe(1);
  });

  it("lets the partner see each decision", async () => {
    const approved = await submitTestInvoice(as.prestige);
    const rejected = await submitTestInvoice(as.prestige);
    await approveInvoice(as.godrej, approved.id, { approvedAmount: "450000" });
    await rejectInvoice(as.godrej, rejected.id, { reason: "Duplicate of an invoice paid last quarter." });

    const approvedDetail = await getInvoiceDetail(as.prestige, approved.id);
    expect(approvedDetail).toMatchObject({ status: "ACCEPTED", approvedAmountPaise: 4_50_000_00n, financingStatus: "NOT_REQUESTED" });
    expect(approvedDetail.approvals.at(-1)).toMatchObject({ action: "APPROVED", actorName: as.godrej.name });

    const rejectedDetail = await getInvoiceDetail(as.prestige, rejected.id);
    expect(rejectedDetail).toMatchObject({ status: "REJECTED", latestReviewNote: "Duplicate of an invoice paid last quarter." });

    const accepted = await listInvoices(as.prestige, { status: "ACCEPTED" });
    expect(accepted.map((i) => i.id)).toContain(approved.id);
    expect(accepted.map((i) => i.id)).not.toContain(rejected.id);
    expect(accepted.every((i) => i.cp.id === as.prestige.orgId && i.status === "ACCEPTED")).toBe(true);

    const search = await listInvoices(as.prestige, { search: approved.invoiceNumber });
    expect(search.map((i) => i.id)).toEqual([approved.id]);
  });
});

describe("clarification loop", () => {
  it("returns the invoice to the builder after the partner responds", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    await expectDomainError(resubmitInvoice(as.prestige, invoice.id, { note: "Nothing was requested yet." }, null), "CONFLICT");

    const question = "Please attach the registered agreement copy for unit B-1104.";
    await requestClarification(as.godrej, invoice.id, { reason: question });
    expect(await getInvoiceDetail(as.prestige, invoice.id)).toMatchObject({ status: "CLARIFICATION_REQUESTED", latestReviewNote: question });

    await expectValidationError(resubmitInvoice(as.prestige, invoice.id, { note: "ok" }, null), "note");
    await expectDomainError(
      resubmitInvoice(as.prestige, invoice.id, { note: "Agreement copy attached as requested." }, { name: "x.pdf", type: "application/pdf", bytes: new Uint8Array([1, 2, 3, 4, 5]) }),
      "VALIDATION",
      /Only PDF/,
    );

    const replacement = await invoicePdf({ invoiceNumber: `${invoice.invoiceNumber}-R`, cp: "prestige", builder: "godrej", amountPaise: 5_00_000_00n, invoiceDate: isoDate(-10) });
    await resubmitInvoice(as.prestige, invoice.id, { note: "Agreement copy attached as requested." }, { name: "revised.pdf", type: "application/pdf", bytes: replacement });

    const detail = await getInvoiceDetail(as.godrej, invoice.id);
    expect(detail).toMatchObject({ status: "SUBMITTED", latestReviewNote: null });
    expect(detail.documents).toHaveLength(2);
    expect(detail.documents[0]!.fileName).toBe("revised.pdf");
    expect(detail.approvals.map((a) => a.action)).toEqual(["SUBMITTED", "CLARIFICATION_REQUESTED", "RESUBMITTED"]);
    expect(await auditActions(invoice.id)).toEqual(["invoice.submitted", "invoice.clarification_requested", "invoice.resubmitted"]);

    await expectDomainError(resubmitInvoice(as.prestige, invoice.id, { note: "Responding a second time." }, null), "CONFLICT");
    await approveInvoice(as.godrej, invoice.id, {});
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("ACCEPTED");
  });
});

describe("cross-organisation access", () => {
  it("hides one partner's invoice from another partner", async () => {
    const invoice = await submitTestInvoice(as.prestige);

    await expectDomainError(getInvoiceDetail(as.urbannest, invoice.id), "NOT_FOUND");
    await expectDomainError(resubmitInvoice(as.urbannest, invoice.id, { note: "Trying to respond for someone else." }, null), "NOT_FOUND");
    expect((await listInvoices(as.urbannest)).map((i) => i.id)).not.toContain(invoice.id);
    expect((await listInvoices(as.urbannest)).every((i) => i.cp.id === as.urbannest.orgId)).toBe(true);
  });

  it("stops another builder from reviewing the invoice", async () => {
    const invoice = await submitTestInvoice(as.prestige);

    await expectDomainError(approveInvoice(as.skyline, invoice.id, {}), "NOT_FOUND");
    await expectDomainError(rejectInvoice(as.skyline, invoice.id, { reason: "Not our invoice at all, rejecting." }), "NOT_FOUND");
    await expectDomainError(requestClarification(as.skyline, invoice.id, { reason: "Not our invoice at all, asking." }), "NOT_FOUND");
    await expectDomainError(getInvoiceDetail(as.skyline, invoice.id), "NOT_FOUND");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("SUBMITTED");
  });

  it("stops partners, the financier and the admin from acting as the builder", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    for (const actor of [as.prestige, as.finance, as.admin]) {
      await expectDomainError(approveInvoice(actor, invoice.id, {}), "FORBIDDEN");
    }
  });

  it("scopes each workspace's invoice list", async () => {
    const [godrej, finance, admin] = await Promise.all([listInvoices(as.godrej), listInvoices(as.finance), listInvoices(as.admin)]);
    expect(godrej.length).toBeGreaterThan(0);
    expect(godrej.every((i) => i.builder.id === as.godrej.orgId)).toBe(true);
    expect(finance.length).toBeGreaterThan(0);
    expect(finance.every((i) => i.status === "ACCEPTED")).toBe(true);
    expect(admin.length).toBe(await db.invoice.count());
  });
});
