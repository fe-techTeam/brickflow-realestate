import "server-only";
import { z } from "zod";
import type { InvoiceStatus, Prisma } from "@/generated/prisma/client";
import {
  AGREEMENT_NUMBER_PATTERN,
  BOOKING_TOWER_PATTERN,
  BOOKING_UNIT_PATTERN,
  BUYER_INITIALS_PATTERN,
  checkInvoiceConsistency,
  inferGstRateBps,
  normaliseBuyerInitials,
} from "@/lib/invoice-integrity/consistency";
import { gstinStateCode, isStateCode, normaliseGstin } from "@/lib/invoice-integrity/gst";
import { normaliseIrn } from "@/lib/invoice-integrity/irn";
import { describeMatchItems, isMatchItemKey, MATCH_ITEM_KEYS, type MatchAttestation, type MatchItemKey } from "@/lib/invoice-integrity/match";
import { parsePercentToBps, parseRupeesToPaise } from "@/lib/money";
import { recordAudit } from "../audit";
import { assertOrgType, type Actor } from "../auth/session";
import { db } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { nextReference } from "../sequence";
import { sha256 } from "../storage";
import { acceptInvoiceDocument, assertPdfUpload, discardDocument } from "../uploads/invoice-document";
import type { UploadedFile } from "../uploads/types";
import { checkFingerprint, flagPossibleDuplicates, getMatchPolicy, publishFingerprint, registerFingerprint } from "./invoice-integrity";

export type { UploadedFile } from "../uploads/types";

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .transform((v) => new Date(`${v}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "Enter a valid date");

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const optionalDate = z.preprocess(blankToUndefined, dateString.optional());

const amountString = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .transform((v, ctx) => {
      const paise = parseRupeesToPaise(v);
      if (paise === null) {
        ctx.addIssue({ code: "custom", message: `${label} must be a number with up to 2 decimals` });
        return z.NEVER;
      }
      return paise;
    });

const optionalAmount = (label: string) => z.preprocess(blankToUndefined, amountString(label).optional());

const optionalPercent = (label: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .transform((v, ctx) => {
        const bps = parsePercentToBps(v);
        if (bps === null) {
          ctx.addIssue({ code: "custom", message: `${label} must be a percentage with up to 2 decimals` });
          return z.NEVER;
        }
        return bps;
      })
      .optional(),
  );

const optionalText = (pattern: RegExp, message: string, transform: (v: string) => string = (v) => v.trim()) =>
  z.preprocess(blankToUndefined, z.string().transform(transform).pipe(z.string().regex(pattern, message)).optional());

export const submitInvoiceSchema = z
  .object({
    builderId: z.string().min(1, "Select a builder"),
    projectId: z.string().min(1, "Select a project"),
    invoiceNumber: z
      .string()
      .trim()
      .min(3, "Invoice number is required")
      .max(40, "Invoice number is too long")
      .regex(/^[A-Za-z0-9/_.-]+$/, "Use letters, numbers and / - _ . only"),
    invoiceDate: dateString,
    dueDate: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(dateString.optional()),
    amount: amountString("Invoice amount"),
    gstAmount: z
      .string()
      .optional()
      .transform((v) => (v && v.trim() ? v : undefined))
      .pipe(amountString("GST amount").optional()),
    description: z.string().trim().max(500, "Keep the description under 500 characters").optional(),

    bookingTower: optionalText(BOOKING_TOWER_PATTERN, "Use up to 20 letters, numbers, spaces and . _ -"),
    bookingUnit: optionalText(BOOKING_UNIT_PATTERN, "Use up to 20 letters, numbers, spaces and / . _ -"),
    buyerInitials: optionalText(BUYER_INITIALS_PATTERN, "Enter the buyer's initials only (up to 4 letters)", normaliseBuyerInitials),
    agreementRegistrationNumber: optionalText(AGREEMENT_NUMBER_PATTERN, "Use 3–40 letters, numbers, spaces and / . _ -"),
    agreementDate: optionalDate,
    agreementValue: optionalAmount("Agreement value"),
    agreementBrokerageRate: optionalPercent("Brokerage rate"),
    agreementBrokerageAmount: optionalAmount("Brokerage amount"),
    taxableValue: optionalAmount("Taxable value"),
    cgst: optionalAmount("CGST"),
    sgst: optionalAmount("SGST"),
    igst: optionalAmount("IGST"),
    gstRate: optionalPercent("GST rate"),
    tdsRate: optionalPercent("TDS rate"),
    irn: z.preprocess(blankToUndefined, z.string().transform((v) => normaliseIrn(v) ?? "").optional()),
    ackNumber: z.preprocess(blankToUndefined, z.string().trim().optional()),
    ackDate: optionalDate,
    placeOfSupply: z.preprocess(blankToUndefined, z.string().trim().refine(isStateCode, "Select a valid place of supply").optional()),
  })
  .superRefine((v, ctx) => {
    if (v.amount <= 0n) ctx.addIssue({ code: "custom", path: ["amount"], message: "Invoice amount must be greater than zero" });
    if (v.amount > 100_00_00_000_00n) ctx.addIssue({ code: "custom", path: ["amount"], message: "Invoice amount exceeds the ₹100 crore limit" });
    if (v.gstAmount !== undefined && v.gstAmount >= v.amount)
      ctx.addIssue({ code: "custom", path: ["gstAmount"], message: "GST must be less than the invoice total" });
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    if (v.invoiceDate > tomorrow) ctx.addIssue({ code: "custom", path: ["invoiceDate"], message: "Invoice date cannot be in the future" });
    if (v.dueDate && v.dueDate < v.invoiceDate)
      ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Due date must be on or after the invoice date" });
  });

export type SubmitInvoiceInput = z.input<typeof submitInvoiceSchema>;
type ParsedInvoiceInput = z.output<typeof submitInvoiceSchema>;

/** Builders and projects a channel partner is empanelled with and may invoice. */
export async function listInvoiceableBuilders(actor: Actor) {
  assertOrgType(actor, "CHANNEL_PARTNER");
  const relationships = await db.cpBuilderRelationship.findMany({
    where: { cpId: actor.orgId, status: "ACTIVE", builder: { status: "ACTIVE" } },
    include: {
      builder: {
        include: { projects: { where: { status: "ACTIVE" }, orderBy: { name: "asc" } } },
      },
    },
    orderBy: { builder: { name: "asc" } },
  });
  return relationships.map((r) => ({
    id: r.builder.id,
    name: r.builder.name,
    creditPeriodDays: r.creditPeriodDays,
    projects: r.builder.projects.map((p) => ({ id: p.id, name: p.name, code: p.code, city: p.city })),
  }));
}

/**
 * Tax and brokerage particulars to store, after cross-field checks against both organisations'
 * registered GSTINs. Throws a validation error with field messages when the invoice is inconsistent.
 */
export function resolveTaxParticulars(input: ParsedInvoiceInput, parties: { supplierGstin: string | null; recipientGstin: string | null }, today: Date = new Date()) {
  const issues = checkInvoiceConsistency({
    today,
    invoiceDate: input.invoiceDate,
    dueDate: input.dueDate ?? null,
    totalPaise: input.amount,
    gstAmountPaise: input.gstAmount ?? null,
    taxableValuePaise: input.taxableValue ?? null,
    cgstPaise: input.cgst ?? null,
    sgstPaise: input.sgst ?? null,
    igstPaise: input.igst ?? null,
    gstRateBps: input.gstRate ?? null,
    supplierGstin: parties.supplierGstin,
    recipientGstin: parties.recipientGstin,
    placeOfSupplyStateCode: input.placeOfSupply ?? null,
    agreementDate: input.agreementDate ?? null,
    agreementValuePaise: input.agreementValue ?? null,
    agreementBrokerageBps: input.agreementBrokerageRate ?? null,
    agreementBrokeragePaise: input.agreementBrokerageAmount ?? null,
    tdsRateBps: input.tdsRate ?? null,
    irn: input.irn ?? null,
    eInvoiceAckNumber: input.ackNumber ?? null,
    eInvoiceAckDate: input.ackDate ?? null,
  });
  if (issues.length) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of issues) (fieldErrors[issue.field] ??= []).push(issue.message);
    throw invalid(issues.length === 1 ? issues[0]!.message : "Some invoice figures don't agree. Please correct the highlighted fields.", fieldErrors);
  }

  const hasComponents = input.cgst !== undefined || input.sgst !== undefined || input.igst !== undefined;
  const gstAmount = hasComponents ? (input.cgst ?? 0n) + (input.sgst ?? 0n) + (input.igst ?? 0n) : (input.gstAmount ?? null);
  const taxable = input.taxableValue ?? (gstAmount !== null ? input.amount - gstAmount : null);
  return {
    gstAmountPaise: gstAmount,
    taxableValuePaise: taxable,
    cgstPaise: hasComponents ? (input.cgst ?? 0n) : null,
    sgstPaise: hasComponents ? (input.sgst ?? 0n) : null,
    igstPaise: hasComponents ? (input.igst ?? 0n) : null,
    gstRateBps: input.gstRate ?? (taxable !== null && gstAmount !== null ? inferGstRateBps(taxable, gstAmount) : null),
    placeOfSupplyStateCode: input.placeOfSupply ?? gstinStateCode(parties.recipientGstin),
    supplierGstin: parties.supplierGstin,
    recipientGstin: parties.recipientGstin,
    bookingTower: input.bookingTower ?? null,
    bookingUnit: input.bookingUnit ?? null,
    buyerInitials: input.buyerInitials ?? null,
    agreementRegistrationNumber: input.agreementRegistrationNumber ?? null,
    agreementDate: input.agreementDate ?? null,
    agreementValuePaise: input.agreementValue ?? null,
    agreementBrokerageBps: input.agreementBrokerageRate ?? null,
    agreementBrokeragePaise: input.agreementBrokerageAmount ?? null,
    tdsRateBps: input.tdsRate ?? null,
    irn: input.irn ?? null,
    eInvoiceAckNumber: input.ackNumber ?? null,
    eInvoiceAckDate: input.ackDate ?? null,
  } satisfies Partial<Prisma.InvoiceUncheckedCreateInput>;
}

export async function submitInvoice(actor: Actor, rawInput: SubmitInvoiceInput, rawFile: UploadedFile | null) {
  assertOrgType(actor, "CHANNEL_PARTNER");
  const input = submitInvoiceSchema.parse(rawInput);
  const file = assertPdfUpload(rawFile);

  const relationship = await db.cpBuilderRelationship.findUnique({
    where: { cpId_builderId: { cpId: actor.orgId, builderId: input.builderId } },
    include: { builder: true, cp: true },
  });
  if (!relationship || relationship.status !== "ACTIVE" || relationship.builder.status !== "ACTIVE") {
    throw invalid("You are not empanelled with this builder.", { builderId: ["You are not empanelled with this builder"] });
  }
  const project = await db.project.findFirst({ where: { id: input.projectId, builderId: input.builderId, status: "ACTIVE" } });
  if (!project) throw invalid("Select a project belonging to this builder.", { projectId: ["Select a valid project"] });

  const particulars = resolveTaxParticulars(input, {
    supplierGstin: normaliseGstin(relationship.cp.gstin),
    recipientGstin: normaliseGstin(relationship.builder.gstin),
  });

  const existing = await db.invoice.findUnique({
    where: { cpId_builderId_invoiceNumber: { cpId: actor.orgId, builderId: input.builderId, invoiceNumber: input.invoiceNumber } },
  });
  if (existing) {
    throw conflict(`Invoice ${input.invoiceNumber} has already been submitted to ${relationship.builder.name} (${existing.reference}).`);
  }

  const fingerprintSource = {
    supplierGstin: particulars.supplierGstin,
    recipientGstin: particulars.recipientGstin,
    cpId: actor.orgId,
    builderId: input.builderId,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    totalPaise: input.amount,
    irn: particulars.irn,
  };
  const fingerprint = await checkFingerprint(fingerprintSource);
  if (fingerprint.exact) {
    throw conflict(
      fingerprint.exact.cpId === actor.orgId
        ? `This invoice matches ${fingerprint.exact.reference}, which has already been submitted.`
        : "An identical invoice (same parties, number, date and total) is already registered on the platform.",
    );
  }

  const digest = sha256(file.bytes);
  const duplicateDoc = await db.invoiceDocument.findFirst({
    where: { sha256: digest, invoice: { cpId: actor.orgId, status: { not: "REJECTED" } } },
    include: { invoice: true },
  });
  if (duplicateDoc) {
    throw conflict(`This PDF was already submitted as invoice ${duplicateDoc.invoice.invoiceNumber} (${duplicateDoc.invoice.reference}).`);
  }

  const document = await acceptInvoiceDocument(actor, file, { invoiceNumber: input.invoiceNumber });

  try {
    const result = await db.$transaction(async (tx) => {
      const now = new Date();
      const reference = await nextReference(tx, "invoice", now);
      const invoice = await tx.invoice.create({
        data: {
          reference,
          invoiceNumber: input.invoiceNumber,
          cpId: actor.orgId,
          builderId: input.builderId,
          projectId: project.id,
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate ?? null,
          amountPaise: input.amount,
          description: input.description || null,
          ...particulars,
          status: "SUBMITTED",
          submittedAt: now,
          createdById: actor.userId,
          documents: {
            create: {
              fileName: document.fileName,
              storageKey: document.storageKey,
              mimeType: document.mimeType,
              sizeBytes: document.sizeBytes,
              sha256: document.sha256,
              pageCount: document.pageCount,
              scanStatus: document.scanStatus,
              validatedAt: document.validatedAt,
              uploadedById: actor.userId,
            },
          },
          approvals: {
            create: {
              action: "SUBMITTED",
              toStatus: "SUBMITTED",
              actorUserId: actor.userId,
              actorName: actor.name,
              actorOrgId: actor.orgId,
            },
          },
        },
      });
      const parts = await registerFingerprint(tx, invoice.id, fingerprintSource);
      const flags = await flagPossibleDuplicates(tx, { id: invoice.id, cpId: actor.orgId, parts, external: fingerprint.external, documentSha256: document.sha256 });
      await recordAudit(tx, actor, {
        action: "invoice.submitted",
        entityType: "Invoice",
        entityId: invoice.id,
        summary: `Submitted invoice ${invoice.invoiceNumber} (${reference}) to ${relationship.builder.name}`,
        metadata: {
          reference,
          amountPaise: invoice.amountPaise,
          builderId: input.builderId,
          projectId: project.id,
          fingerprint: parts.fingerprint,
          possibleDuplicates: flags.map((f) => ({ kind: f.kind, matchedInvoiceId: f.matchedInvoiceId })),
        },
      });
      return { id: invoice.id, reference, parts };
    });
    await publishFingerprint(result.parts, result.reference);
    return { id: result.id, reference: result.reference };
  } catch (error) {
    await discardDocument(document.storageKey);
    if (isUniqueViolation(error)) throw conflict("This invoice number has already been submitted to the builder.");
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

const responseSchema = z.object({
  note: z.string().trim().min(10, "Explain what was clarified (at least 10 characters)").max(1000),
});

/** CP response to a clarification request; optionally replaces the PDF and returns the invoice to the builder's inbox. */
export async function resubmitInvoice(actor: Actor, invoiceId: string, raw: { note: string }, rawFile: UploadedFile | null) {
  assertOrgType(actor, "CHANNEL_PARTNER");
  const { note } = responseSchema.parse(raw);
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { fingerprint: true } });
  if (!invoice || invoice.cpId !== actor.orgId) throw notFound("Invoice not found.");
  if (invoice.status !== "CLARIFICATION_REQUESTED") throw conflict("Only invoices awaiting clarification can be resubmitted.");

  const document = rawFile && rawFile.bytes.length > 0 ? await acceptInvoiceDocument(actor, assertPdfUpload(rawFile), { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber }) : null;

  try {
    await db.$transaction(async (tx) => {
      let possibleDuplicates: Awaited<ReturnType<typeof flagPossibleDuplicates>> = [];
      const updated = await tx.invoice.updateMany({
        where: { id: invoice.id, status: "CLARIFICATION_REQUESTED" },
        data: { status: "SUBMITTED", submittedAt: new Date(), latestReviewNote: null },
      });
      if (updated.count !== 1) throw conflict("This invoice has already been resubmitted.");
      if (document) {
        await tx.invoiceDocument.create({
          data: {
            invoiceId: invoice.id,
            fileName: document.fileName,
            storageKey: document.storageKey,
            mimeType: document.mimeType,
            sizeBytes: document.sizeBytes,
            sha256: document.sha256,
            pageCount: document.pageCount,
            scanStatus: document.scanStatus,
            validatedAt: document.validatedAt,
            uploadedById: actor.userId,
          },
        });
        if (invoice.fingerprint) {
          possibleDuplicates = await flagPossibleDuplicates(tx, { id: invoice.id, cpId: invoice.cpId, parts: invoice.fingerprint, documentSha256: document.sha256 });
        }
      }
      await tx.invoiceApproval.create({
        data: {
          invoiceId: invoice.id,
          action: "RESUBMITTED",
          fromStatus: "CLARIFICATION_REQUESTED",
          toStatus: "SUBMITTED",
          comment: note,
          actorUserId: actor.userId,
          actorName: actor.name,
          actorOrgId: actor.orgId,
        },
      });
      await recordAudit(tx, actor, {
        action: "invoice.resubmitted",
        entityType: "Invoice",
        entityId: invoice.id,
        summary: `Responded to clarification on invoice ${invoice.invoiceNumber}`,
        metadata: { replacedDocument: Boolean(document), possibleDuplicates: possibleDuplicates.map((f) => ({ kind: f.kind, matchedInvoiceId: f.matchedInvoiceId })) },
      });
    });
  } catch (error) {
    if (document) await discardDocument(document.storageKey);
    throw error;
  }
}

const REVIEWABLE: InvoiceStatus[] = ["SUBMITTED", "UNDER_REVIEW"];

async function loadForBuilder(actor: Actor, invoiceId: string) {
  assertOrgType(actor, "BUILDER");
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.builderId !== actor.orgId) throw notFound("Invoice not found.");
  return invoice;
}

function assertStatus(status: InvoiceStatus, allowed: InvoiceStatus[]) {
  if (!allowed.includes(status)) throw conflict(`This invoice is already ${status.replace(/_/g, " ").toLowerCase()} and cannot be updated.`);
}

async function transition(
  actor: Actor,
  invoiceId: string,
  options: {
    from: InvoiceStatus[];
    to: InvoiceStatus;
    action: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "CLARIFICATION_REQUESTED";
    comment?: string;
    data?: Prisma.InvoiceUpdateManyMutationInput;
    approval?: Pick<Prisma.InvoiceApprovalUncheckedCreateInput, "attestedById" | "attestedByName" | "attestedAt" | "attestation">;
    audit: { action: string; summary: (invoiceNumber: string) => string; metadata?: Record<string, unknown> };
  },
) {
  const invoice = await loadForBuilder(actor, invoiceId);
  assertStatus(invoice.status, options.from);
  await db.$transaction(async (tx) => {
    const updated = await tx.invoice.updateMany({
      where: { id: invoice.id, status: { in: options.from } },
      data: { status: options.to, ...options.data },
    });
    if (updated.count !== 1) throw conflict("This invoice was updated by someone else. Refresh and try again.");
    await tx.invoiceApproval.create({
      data: {
        invoiceId: invoice.id,
        action: options.action,
        fromStatus: invoice.status,
        toStatus: options.to,
        comment: options.comment ?? null,
        actorUserId: actor.userId,
        actorName: actor.name,
        actorOrgId: actor.orgId,
        ...options.approval,
      },
    });
    await recordAudit(tx, actor, {
      action: options.audit.action,
      entityType: "Invoice",
      entityId: invoice.id,
      summary: options.audit.summary(invoice.invoiceNumber),
      metadata: options.audit.metadata,
    });
  });
}

export async function markUnderReview(actor: Actor, invoiceId: string) {
  await transition(actor, invoiceId, {
    from: ["SUBMITTED"],
    to: "UNDER_REVIEW",
    action: "UNDER_REVIEW",
    audit: { action: "invoice.under_review", summary: (n) => `Started review of invoice ${n}` },
  });
}

const approveSchema = z.object({
  approvedAmount: z.string().optional(),
  comment: z.string().trim().max(1000).optional(),
  /** Three-way match items the builder ticked (see MATCH_ITEMS). */
  attestations: z.array(z.string()).max(MATCH_ITEM_KEYS.length * 2).optional(),
});

export async function approveInvoice(actor: Actor, invoiceId: string, raw: z.input<typeof approveSchema>) {
  const input = approveSchema.parse(raw);
  const invoice = await loadForBuilder(actor, invoiceId);
  let approved = invoice.amountPaise;
  if (input.approvedAmount && input.approvedAmount.trim()) {
    const parsed = parseRupeesToPaise(input.approvedAmount);
    if (parsed === null || parsed <= 0n) throw invalid("Enter a valid approved amount.", { approvedAmount: ["Enter a valid amount"] });
    if (parsed > invoice.amountPaise)
      throw invalid("Approved amount cannot exceed the invoice amount.", { approvedAmount: ["Cannot exceed the invoice amount"] });
    approved = parsed;
  }
  assertStatus(invoice.status, REVIEWABLE);

  const ticked = new Set<MatchItemKey>();
  for (const key of input.attestations ?? []) {
    if (!isMatchItemKey(key)) throw invalid("Unknown three-way match item.", { attestations: ["Unknown match item"] });
    ticked.add(key);
  }
  const policy = await getMatchPolicy(invoice.builderId);
  const missing = MATCH_ITEM_KEYS.filter((key) => !ticked.has(key));
  if (policy.required && missing.length) {
    const labels = describeMatchItems(invoice).filter((i) => missing.includes(i.key)).map((i) => i.label.toLowerCase());
    throw invalid("Complete the three-way match before approving.", { attestations: [`Still to confirm: ${labels.join(", ")}`] });
  }
  const now = new Date();
  const attestation: MatchAttestation | null = ticked.size
    ? {
        version: 1,
        required: policy.required,
        items: describeMatchItems(invoice)
          .filter((i) => ticked.has(i.key))
          .map((i) => ({ key: i.key, label: i.label, invoiceValue: i.invoiceValue })),
      }
    : null;

  await transition(actor, invoiceId, {
    from: REVIEWABLE,
    to: "ACCEPTED",
    action: "APPROVED",
    comment: input.comment || undefined,
    data: { approvedAmountPaise: approved, decidedAt: now, latestReviewNote: input.comment || null },
    approval: attestation
      ? { attestedById: actor.userId, attestedByName: actor.name, attestedAt: now, attestation: attestation as unknown as Prisma.InputJsonValue }
      : undefined,
    audit: {
      action: "invoice.approved",
      summary: (n) => `Approved invoice ${n}`,
      metadata: {
        approvedAmountPaise: approved,
        invoiceAmountPaise: invoice.amountPaise,
        threeWayMatch: { required: policy.required, programmeId: policy.programme?.id ?? null, attested: [...ticked] },
      },
    },
  });
}

const reasonSchema = z.object({
  reason: z.string().trim().min(10, "Provide a reason of at least 10 characters").max(1000, "Keep the reason under 1000 characters"),
});

export async function rejectInvoice(actor: Actor, invoiceId: string, raw: { reason: string }) {
  const { reason } = reasonSchema.parse(raw);
  await transition(actor, invoiceId, {
    from: REVIEWABLE,
    to: "REJECTED",
    action: "REJECTED",
    comment: reason,
    data: { decidedAt: new Date(), latestReviewNote: reason },
    audit: { action: "invoice.rejected", summary: (n) => `Rejected invoice ${n}`, metadata: { reason } },
  });
}

export async function requestClarification(actor: Actor, invoiceId: string, raw: { reason: string }) {
  const { reason } = reasonSchema.parse(raw);
  await transition(actor, invoiceId, {
    from: REVIEWABLE,
    to: "CLARIFICATION_REQUESTED",
    action: "CLARIFICATION_REQUESTED",
    comment: reason,
    data: { latestReviewNote: reason },
    audit: { action: "invoice.clarification_requested", summary: (n) => `Requested clarification on invoice ${n}`, metadata: { reason } },
  });
}

/* ----------------------------------------------------------------------------------------------
 * Read access. Every query is scoped to what the actor's organisation may see.
 * -------------------------------------------------------------------------------------------- */

/** Prisma filter restricting invoices to the actor's visibility. */
export function invoiceScope(actor: Actor): Prisma.InvoiceWhereInput {
  switch (actor.orgType) {
    case "CHANNEL_PARTNER":
      return { cpId: actor.orgId };
    case "BUILDER":
      return { builderId: actor.orgId, status: { not: "DRAFT" } };
    case "FINANCIER":
      return { builder: { builderProgrammes: { some: { financierId: actor.orgId } } }, status: "ACCEPTED" };
    case "PLATFORM":
      return {};
    default:
      throw forbidden();
  }
}

export interface InvoiceListFilters {
  status?: InvoiceStatus | InvoiceStatus[];
  financingStatus?: Prisma.InvoiceWhereInput["financingStatus"];
  search?: string;
  builderId?: string;
  cpId?: string;
  projectId?: string;
}

export const invoiceListInclude = {
  cp: { select: { id: true, name: true } },
  builder: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, code: true } },
  financingRequest: {
    select: {
      id: true,
      reference: true,
      status: true,
      discountRateBps: true,
      netPayablePaise: true,
      disbursement: { select: { reference: true, status: true, completedAt: true } },
      settlement: { select: { status: true, dueDate: true, settledAt: true } },
    },
  },
} satisfies Prisma.InvoiceInclude;

export async function listInvoices(actor: Actor, filters: InvoiceListFilters = {}) {
  const and: Prisma.InvoiceWhereInput[] = [invoiceScope(actor)];
  if (filters.status) and.push({ status: Array.isArray(filters.status) ? { in: filters.status } : filters.status });
  if (filters.financingStatus) and.push({ financingStatus: filters.financingStatus });
  if (filters.builderId) and.push({ builderId: filters.builderId });
  if (filters.cpId) and.push({ cpId: filters.cpId });
  if (filters.projectId) and.push({ projectId: filters.projectId });
  if (filters.search?.trim()) {
    const q = filters.search.trim();
    and.push({
      OR: [
        { invoiceNumber: { contains: q, mode: "insensitive" } },
        { reference: { contains: q, mode: "insensitive" } },
        { cp: { name: { contains: q, mode: "insensitive" } } },
        { builder: { name: { contains: q, mode: "insensitive" } } },
        { project: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  return db.invoice.findMany({
    where: { AND: and },
    include: invoiceListInclude,
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
  });
}

export type InvoiceListItem = Awaited<ReturnType<typeof listInvoices>>[number];

export async function getInvoiceDetail(actor: Actor, invoiceId: string) {
  const invoice = await db.invoice.findFirst({
    where: { AND: [{ id: invoiceId }, invoiceScope(actor)] },
    include: {
      cp: true,
      builder: true,
      project: true,
      documents: { orderBy: { createdAt: "desc" } },
      approvals: { orderBy: { createdAt: "asc" } },
      offers: { orderBy: { generatedAt: "desc" }, include: { programme: { include: { financier: { select: { id: true, name: true } } } } } },
      financingRequest: {
        include: {
          financier: { select: { id: true, name: true } },
          programme: { select: { id: true, code: true, name: true } },
          disbursement: true,
          settlement: true,
          events: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!invoice) throw notFound("Invoice not found.");
  return invoice;
}

export type InvoiceDetail = Awaited<ReturnType<typeof getInvoiceDetail>>;

/** Returns document metadata if the actor may download it. */
export async function getDocumentForActor(actor: Actor, documentId: string) {
  const document = await db.invoiceDocument.findUnique({ where: { id: documentId }, include: { invoice: true } });
  if (!document) throw notFound("Document not found.");
  const visible = await db.invoice.count({ where: { AND: [{ id: document.invoiceId }, invoiceScope(actor)] } });
  if (!visible) throw notFound("Document not found.");
  return document;
}
