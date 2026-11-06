import "server-only";
import { z } from "zod";
import type { InvoiceDuplicateKind, Prisma } from "@/generated/prisma/client";
import { computeFingerprint, type FingerprintParts, type FingerprintSource } from "@/lib/invoice-integrity/fingerprint";
import { formatINR } from "@/lib/money";
import { recordAudit } from "../audit";
import { assertOrgType, type Actor } from "../auth/session";
import { db, type Tx } from "../db";
import { conflict, forbidden, notFound } from "../errors";
import type { DuplicateFlagDto } from "@/components/invoice/duplicate-flags";
import { getApplicableProgramme } from "./financing";

/* ----------------------------------------------------------------------------------------------
 * Fingerprint registry. The local registry is the InvoiceFingerprint table; a shared registry
 * spanning other platforms or financiers can be attached with setExternalFingerprintRegistry().
 * -------------------------------------------------------------------------------------------- */

export interface ExternalRegistryMatch {
  /** The registry's own identifier for the matching record. */
  ref: string;
  detail: string;
}

export interface FingerprintRegistryAdapter {
  readonly name: string;
  check(parts: FingerprintParts): Promise<ExternalRegistryMatch[]>;
  register(parts: FingerprintParts, invoiceRef: string): Promise<void>;
}

let externalRegistry: FingerprintRegistryAdapter | null = null;

export function setExternalFingerprintRegistry(adapter: FingerprintRegistryAdapter | null): void {
  externalRegistry = adapter;
}

export interface FingerprintCheck {
  parts: FingerprintParts;
  /** An invoice already registered with the identical fingerprint; submissions matching it are blocked. */
  exact: { invoiceId: string; reference: string; cpId: string } | null;
  external: ExternalRegistryMatch[];
}

export async function checkFingerprint(source: FingerprintSource, client: Tx | typeof db = db): Promise<FingerprintCheck> {
  const parts = computeFingerprint(source);
  const existing = await client.invoiceFingerprint.findUnique({
    where: { fingerprint: parts.fingerprint },
    select: { invoice: { select: { id: true, reference: true, cpId: true } } },
  });
  let external: ExternalRegistryMatch[] = [];
  if (externalRegistry) {
    try {
      external = await externalRegistry.check(parts);
    } catch (error) {
      // A registry outage must not stop invoicing; the local registry still blocks exact duplicates.
      console.error(`[integrity] ${externalRegistry.name} fingerprint check failed`, error);
    }
  }
  return {
    parts,
    exact: existing ? { invoiceId: existing.invoice.id, reference: existing.invoice.reference, cpId: existing.invoice.cpId } : null,
    external,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

/** Registers the invoice's fingerprint inside the caller's transaction; a concurrent identical invoice loses with a conflict. */
export async function registerFingerprint(tx: Tx, invoiceId: string, source: FingerprintSource): Promise<FingerprintParts> {
  const parts = computeFingerprint(source);
  try {
    await tx.invoiceFingerprint.create({ data: { invoiceId, ...parts } });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("An identical invoice (same parties, number, date and total) is already registered on the platform.");
    throw error;
  }
  return parts;
}

/** Shares a committed fingerprint with the external registry, if one is attached. Best effort. */
export async function publishFingerprint(parts: FingerprintParts, invoiceRef: string): Promise<void> {
  if (!externalRegistry) return;
  try {
    await externalRegistry.register(parts, invoiceRef);
  } catch (error) {
    console.error(`[integrity] ${externalRegistry.name} fingerprint registration failed`, error);
  }
}

/* ----------------------------------------------------------------------------------------------
 * Possible duplicates. These are flagged for the builder and the platform to review rather than
 * blocked: legitimate invoices can share parties and amounts.
 * -------------------------------------------------------------------------------------------- */

const MAX_MATCHES_PER_RULE = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export function duplicateWindowDays(): number {
  const raw = process.env.INVOICE_DUPLICATE_WINDOW_DAYS;
  if (raw === undefined || raw.trim() === "") return 7;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 0 || days > 90) throw new Error("INVOICE_DUPLICATE_WINDOW_DAYS must be a whole number of days between 0 and 90");
  return days;
}

interface DetectionSubject {
  id: string;
  cpId: string;
  parts: FingerprintParts;
  external?: ExternalRegistryMatch[];
  documentSha256?: string | null;
}

interface FlagDraft {
  matchedInvoiceId: string | null;
  externalRef: string | null;
  kind: InvoiceDuplicateKind;
  detail: string;
}

function daysApart(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / DAY_MS);
}

/** Finds possible duplicates of a just-created invoice and records them as open flags. Returns the new flags. */
export async function flagPossibleDuplicates(tx: Tx, subject: DetectionSubject) {
  const drafts: FlagDraft[] = [];
  const { parts } = subject;

  if (parts.supplierKey && parts.recipientKey) {
    const window = duplicateWindowDays() * DAY_MS;
    const near = await tx.invoiceFingerprint.findMany({
      where: {
        supplierKey: parts.supplierKey,
        recipientKey: parts.recipientKey,
        totalPaise: parts.totalPaise,
        invoiceDate: { gte: new Date(parts.invoiceDate.getTime() - window), lte: new Date(parts.invoiceDate.getTime() + window) },
        invoiceId: { not: subject.id },
        invoice: { status: { not: "REJECTED" } },
      },
      select: { invoiceId: true, invoiceDate: true, invoice: { select: { invoiceNumber: true } } },
      orderBy: { createdAt: "desc" },
      take: MAX_MATCHES_PER_RULE,
    });
    for (const match of near) {
      const apart = daysApart(match.invoiceDate, parts.invoiceDate);
      drafts.push({
        matchedInvoiceId: match.invoiceId,
        externalRef: null,
        kind: "NEAR_DUPLICATE",
        detail: `Same supplier, builder and total (${formatINR(parts.totalPaise)}), invoice ${match.invoice.invoiceNumber} dated ${apart === 0 ? "the same day" : `${apart} day${apart === 1 ? "" : "s"} apart`}`,
      });
    }
  }

  if (parts.irn) {
    const sameIrn = await tx.invoice.findMany({
      where: { irn: parts.irn, id: { not: subject.id } },
      select: { id: true },
      take: MAX_MATCHES_PER_RULE,
    });
    for (const match of sameIrn) {
      drafts.push({ matchedInvoiceId: match.id, externalRef: null, kind: "SAME_IRN", detail: "Another invoice on the platform carries the same e-invoice IRN" });
    }
  }

  if (subject.documentSha256) {
    const samePdf = await tx.invoiceDocument.findMany({
      where: { sha256: subject.documentSha256, invoiceId: { not: subject.id }, invoice: { cpId: { not: subject.cpId } } },
      select: { invoiceId: true },
      distinct: ["invoiceId"],
      take: MAX_MATCHES_PER_RULE,
    });
    for (const match of samePdf) {
      drafts.push({
        matchedInvoiceId: match.invoiceId,
        externalRef: null,
        kind: "SAME_DOCUMENT_OTHER_PARTNER",
        detail: "The identical PDF was submitted by a different channel partner",
      });
    }
  }

  for (const match of subject.external ?? []) {
    drafts.push({ matchedInvoiceId: null, externalRef: match.ref, kind: "EXTERNAL_REGISTRY", detail: match.detail });
  }

  if (drafts.length === 0) return [];
  const existing = await tx.invoiceDuplicateFlag.findMany({ where: { invoiceId: subject.id }, select: { matchedInvoiceId: true, externalRef: true, kind: true } });
  const seen = new Set(existing.map((f) => `${f.kind}:${f.matchedInvoiceId ?? f.externalRef}`));
  const fresh = drafts.filter((d) => {
    const key = `${d.kind}:${d.matchedInvoiceId ?? d.externalRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (fresh.length) await tx.invoiceDuplicateFlag.createMany({ data: fresh.map((d) => ({ invoiceId: subject.id, ...d })) });
  return fresh;
}

/* ----------------------------------------------------------------------------------------------
 * Review of flags by the builder (its own invoices) and the platform.
 * -------------------------------------------------------------------------------------------- */

const flagInclude = {
  invoice: { select: { id: true, reference: true, invoiceNumber: true, builderId: true, cpId: true, amountPaise: true, invoiceDate: true, status: true, cp: { select: { name: true } }, builder: { select: { name: true } } } },
  matchedInvoice: {
    select: { id: true, reference: true, invoiceNumber: true, builderId: true, cpId: true, amountPaise: true, invoiceDate: true, status: true, cp: { select: { name: true } }, builder: { select: { name: true } } },
  },
} satisfies Prisma.InvoiceDuplicateFlagInclude;

type FlagRow = Prisma.InvoiceDuplicateFlagGetPayload<{ include: typeof flagInclude }>;

export interface DuplicateFlagView {
  id: string;
  kind: InvoiceDuplicateKind;
  status: FlagRow["status"];
  detail: string;
  createdAt: Date;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  invoice: { id: string; reference: string; invoiceNumber: string; cpName: string; builderName: string; amountPaise: bigint };
  /** Null when the matching record belongs to another builder and must not be disclosed. */
  matched: { id: string; reference: string; invoiceNumber: string; cpName: string; builderName: string; amountPaise: bigint; invoiceDate: Date; status: string } | null;
  matchedElsewhere: boolean;
  externalRef: string | null;
}

function toView(actor: Actor, flag: FlagRow): DuplicateFlagView {
  const m = flag.matchedInvoice;
  const disclose = m !== null && (actor.orgType === "PLATFORM" || m.builderId === actor.orgId);
  return {
    id: flag.id,
    kind: flag.kind,
    status: flag.status,
    detail: flag.detail,
    createdAt: flag.createdAt,
    reviewedByName: flag.reviewedByName,
    reviewedAt: flag.reviewedAt,
    reviewNote: flag.reviewNote,
    invoice: {
      id: flag.invoice.id,
      reference: flag.invoice.reference,
      invoiceNumber: flag.invoice.invoiceNumber,
      cpName: flag.invoice.cp.name,
      builderName: flag.invoice.builder.name,
      amountPaise: flag.invoice.amountPaise,
    },
    matched: disclose
      ? { id: m.id, reference: m.reference, invoiceNumber: m.invoiceNumber, cpName: m.cp.name, builderName: m.builder.name, amountPaise: m.amountPaise, invoiceDate: m.invoiceDate, status: m.status }
      : null,
    matchedElsewhere: m !== null && !disclose,
    externalRef: actor.orgType === "PLATFORM" ? flag.externalRef : null,
  };
}

function flagScope(actor: Actor): Prisma.InvoiceDuplicateFlagWhereInput {
  if (actor.orgType === "PLATFORM") return {};
  if (actor.orgType === "BUILDER") return { invoice: { builderId: actor.orgId, status: { not: "DRAFT" } } };
  throw forbidden();
}

export async function listDuplicateFlags(actor: Actor, filters: { invoiceId?: string; status?: FlagRow["status"] } = {}): Promise<DuplicateFlagView[]> {
  const where: Prisma.InvoiceDuplicateFlagWhereInput = { AND: [flagScope(actor), filters.invoiceId ? { invoiceId: filters.invoiceId } : {}, filters.status ? { status: filters.status } : {}] };
  const rows = await db.invoiceDuplicateFlag.findMany({ where, include: flagInclude, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 });
  return rows.map((row) => toView(actor, row));
}

export async function countOpenDuplicateFlags(actor: Actor): Promise<number> {
  return db.invoiceDuplicateFlag.count({ where: { AND: [flagScope(actor), { status: "OPEN" }] } });
}

const resolveSchema = z.object({
  resolution: z.enum(["CLEARED", "CONFIRMED"]),
  note: z.string().trim().min(10, "Explain your conclusion (at least 10 characters)").max(1000, "Keep the note under 1000 characters"),
});

/** Records the reviewer's conclusion on an open flag: not a duplicate (CLEARED) or a confirmed duplicate. */
export async function resolveDuplicateFlag(actor: Actor, flagId: string, raw: z.input<typeof resolveSchema>) {
  if (actor.orgType !== "PLATFORM") assertOrgType(actor, "BUILDER");
  const input = resolveSchema.parse(raw);
  const flag = await db.invoiceDuplicateFlag.findFirst({ where: { AND: [{ id: flagId }, flagScope(actor)] }, include: { invoice: { select: { id: true, invoiceNumber: true } } } });
  if (!flag) throw notFound("Flag not found.");
  await db.$transaction(async (tx) => {
    const updated = await tx.invoiceDuplicateFlag.updateMany({
      where: { id: flag.id, status: "OPEN" },
      data: { status: input.resolution, reviewedById: actor.userId, reviewedByName: actor.name, reviewedAt: new Date(), reviewNote: input.note },
    });
    if (updated.count !== 1) throw conflict("This flag has already been reviewed.");
    await recordAudit(tx, actor, {
      action: input.resolution === "CLEARED" ? "invoice.duplicate_cleared" : "invoice.duplicate_confirmed",
      entityType: "Invoice",
      entityId: flag.invoice.id,
      summary: `${input.resolution === "CLEARED" ? "Cleared" : "Confirmed"} a possible duplicate on invoice ${flag.invoice.invoiceNumber}`,
      metadata: { flagId: flag.id, kind: flag.kind, matchedInvoiceId: flag.matchedInvoiceId, note: input.note },
    });
  });
}

/* ----------------------------------------------------------------------------------------------
 * Three-way match policy. Required unless the builder's applicable programme marks it optional.
 * -------------------------------------------------------------------------------------------- */

export interface MatchPolicy {
  required: boolean;
  programme: { id: string; code: string; name: string } | null;
}

export async function getMatchPolicy(builderId: string, at: Date = new Date(), client: Tx | typeof db = db): Promise<MatchPolicy> {
  const programme = await getApplicableProgramme(builderId, at, client);
  if (!programme) return { required: true, programme: null };
  const policy = await client.invoiceMatchPolicy.findUnique({ where: { programmeId: programme.id } });
  return { required: !policy?.attestationOptional, programme: { id: programme.id, code: programme.code, name: programme.name } };
}

/** Programmes with their three-way match policy, for the platform's policy register. */
export async function listMatchPolicyProgrammes(actor: Actor) {
  assertOrgType(actor, "PLATFORM");
  const [programmes, policies] = await Promise.all([
    db.financingProgramme.findMany({
      where: { status: { not: "CLOSED" } },
      select: { id: true, code: true, name: true, status: true, builder: { select: { name: true } } },
      orderBy: [{ builder: { name: "asc" } }, { code: "asc" }],
    }),
    db.invoiceMatchPolicy.findMany(),
  ]);
  const byProgramme = new Map(policies.map((p) => [p.programmeId, p]));
  return programmes.map((p) => ({
    ...p,
    attestationOptional: byProgramme.get(p.id)?.attestationOptional ?? false,
    policyUpdatedAt: byProgramme.get(p.id)?.updatedAt ?? null,
  }));
}

export interface RejectedUpload {
  id: string;
  at: Date;
  actorName: string;
  summary: string;
  reason: string | null;
}

/** Recent uploads the quarantine pipeline rejected, from the audit trail. */
export async function listRejectedUploads(actor: Actor, limit = 25): Promise<RejectedUpload[]> {
  assertOrgType(actor, "PLATFORM");
  const rows = await db.auditLog.findMany({ where: { action: "invoice.document_rejected" }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((row) => {
    let reason: string | null = null;
    try {
      const meta: unknown = row.metadata ? JSON.parse(row.metadata) : null;
      if (meta && typeof meta === "object" && "reason" in meta && typeof meta.reason === "string") reason = meta.reason;
    } catch {
      reason = null;
    }
    return { id: row.id, at: row.createdAt, actorName: row.actorName, summary: row.summary, reason };
  });
}

export async function setMatchPolicy(actor: Actor, programmeId: string, attestationOptional: boolean) {
  assertOrgType(actor, "PLATFORM");
  const programme = await db.financingProgramme.findUnique({ where: { id: programmeId }, select: { id: true, code: true } });
  if (!programme) throw notFound("Programme not found.");
  await db.$transaction(async (tx) => {
    await tx.invoiceMatchPolicy.upsert({
      where: { programmeId },
      create: { programmeId, attestationOptional, updatedById: actor.userId },
      update: { attestationOptional, updatedById: actor.userId },
    });
    await recordAudit(tx, actor, {
      action: "programme.match_policy_updated",
      entityType: "FinancingProgramme",
      entityId: programme.id,
      summary: `Three-way match ${attestationOptional ? "made optional" : "required"} for programme ${programme.code}`,
      metadata: { attestationOptional },
    });
  });
}

/** Client-safe payload for the duplicates panel. */
export function toDuplicateFlagDtos(flags: DuplicateFlagView[]): DuplicateFlagDto[] {
  return flags.map((flag) => ({
    ...flag,
    createdAt: flag.createdAt.toISOString(),
    reviewedAt: flag.reviewedAt?.toISOString() ?? null,
    invoice: { ...flag.invoice, amountPaise: flag.invoice.amountPaise.toString() },
    matched: flag.matched ? { ...flag.matched, amountPaise: flag.matched.amountPaise.toString(), invoiceDate: flag.matched.invoiceDate.toISOString() } : null,
  }));
}
