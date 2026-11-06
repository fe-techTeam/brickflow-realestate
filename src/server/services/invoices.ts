import "server-only";
import { z } from "zod";
import type { InvoiceStatus, Prisma } from "@/generated/prisma/client";
import { parseRupeesToPaise } from "@/lib/money";
import { recordAudit } from "../audit";
import { assertOrgType, type Actor } from "../auth/session";
import { authorize } from "../auth/permissions";
import { db } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { nextReference } from "../sequence";
import { isPdf, MAX_PDF_BYTES, newStorageKey, sha256, storage } from "../storage";

export interface UploadedFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .transform((v) => new Date(`${v}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "Enter a valid date");

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

function validatePdf(file: UploadedFile | null | undefined): UploadedFile {
  if (!file || file.bytes.length === 0) throw invalid("Attach the invoice PDF.", { file: ["Attach the invoice PDF"] });
  if (file.bytes.length > MAX_PDF_BYTES) throw invalid("The PDF must be 10 MB or smaller.", { file: ["The PDF must be 10 MB or smaller"] });
  if (!isPdf(file.bytes)) throw invalid("Only PDF documents are accepted.", { file: ["Only PDF documents are accepted"] });
  return file;
}

function safeFileName(name: string): string {
  const base = name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(-120);
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

/** Builders and projects a channel partner is empanelled with and may invoice. */
export async function listInvoiceableBuilders(actor: Actor) {
  assertOrgType(actor, "CHANNEL_PARTNER");
  authorize(actor, "invoice.submit");
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

export async function submitInvoice(actor: Actor, rawInput: SubmitInvoiceInput, rawFile: UploadedFile | null) {
  assertOrgType(actor, "CHANNEL_PARTNER");
  authorize(actor, "invoice.submit");
  const input = submitInvoiceSchema.parse(rawInput);
  const file = validatePdf(rawFile);

  const relationship = await db.cpBuilderRelationship.findUnique({
    where: { cpId_builderId: { cpId: actor.orgId, builderId: input.builderId } },
    include: { builder: true },
  });
  if (!relationship || relationship.status !== "ACTIVE" || relationship.builder.status !== "ACTIVE") {
    throw invalid("You are not empanelled with this builder.", { builderId: ["You are not empanelled with this builder"] });
  }
  const project = await db.project.findFirst({ where: { id: input.projectId, builderId: input.builderId, status: "ACTIVE" } });
  if (!project) throw invalid("Select a project belonging to this builder.", { projectId: ["Select a valid project"] });

  const existing = await db.invoice.findUnique({
    where: { cpId_builderId_invoiceNumber: { cpId: actor.orgId, builderId: input.builderId, invoiceNumber: input.invoiceNumber } },
  });
  if (existing) {
    throw conflict(`Invoice ${input.invoiceNumber} has already been submitted to ${relationship.builder.name} (${existing.reference}).`);
  }

  const digest = sha256(file.bytes);
  const duplicateDoc = await db.invoiceDocument.findFirst({
    where: { sha256: digest, invoice: { cpId: actor.orgId, status: { not: "REJECTED" } } },
    include: { invoice: true },
  });
  if (duplicateDoc) {
    throw conflict(`This PDF was already submitted as invoice ${duplicateDoc.invoice.invoiceNumber} (${duplicateDoc.invoice.reference}).`);
  }

  const storageKey = newStorageKey("invoices", "pdf");
  await storage().put(storageKey, file.bytes, "application/pdf");

  try {
    return await db.$transaction(async (tx) => {
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
          gstAmountPaise: input.gstAmount ?? null,
          description: input.description || null,
          status: "SUBMITTED",
          submittedAt: now,
          createdById: actor.userId,
          documents: {
            create: {
              fileName: safeFileName(file.name),
              storageKey,
              mimeType: "application/pdf",
              sizeBytes: file.bytes.length,
              sha256: digest,
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
      await recordAudit(tx, actor, {
        action: "invoice.submitted",
        entityType: "Invoice",
        entityId: invoice.id,
        summary: `Submitted invoice ${invoice.invoiceNumber} (${reference}) to ${relationship.builder.name}`,
        metadata: { reference, amountPaise: invoice.amountPaise, builderId: input.builderId, projectId: project.id },
      });
      return { id: invoice.id, reference };
    });
  } catch (error) {
    await storage().delete(storageKey).catch(() => undefined);
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
  authorize(actor, "invoice.respond");
  const { note } = responseSchema.parse(raw);
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.cpId !== actor.orgId) throw notFound("Invoice not found.");
  if (invoice.status !== "CLARIFICATION_REQUESTED") throw conflict("Only invoices awaiting clarification can be resubmitted.");

  let storageKey: string | null = null;
  let digest: string | null = null;
  let file: UploadedFile | null = null;
  if (rawFile && rawFile.bytes.length > 0) {
    file = validatePdf(rawFile);
    digest = sha256(file.bytes);
    storageKey = newStorageKey("invoices", "pdf");
    await storage().put(storageKey, file.bytes, "application/pdf");
  }

  try {
    await db.$transaction(async (tx) => {
      const updated = await tx.invoice.updateMany({
        where: { id: invoice.id, status: "CLARIFICATION_REQUESTED" },
        data: { status: "SUBMITTED", submittedAt: new Date(), latestReviewNote: null },
      });
      if (updated.count !== 1) throw conflict("This invoice has already been resubmitted.");
      if (file && storageKey && digest) {
        await tx.invoiceDocument.create({
          data: {
            invoiceId: invoice.id,
            fileName: safeFileName(file.name),
            storageKey,
            mimeType: "application/pdf",
            sizeBytes: file.bytes.length,
            sha256: digest,
            uploadedById: actor.userId,
          },
        });
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
        metadata: { replacedDocument: Boolean(file) },
      });
    });
  } catch (error) {
    if (storageKey) await storage().delete(storageKey).catch(() => undefined);
    throw error;
  }
}

const REVIEWABLE: InvoiceStatus[] = ["SUBMITTED", "UNDER_REVIEW"];

async function loadForBuilder(actor: Actor, invoiceId: string) {
  assertOrgType(actor, "BUILDER");
  authorize(actor, "invoice.review");
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.builderId !== actor.orgId) throw notFound("Invoice not found.");
  return invoice;
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
    audit: { action: string; summary: (invoiceNumber: string) => string; metadata?: Record<string, unknown> };
  },
) {
  const invoice = await loadForBuilder(actor, invoiceId);
  if (!options.from.includes(invoice.status)) {
    throw conflict(`This invoice is already ${invoice.status.replace(/_/g, " ").toLowerCase()} and cannot be updated.`);
  }
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
});

export async function approveInvoice(actor: Actor, invoiceId: string, raw: z.input<typeof approveSchema>) {
  const input = approveSchema.parse(raw);
  authorize(actor, "invoice.approve");
  const invoice = await loadForBuilder(actor, invoiceId);
  let approved = invoice.amountPaise;
  if (input.approvedAmount && input.approvedAmount.trim()) {
    const parsed = parseRupeesToPaise(input.approvedAmount);
    if (parsed === null || parsed <= 0n) throw invalid("Enter a valid approved amount.", { approvedAmount: ["Enter a valid amount"] });
    if (parsed > invoice.amountPaise)
      throw invalid("Approved amount cannot exceed the invoice amount.", { approvedAmount: ["Cannot exceed the invoice amount"] });
    approved = parsed;
  }
  await transition(actor, invoiceId, {
    from: REVIEWABLE,
    to: "ACCEPTED",
    action: "APPROVED",
    comment: input.comment || undefined,
    data: { approvedAmountPaise: approved, decidedAt: new Date(), latestReviewNote: input.comment || null },
    audit: {
      action: "invoice.approved",
      summary: (n) => `Approved invoice ${n}`,
      metadata: { approvedAmountPaise: approved, invoiceAmountPaise: invoice.amountPaise },
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
  authorize(actor, "invoice.read");
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
  authorize(actor, "document.read");
  const document = await db.invoiceDocument.findUnique({ where: { id: documentId }, include: { invoice: true } });
  if (!document) throw notFound("Document not found.");
  const visible = await db.invoice.count({ where: { AND: [{ id: document.invoiceId }, invoiceScope(actor)] } });
  if (!visible) throw notFound("Document not found.");
  return document;
}
