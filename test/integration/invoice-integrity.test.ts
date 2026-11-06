import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { computeFingerprint } from "@/lib/invoice-integrity/fingerprint";
import { MATCH_ITEM_KEYS, type MatchAttestation } from "@/lib/invoice-integrity/match";
import { getApplicableProgramme } from "@/server/services/financing";
import {
  checkFingerprint,
  getMatchPolicy,
  listDuplicateFlags,
  listMatchPolicyProgrammes,
  listRejectedUploads,
  resolveDuplicateFlag,
  setMatchPolicy,
} from "@/server/services/invoice-integrity";
import { approveInvoice, submitInvoice, type SubmitInvoiceInput, type UploadedFile } from "@/server/services/invoices";
import { actors, ATTESTED, auditActions, expectDomainError, expectValidationError, invoicePdf, isoDate, orgId, uniqueInvoiceNumber, type BuilderKey, type DemoUser } from "./helpers";

let as: Record<DemoUser, Actor>;

beforeAll(async () => {
  as = await actors();
});

const PROJECT_CODE: Record<BuilderKey, string> = { godrej: "GFH", skyline: "RGD", coastal: "SBV" };

async function baseInput(builder: BuilderKey, overrides: Partial<SubmitInvoiceInput> = {}): Promise<SubmitInvoiceInput> {
  const builderId = await orgId(builder);
  const project = await db.project.findFirstOrThrow({ where: { builderId, code: PROJECT_CODE[builder] } });
  return {
    builderId,
    projectId: project.id,
    invoiceNumber: uniqueInvoiceNumber(`INT-${builder}`),
    invoiceDate: isoDate(-8),
    dueDate: isoDate(50),
    amount: "500000",
    description: "Brokerage on sale of unit B-1104",
    ...overrides,
  };
}

/** ₹5,00,000 at 18% with a 2% brokerage on the agreement, intra-state (Maharashtra → Maharashtra). */
const INTRA_PARTICULARS: Partial<SubmitInvoiceInput> = {
  taxableValue: "423728.81",
  cgst: "38135.59",
  sgst: "38135.60",
  gstRate: "18",
  tdsRate: "2",
  bookingTower: "B",
  bookingUnit: "1104",
  buyerInitials: "r.k.",
  agreementRegistrationNumber: "HVL-2/4821/2026",
  agreementDate: isoDate(-30),
  agreementValue: "21186400",
  agreementBrokerageRate: "2",
};

async function pdfFor(invoiceNumber: string, builder: BuilderKey = "godrej", cp: "prestige" | "urbannest" = "prestige"): Promise<UploadedFile> {
  const bytes = await invoicePdf({ invoiceNumber, cp, builder, amountPaise: 5_00_000_00n, invoiceDate: isoDate(-8) });
  return { name: `${invoiceNumber.replace(/\//g, "-")}.pdf`, type: "application/pdf", bytes };
}

async function submit(actor: Actor, input: SubmitInvoiceInput, file?: UploadedFile) {
  return submitInvoice(actor, input, file ?? (await pdfFor(input.invoiceNumber, undefined, actor.email.includes("urbannest") ? "urbannest" : "prestige")));
}

async function fieldErrorsOf(promise: Promise<unknown>): Promise<Record<string, string[]>> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe("VALIDATION");
  return (error as DomainError).fieldErrors ?? {};
}

describe("brokerage particulars on submission", () => {
  it("stores booking, agreement, GST split and e-invoice details", async () => {
    const irn = "c".repeat(64);
    const input = await baseInput("godrej", { ...INTRA_PARTICULARS, irn: irn.toUpperCase(), ackNumber: "112010036595310", ackDate: isoDate(-8) });
    const { id } = await submit(as.prestige, input);
    const stored = await db.invoice.findUniqueOrThrow({ where: { id }, include: { documents: true, fingerprint: true } });

    expect(stored).toMatchObject({
      bookingTower: "B",
      bookingUnit: "1104",
      buyerInitials: "RK",
      agreementRegistrationNumber: "HVL-2/4821/2026",
      agreementValuePaise: 2_11_86_400_00n,
      agreementBrokerageBps: 200,
      taxableValuePaise: 4_23_728_81n,
      cgstPaise: 38_135_59n,
      sgstPaise: 38_135_60n,
      igstPaise: 0n,
      gstAmountPaise: 76_271_19n,
      gstRateBps: 1800,
      tdsRateBps: 200,
      irn,
      eInvoiceAckNumber: "112010036595310",
      placeOfSupplyStateCode: "27",
      supplierGstin: "27AAPFP9005H1Z6",
      recipientGstin: "27AAACG9002E1Z3",
    });
    expect(stored.documents[0]).toMatchObject({ pageCount: 1, scanStatus: "NOT_SCANNED" });
    expect(stored.documents[0]!.validatedAt).toBeInstanceOf(Date);
    expect(stored.fingerprint?.fingerprint).toBe(
      computeFingerprint({
        supplierGstin: stored.supplierGstin,
        recipientGstin: stored.recipientGstin,
        cpId: stored.cpId,
        builderId: stored.builderId,
        invoiceNumber: stored.invoiceNumber,
        invoiceDate: stored.invoiceDate,
        totalPaise: stored.amountPaise,
        irn,
      }).fingerprint,
    );
  });

  it("derives the taxable value and GST rate when only the GST amount is given", async () => {
    const { id } = await submit(as.prestige, await baseInput("godrej", { gstAmount: "76271.19" }));
    const stored = await db.invoice.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({ taxableValuePaise: 4_23_728_81n, gstRateBps: 1800, cgstPaise: null, igstPaise: null, placeOfSupplyStateCode: "27" });
  });

  it("accepts IGST on an inter-state supply", async () => {
    const input = await baseInput("skyline", { taxableValue: "423728.81", igst: "76271.19", gstRate: "18" });
    const { id } = await submit(as.prestige, input, await pdfFor(input.invoiceNumber, "skyline"));
    expect(await db.invoice.findUniqueOrThrow({ where: { id } })).toMatchObject({ igstPaise: 76_271_19n, cgstPaise: 0n, placeOfSupplyStateCode: "29" });
  });

  it("rejects figures that do not reconcile", async () => {
    const base = await baseInput("godrej", INTRA_PARTICULARS);
    expect(await fieldErrorsOf(submit(as.prestige, { ...base, amount: "510000" }))).toHaveProperty("amount");
    expect(await fieldErrorsOf(submit(as.prestige, { ...base, gstAmount: "70000" }))).toHaveProperty("gstAmount");
    expect(await fieldErrorsOf(submit(as.prestige, { ...base, cgst: "", sgst: "", igst: "76271.19" }))).toHaveProperty("igst");
    expect(await fieldErrorsOf(submit(as.prestige, { ...base, agreementValue: "30000000" }))).toHaveProperty("agreementBrokerageRate");
    expect(await fieldErrorsOf(submit(as.prestige, { ...base, agreementDate: isoDate(-2) }))).toHaveProperty("agreementDate");
    expect(await fieldErrorsOf(submit(as.prestige, { ...base, irn: "12345" }))).toHaveProperty("irn");
    expect(await fieldErrorsOf(submit(as.prestige, { ...base, ackNumber: "112010036595310", ackDate: isoDate(-8) }))).toHaveProperty("irn");

    const interInput = await baseInput("skyline", INTRA_PARTICULARS);
    expect(await fieldErrorsOf(submit(as.prestige, interInput, await pdfFor(interInput.invoiceNumber, "skyline")))).toHaveProperty("cgst");

    expect(await db.invoice.count({ where: { invoiceNumber: base.invoiceNumber } })).toBe(0);
  });

  it("refuses buyer names and malformed booking fields", async () => {
    const base = await baseInput("godrej");
    await expectValidationError(submit(as.prestige, { ...base, buyerInitials: "Rahul Kumar" }), "buyerInitials");
    await expectValidationError(submit(as.prestige, { ...base, bookingUnit: "<script>" }), "bookingUnit");
    await expectValidationError(submit(as.prestige, { ...base, gstRate: "eighteen" }), "gstRate");
    await expectValidationError(submit(as.prestige, { ...base, placeOfSupply: "00" }), "placeOfSupply");
  });

  it("rejects a PDF with active content before creating the invoice", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.catalog.set(PDFName.of("OpenAction"), pdf.context.obj({ S: "JavaScript", JS: PDFString.of("app.alert(1)") }));
    const bytes = await pdf.save({ useObjectStreams: false });
    const input = await baseInput("godrej");

    await expectDomainError(submitInvoice(as.prestige, input, { name: "x.pdf", type: "application/pdf", bytes }), "VALIDATION", /scripts, automatic actions or embedded files/);
    expect(await db.invoice.count({ where: { invoiceNumber: input.invoiceNumber } })).toBe(0);
    const rejected = await listRejectedUploads(as.admin, 5);
    expect(rejected[0]).toMatchObject({ actorName: as.prestige.name, reason: "active_content" });
  });
});

describe("duplicate registry", () => {
  it("blocks an invoice whose canonical fingerprint is already registered", async () => {
    const input = await baseInput("godrej", { amount: "312345.67" });
    const first = await submit(as.prestige, input);
    const variant = { ...input, invoiceNumber: input.invoiceNumber.replace(/\//g, "-") };

    await expectDomainError(submit(as.prestige, variant), "CONFLICT", new RegExp(`matches ${first.reference}`));
    const check = await checkFingerprint({
      supplierGstin: "27AAPFP9005H1Z6",
      recipientGstin: "27AAACG9002E1Z3",
      cpId: as.prestige.orgId,
      builderId: input.builderId,
      invoiceNumber: variant.invoiceNumber,
      invoiceDate: new Date(`${input.invoiceDate}T00:00:00.000Z`),
      totalPaise: 312_345_67n,
    });
    expect(check.exact).toMatchObject({ invoiceId: first.id, reference: first.reference });
  });

  it("flags the same parties and amount within the window, but not outside it", async () => {
    const first = await submit(as.prestige, await baseInput("godrej", { amount: "287654.32", invoiceDate: isoDate(-20) }));
    const near = await submit(as.prestige, await baseInput("godrej", { amount: "287654.32", invoiceDate: isoDate(-17) }));
    const far = await submit(as.prestige, await baseInput("godrej", { amount: "287654.32", invoiceDate: isoDate(-60), dueDate: isoDate(10) }));
    const otherAmount = await submit(as.prestige, await baseInput("godrej", { amount: "287654.33", invoiceDate: isoDate(-20) }));

    const flags = await db.invoiceDuplicateFlag.findMany({ where: { invoiceId: near.id } });
    expect(flags).toEqual([expect.objectContaining({ kind: "NEAR_DUPLICATE", matchedInvoiceId: first.id, status: "OPEN" })]);
    expect(flags[0]!.detail).toMatch(/3 days apart/);
    expect(await db.invoiceDuplicateFlag.count({ where: { invoiceId: { in: [far.id, otherAmount.id] } } })).toBe(0);

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: near.id, action: "invoice.submitted" } });
    expect(JSON.parse(audit.metadata!).possibleDuplicates).toEqual([{ kind: "NEAR_DUPLICATE", matchedInvoiceId: first.id }]);
  });

  it("flags a reused IRN", async () => {
    const irn = "d".repeat(64);
    const first = await submit(as.prestige, await baseInput("godrej", { amount: "111111.11", irn }));
    const second = await submit(as.prestige, await baseInput("godrej", { amount: "222222.22", irn }));
    const flags = await db.invoiceDuplicateFlag.findMany({ where: { invoiceId: second.id } });
    expect(flags).toEqual([expect.objectContaining({ kind: "SAME_IRN", matchedInvoiceId: first.id })]);
  });

  it("flags the same PDF from a different partner and withholds other builders' details", async () => {
    const original = await baseInput("godrej", { amount: "199999.99" });
    const file = await pdfFor(original.invoiceNumber);
    const first = await submit(as.prestige, original, file);
    const copyInput = await baseInput("skyline", { amount: "177777.77" });
    const copy = await submitInvoice(as.urbannest, copyInput, file);

    const [flag] = await db.invoiceDuplicateFlag.findMany({ where: { invoiceId: copy.id } });
    expect(flag).toMatchObject({ kind: "SAME_DOCUMENT_OTHER_PARTNER", matchedInvoiceId: first.id });

    const builderView = await listDuplicateFlags(as.skyline, { invoiceId: copy.id });
    expect(builderView).toHaveLength(1);
    expect(builderView[0]).toMatchObject({ matched: null, matchedElsewhere: true });
    const adminView = await listDuplicateFlags(as.admin, { invoiceId: copy.id });
    expect(adminView[0]?.matched).toMatchObject({ id: first.id, reference: first.reference });

    expect(await listDuplicateFlags(as.godrej, { invoiceId: copy.id })).toEqual([]);
    await expectDomainError(listDuplicateFlags(as.prestige), "FORBIDDEN");
    await expectDomainError(listDuplicateFlags(as.finance), "FORBIDDEN");
  });

  it("lets the builder or the platform resolve a flag once, with an audit entry", async () => {
    const first = await submit(as.prestige, await baseInput("godrej", { amount: "254321.00" }));
    const second = await submit(as.prestige, await baseInput("godrej", { amount: "254321.00", invoiceDate: isoDate(-6) }));
    const flag = await db.invoiceDuplicateFlag.findFirstOrThrow({ where: { invoiceId: second.id, matchedInvoiceId: first.id } });

    await expectValidationError(resolveDuplicateFlag(as.godrej, flag.id, { resolution: "CLEARED", note: "ok" }), "note");
    await expectDomainError(resolveDuplicateFlag(as.skyline, flag.id, { resolution: "CLEARED", note: "Not ours to decide at all." }), "NOT_FOUND");
    await expectDomainError(resolveDuplicateFlag(as.prestige, flag.id, { resolution: "CLEARED", note: "Partner trying to clear it." }), "FORBIDDEN");

    await resolveDuplicateFlag(as.godrej, flag.id, { resolution: "CLEARED", note: "Separate bookings, units B-1104 and B-1202." });
    expect(await db.invoiceDuplicateFlag.findUniqueOrThrow({ where: { id: flag.id } })).toMatchObject({
      status: "CLEARED",
      reviewedById: as.godrej.userId,
      reviewNote: "Separate bookings, units B-1104 and B-1202.",
    });
    await expectDomainError(resolveDuplicateFlag(as.admin, flag.id, { resolution: "CONFIRMED", note: "Second opinion from the platform." }), "CONFLICT");
    expect(await auditActions(second.id)).toContain("invoice.duplicate_cleared");
  });

  it("registered a fingerprint for every seeded invoice", async () => {
    const seeded = await db.invoice.findMany({ where: { invoiceNumber: { in: ["GFH/2026/001", "GHZ/2026/014"] } }, include: { fingerprint: true } });
    expect(seeded).toHaveLength(2);
    for (const invoice of seeded) {
      expect(invoice.fingerprint?.fingerprint).toBe(
        computeFingerprint({
          supplierGstin: invoice.supplierGstin,
          recipientGstin: invoice.recipientGstin,
          cpId: invoice.cpId,
          builderId: invoice.builderId,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          totalPaise: invoice.amountPaise,
          irn: invoice.irn,
        }).fingerprint,
      );
    }
  });

  it("computes the same fingerprint in SQL as the migration backfill", async () => {
    const [invoice] = await db.invoice.findMany({ where: { irn: { not: null } }, take: 1 });
    expect(invoice).toBeDefined();
    const rows = await db.$queryRaw<{ fingerprint: string }[]>`
      SELECT encode(sha256(convert_to('v1|' || coalesce(i."supplierGstin", 'ORG:' || i."cpId") || '|' || coalesce(i."recipientGstin", 'ORG:' || i."builderId") || '|' ||
        upper(regexp_replace(i."invoiceNumber", '[^A-Za-z0-9]', '', 'g')) || '|' || to_char(i."invoiceDate", 'YYYY-MM-DD') || '|' || i."amountPaise"::text || '|' ||
        coalesce(lower(i."irn"), ''), 'UTF8')), 'hex') AS fingerprint
      FROM "Invoice" AS i WHERE i."id" = ${invoice!.id}`;
    expect(rows[0]?.fingerprint).toBe(
      computeFingerprint({
        supplierGstin: invoice!.supplierGstin,
        recipientGstin: invoice!.recipientGstin,
        cpId: invoice!.cpId,
        builderId: invoice!.builderId,
        invoiceNumber: invoice!.invoiceNumber,
        invoiceDate: invoice!.invoiceDate,
        totalPaise: invoice!.amountPaise,
        irn: invoice!.irn,
      }).fingerprint,
    );
  });
});

describe("three-way match", () => {
  let godrejProgrammeId: string;

  beforeAll(async () => {
    godrejProgrammeId = (await getApplicableProgramme(as.godrej.orgId))!.id;
  });

  afterAll(async () => {
    await db.invoiceMatchPolicy.deleteMany({ where: { programmeId: godrejProgrammeId } });
  });

  it("requires every match item before approval by default", async () => {
    const { id } = await submit(as.prestige, await baseInput("godrej", INTRA_PARTICULARS));
    expect((await getMatchPolicy(as.godrej.orgId)).required).toBe(true);

    const errors = await fieldErrorsOf(approveInvoice(as.godrej, id, { attestations: ["AMOUNT", "UNIT"] }));
    expect(errors.attestations?.[0]).toMatch(/agreement number, brokerage/);
    await expectDomainError(approveInvoice(as.godrej, id, { attestations: [...MATCH_ITEM_KEYS, "SIGNATURE"] }), "VALIDATION", /Unknown/);
    expect((await db.invoice.findUniqueOrThrow({ where: { id } })).status).toBe("SUBMITTED");
  });

  it("records who attested, when and what on the approval", async () => {
    const { id } = await submit(as.prestige, await baseInput("godrej", INTRA_PARTICULARS));
    await approveInvoice(as.godrej, id, { ...ATTESTED, comment: "Matched against booking register." });

    const approval = await db.invoiceApproval.findFirstOrThrow({ where: { invoiceId: id, action: "APPROVED" } });
    expect(approval).toMatchObject({ attestedById: as.godrej.userId, attestedByName: as.godrej.name });
    expect(approval.attestedAt).toBeInstanceOf(Date);
    const attestation = approval.attestation as unknown as MatchAttestation;
    expect(attestation).toMatchObject({ version: 1, required: true });
    expect(attestation.items.map((i) => i.key)).toEqual(MATCH_ITEM_KEYS);
    expect(attestation.items.find((i) => i.key === "UNIT")?.invoiceValue).toBe("Tower B · Unit 1104 · Buyer RK");
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: id, action: "invoice.approved" } });
    expect(JSON.parse(audit.metadata!).threeWayMatch).toMatchObject({ required: true, programmeId: godrejProgrammeId });
  });

  it("lets the platform make the match optional for a programme", async () => {
    await expectDomainError(setMatchPolicy(as.godrej, godrejProgrammeId, true), "FORBIDDEN");
    await setMatchPolicy(as.admin, godrejProgrammeId, true);
    expect(await getMatchPolicy(as.godrej.orgId)).toMatchObject({ required: false, programme: { id: godrejProgrammeId } });
    expect((await listMatchPolicyProgrammes(as.admin)).find((p) => p.id === godrejProgrammeId)?.attestationOptional).toBe(true);

    const bare = await submit(as.prestige, await baseInput("godrej"));
    await approveInvoice(as.godrej, bare.id, {});
    expect(await db.invoiceApproval.findFirstOrThrow({ where: { invoiceId: bare.id, action: "APPROVED" } })).toMatchObject({ attestedById: null, attestation: null });

    const partial = await submit(as.prestige, await baseInput("godrej"));
    await approveInvoice(as.godrej, partial.id, { attestations: ["AMOUNT"] });
    const recorded = (await db.invoiceApproval.findFirstOrThrow({ where: { invoiceId: partial.id, action: "APPROVED" } })).attestation as unknown as MatchAttestation;
    expect(recorded).toMatchObject({ required: false, items: [expect.objectContaining({ key: "AMOUNT" })] });

    await setMatchPolicy(as.admin, godrejProgrammeId, false);
    expect((await getMatchPolicy(as.godrej.orgId)).required).toBe(true);
    expect(await auditActions(godrejProgrammeId)).toEqual(expect.arrayContaining(["programme.match_policy_updated"]));
  });

  it("attested every seeded approval", async () => {
    const approvals = await db.invoiceApproval.findMany({ where: { action: "APPROVED", invoice: { invoiceNumber: { in: ["GFH/2026/002", "GHZ/2026/014"] } } } });
    expect(approvals.length).toBeGreaterThan(0);
    for (const approval of approvals) expect(approval.attestedById).toBe(approval.actorUserId);
  });
});
