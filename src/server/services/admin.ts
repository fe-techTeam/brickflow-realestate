import "server-only";
import { z } from "zod";
import type { OrganisationType, Prisma, ProgrammeStatus, RecordStatus } from "@/generated/prisma/client";
import { MAX_DISCOUNT_RATE_BPS, MIN_DISCOUNT_RATE_BPS } from "@/lib/financing";
import { formatBps, parsePercentToBps, parseRupeesToPaise } from "@/lib/money";
import { DEFAULT_PRICING_TERMS, pricingTermsIssues, type PricingTerms } from "@/lib/pricing";
import { recordAudit } from "../audit";
import { assertOrgType, type Actor } from "../auth/session";
import { db, type Tx } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { sortByEnumName } from "../ordering";
import { nextReference } from "../sequence";

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

const rateString = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const bps = parsePercentToBps(v);
    if (bps === null || bps < MIN_DISCOUNT_RATE_BPS || bps > MAX_DISCOUNT_RATE_BPS) {
      ctx.addIssue({ code: "custom", message: `Enter a percentage between 0.01 and ${formatBps(MAX_DISCOUNT_RATE_BPS, { suffix: false })} (up to 2 decimals)` });
      return z.NEVER;
    }
    return bps;
  });

const programmeStatus = z.enum(["DRAFT", "ACTIVE", "SUSPENDED", "CLOSED"]);

/** Optional percentage (0–100, up to 2 decimals) as basis points; blank means "not supplied". */
const optionalPercent = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return undefined;
    const bps = parsePercentToBps(v);
    if (bps === null || bps > 10_000) {
      ctx.addIssue({ code: "custom", message: "Enter a percentage with up to 2 decimals" });
      return z.NEVER;
    }
    return bps;
  });

/** Optional rupee amount as paise; blank means "not supplied". */
const optionalRupees = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return undefined;
    const paise = parseRupeesToPaise(v);
    if (paise === null) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in rupees with up to 2 decimals" });
      return z.NEVER;
    }
    return paise;
  });

const optionalDays = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return undefined;
    const n = typeof v === "number" ? v : Number(v.trim());
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      ctx.addIssue({ code: "custom", message: "Enter whole days between 1 and 365" });
      return z.NEVER;
    }
    return n;
  });

/** Like `optionalDays`, but an explicit blank or null clears the value (no maximum). */
const clearableDays = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === null || (typeof v === "string" && v.trim() === "")) return null;
    const n = typeof v === "number" ? v : Number(v.trim());
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      ctx.addIssue({ code: "custom", message: "Enter whole days between 1 and 365, or leave blank" });
      return z.NEVER;
    }
    return n;
  });

/**
 * Pricing-engine fields shared by create and update. Every field is optional: on create, missing
 * fields take the defaults that reproduce flat-percentage pricing; on update they keep the stored value.
 */
const pricingFields = {
  pricingMode: z.enum(["FLAT_PERCENT", "ANNUAL_RATE"]).optional(),
  minTenorDays: optionalDays,
  maxTenorDays: clearableDays,
  minDiscount: optionalRupees,
  tdsDeducted: z.boolean().optional(),
  tdsRate: optionalPercent,
  invoiceGstRate: optionalPercent,
  processingFeeFlat: optionalRupees,
  processingFeeRate: optionalPercent,
  feeGstRate: optionalPercent,
  holidayRule: z.enum(["NONE", "NEXT_BUSINESS_DAY"]).optional(),
};

interface PricingFieldInput {
  pricingMode?: PricingTerms["pricingMode"];
  minTenorDays?: number;
  maxTenorDays?: number | null;
  minDiscount?: bigint;
  tdsDeducted?: boolean;
  tdsRate?: number;
  invoiceGstRate?: number;
  processingFeeFlat?: bigint;
  processingFeeRate?: number;
  feeGstRate?: number;
  holidayRule?: "NONE" | "NEXT_BUSINESS_DAY";
}

type StoredPricingTerms = Omit<PricingTerms, "discountRateBps"> & { holidayRule: "NONE" | "NEXT_BUSINESS_DAY" };

const FORM_FIELD: Partial<Record<keyof PricingTerms, string>> = {
  discountRateBps: "discountRate",
  minDiscountPaise: "minDiscount",
  tdsRateBps: "tdsRate",
  invoiceGstRateBps: "invoiceGstRate",
  processingFeeFlatPaise: "processingFeeFlat",
  processingFeeBps: "processingFeeRate",
  feeGstRateBps: "feeGstRate",
};

function storedPricingTerms(p: StoredPricingTerms): StoredPricingTerms {
  return {
    pricingMode: p.pricingMode,
    minTenorDays: p.minTenorDays,
    maxTenorDays: p.maxTenorDays,
    minDiscountPaise: p.minDiscountPaise,
    tdsDeducted: p.tdsDeducted,
    tdsRateBps: p.tdsRateBps,
    invoiceGstRateBps: p.invoiceGstRateBps,
    processingFeeFlatPaise: p.processingFeeFlatPaise,
    processingFeeBps: p.processingFeeBps,
    feeGstRateBps: p.feeGstRateBps,
    holidayRule: p.holidayRule,
  };
}

/** Merges submitted pricing fields over `base` and validates the combination. */
function resolvePricing(input: PricingFieldInput, discountRateBps: number, base: StoredPricingTerms): StoredPricingTerms {
  const terms: StoredPricingTerms = {
    pricingMode: input.pricingMode ?? base.pricingMode,
    minTenorDays: input.minTenorDays ?? base.minTenorDays,
    maxTenorDays: input.maxTenorDays === undefined ? base.maxTenorDays : input.maxTenorDays,
    minDiscountPaise: input.minDiscount ?? base.minDiscountPaise,
    tdsDeducted: input.tdsDeducted ?? base.tdsDeducted,
    tdsRateBps: input.tdsRate ?? base.tdsRateBps,
    invoiceGstRateBps: input.invoiceGstRate ?? base.invoiceGstRateBps,
    processingFeeFlatPaise: input.processingFeeFlat ?? base.processingFeeFlatPaise,
    processingFeeBps: input.processingFeeRate ?? base.processingFeeBps,
    feeGstRateBps: input.feeGstRate ?? base.feeGstRateBps,
    holidayRule: input.holidayRule ?? base.holidayRule,
  };
  const issues = pricingTermsIssues({ ...terms, discountRateBps });
  if (issues.length) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of issues) (fieldErrors[FORM_FIELD[issue.field] ?? issue.field] ??= []).push(issue.message);
    throw invalid("Please correct the highlighted fields.", fieldErrors);
  }
  return terms;
}

function pricingKey(p: StoredPricingTerms): string {
  return JSON.stringify(storedPricingTerms(p), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

const DEFAULT_STORED_PRICING: StoredPricingTerms = { ...DEFAULT_PRICING_TERMS, holidayRule: "NONE" };

const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(dateString.optional());

export const createProgrammeSchema = z
  .object({
    name: z.string().trim().min(3, "Name is required").max(120),
    builderId: z.string().min(1, "Select a builder"),
    financierId: z.string().min(1, "Select a financier"),
    discountRate: rateString,
    status: programmeStatus,
    effectiveFrom: dateString,
    effectiveTo: optionalDate,
    offerValidityDays: z.coerce.number().int().min(1, "At least 1 day").max(90, "At most 90 days"),
    terms: z.string().trim().min(20, "Describe the programme terms (at least 20 characters)").max(4000),
    ...pricingFields,
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo > v.effectiveFrom, { path: ["effectiveTo"], message: "End date must be after the effective date" });

export type CreateProgrammeInput = z.input<typeof createProgrammeSchema>;

export const updateProgrammeSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    discountRate: rateString,
    status: programmeStatus,
    effectiveFrom: dateString,
    effectiveTo: optionalDate,
    offerValidityDays: z.coerce.number().int().min(1).max(90),
    terms: z.string().trim().min(20).max(4000),
    ...pricingFields,
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo > v.effectiveFrom, { path: ["effectiveTo"], message: "End date must be after the effective date" });

export type UpdateProgrammeInput = z.input<typeof updateProgrammeSchema>;

function requireSuperAdmin(actor: Actor) {
  assertOrgType(actor, "PLATFORM");
  if (actor.role !== "SUPER_ADMIN") throw forbidden();
}

/** A builder may have only one ACTIVE programme at a time so the applicable rate is unambiguous. */
async function assertSingleActive(tx: Tx, builderId: string, status: ProgrammeStatus, excludeId?: string) {
  if (status !== "ACTIVE") return;
  const other = await tx.financingProgramme.findFirst({ where: { builderId, status: "ACTIVE", ...(excludeId ? { id: { not: excludeId } } : {}) } });
  if (other) {
    throw conflict(`This builder already has an active programme (${other.code}). Suspend or close it before activating another.`);
  }
}

/** Open offers priced on a programme are withdrawn when its terms change; accepted requests keep their snapshot. */
async function supersedeOpenOffers(tx: Tx, programmeId: string): Promise<number> {
  const open = await tx.financingOffer.findMany({ where: { programmeId, status: "OFFERED" }, select: { id: true, invoiceId: true } });
  if (open.length === 0) return 0;
  await tx.financingOffer.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { status: "SUPERSEDED" } });
  await tx.invoice.updateMany({
    where: { id: { in: open.map((o) => o.invoiceId) }, financingStatus: "OFFER_GENERATED" },
    data: { financingStatus: "NOT_REQUESTED" },
  });
  return open.length;
}

export async function createProgramme(actor: Actor, raw: CreateProgrammeInput) {
  requireSuperAdmin(actor);
  const input = createProgrammeSchema.parse(raw);
  const [builder, financier] = await Promise.all([
    db.organisation.findUnique({ where: { id: input.builderId } }),
    db.organisation.findUnique({ where: { id: input.financierId } }),
  ]);
  if (!builder || builder.type !== "BUILDER") throw invalid("Select a valid builder.", { builderId: ["Select a valid builder"] });
  if (!financier || financier.type !== "FINANCIER") throw invalid("Select a valid financier.", { financierId: ["Select a valid financier"] });
  const pricing = resolvePricing(input, input.discountRate, DEFAULT_STORED_PRICING);

  return db.$transaction(async (tx) => {
    await assertSingleActive(tx, builder.id, input.status);
    const code = await nextReference(tx, "programme");
    const programme = await tx.financingProgramme.create({
      data: {
        code,
        name: input.name,
        builderId: builder.id,
        financierId: financier.id,
        discountRateBps: input.discountRate,
        status: input.status,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        offerValidityDays: input.offerValidityDays,
        terms: input.terms,
        ...pricing,
        createdById: actor.userId,
      },
    });
    await recordAudit(tx, actor, {
      action: "programme.created",
      entityType: "FinancingProgramme",
      entityId: programme.id,
      summary: `Created programme ${code} for ${builder.name} at ${formatBps(programme.discountRateBps)} (${programme.status.toLowerCase()})`,
      metadata: { discountRateBps: programme.discountRateBps, status: programme.status, effectiveFrom: programme.effectiveFrom, pricing: storedPricingTerms(programme) },
    });
    return programme;
  });
}

export async function updateProgramme(actor: Actor, programmeId: string, raw: UpdateProgrammeInput) {
  requireSuperAdmin(actor);
  const input = updateProgrammeSchema.parse(raw);
  const existing = await db.financingProgramme.findUnique({ where: { id: programmeId }, include: { builder: true } });
  if (!existing) throw notFound("Programme not found.");
  const pricing = resolvePricing(input, input.discountRate, existing);

  return db.$transaction(async (tx) => {
    await assertSingleActive(tx, existing.builderId, input.status, existing.id);
    const termsChanged =
      existing.discountRateBps !== input.discountRate ||
      pricingKey(existing) !== pricingKey(pricing) ||
      existing.status !== input.status ||
      existing.effectiveFrom.getTime() !== input.effectiveFrom.getTime() ||
      (existing.effectiveTo?.getTime() ?? null) !== (input.effectiveTo?.getTime() ?? null) ||
      existing.terms !== input.terms;
    const programme = await tx.financingProgramme.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        discountRateBps: input.discountRate,
        status: input.status,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        offerValidityDays: input.offerValidityDays,
        terms: input.terms,
        ...pricing,
      },
    });
    const withdrawn = termsChanged ? await supersedeOpenOffers(tx, existing.id) : 0;
    const rateChanged = existing.discountRateBps !== programme.discountRateBps;
    await recordAudit(tx, actor, {
      action: rateChanged ? "programme.rate_changed" : "programme.updated",
      entityType: "FinancingProgramme",
      entityId: programme.id,
      summary: rateChanged
        ? `Changed ${programme.code} (${existing.builder.name}) discount from ${formatBps(existing.discountRateBps)} to ${formatBps(programme.discountRateBps)}`
        : `Updated programme ${programme.code} (${existing.builder.name})`,
      metadata: {
        before: {
          discountRateBps: existing.discountRateBps,
          status: existing.status,
          effectiveFrom: existing.effectiveFrom,
          effectiveTo: existing.effectiveTo,
          pricing: storedPricingTerms(existing),
        },
        after: {
          discountRateBps: programme.discountRateBps,
          status: programme.status,
          effectiveFrom: programme.effectiveFrom,
          effectiveTo: programme.effectiveTo,
          pricing: storedPricingTerms(programme),
        },
        openOffersWithdrawn: withdrawn,
      },
    });
    return { programme, openOffersWithdrawn: withdrawn };
  });
}

export async function listProgrammes(actor: Actor) {
  if (actor.orgType !== "PLATFORM" && actor.orgType !== "FINANCIER" && actor.orgType !== "BUILDER") throw forbidden();
  const where: Prisma.FinancingProgrammeWhereInput =
    actor.orgType === "FINANCIER" ? { financierId: actor.orgId } : actor.orgType === "BUILDER" ? { builderId: actor.orgId } : {};
  const programmes = await db.financingProgramme.findMany({
    where,
    include: {
      builder: { select: { id: true, name: true, status: true } },
      financier: { select: { id: true, name: true } },
      _count: { select: { requests: true, offers: true } },
    },
    orderBy: [{ builder: { name: "asc" } }, { id: "asc" }],
  });
  return sortByEnumName(programmes, (p) => p.status);
}

export type ProgrammeListItem = Awaited<ReturnType<typeof listProgrammes>>[number];

/* ----------------------------------------------------------------------------------------------
 * Organisations & users
 * -------------------------------------------------------------------------------------------- */

/** Organisations a financier may see: builders on its programmes and channel partners empanelled with them. */
function financierCounterpartyScope(financierId: string): Prisma.OrganisationWhereInput {
  return {
    OR: [
      { type: "BUILDER", builderProgrammes: { some: { financierId } } },
      { type: "CHANNEL_PARTNER", cpRelationships: { some: { builder: { builderProgrammes: { some: { financierId } } } } } },
    ],
  };
}

export async function listOrganisations(actor: Actor, filters: { type?: OrganisationType; search?: string } = {}) {
  if (actor.orgType !== "PLATFORM" && actor.orgType !== "FINANCIER") throw forbidden();
  const where: Prisma.OrganisationWhereInput = {
    ...(filters.type ? { type: filters.type } : {}),
    ...(actor.orgType === "FINANCIER" ? { AND: [financierCounterpartyScope(actor.orgId)] } : {}),
    ...(filters.search?.trim()
      ? { OR: [{ name: { contains: filters.search.trim(), mode: "insensitive" } }, { legalName: { contains: filters.search.trim(), mode: "insensitive" } }, { gstin: { contains: filters.search.trim(), mode: "insensitive" } }] }
      : {}),
  };
  const organisations = await db.organisation.findMany({
    where,
    include: {
      _count: { select: { members: true, projects: true, cpInvoices: true, builderInvoices: true, cpRelationships: true, builderRelationships: true } },
      builderProgrammes: { where: { status: "ACTIVE" }, select: { code: true, discountRateBps: true, financierId: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return sortByEnumName(organisations, (o) => o.type);
}

export type OrganisationListItem = Awaited<ReturnType<typeof listOrganisations>>[number];

export async function getOrganisation(actor: Actor, organisationId: string) {
  const scope: Prisma.OrganisationWhereInput =
    actor.orgType === "PLATFORM" || actor.orgId === organisationId
      ? {}
      : actor.orgType === "FINANCIER"
        ? financierCounterpartyScope(actor.orgId)
        : { id: actor.orgId };
  const org = await db.organisation.findFirst({
    where: { AND: [{ id: organisationId }, scope] },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true } }, role: true } },
      projects: { orderBy: { name: "asc" } },
      cpRelationships: { include: { builder: { select: { id: true, name: true } } } },
      builderRelationships: { include: { cp: { select: { id: true, name: true } } } },
    },
  });
  if (!org) throw notFound("Organisation not found.");
  return org;
}

export async function setOrganisationStatus(actor: Actor, organisationId: string, status: RecordStatus) {
  requireSuperAdmin(actor);
  const org = await db.organisation.findUnique({ where: { id: organisationId } });
  if (!org) throw notFound("Organisation not found.");
  if (org.type === "PLATFORM") throw conflict("The platform organisation cannot be deactivated.");
  if (org.status === status) return org;
  return db.$transaction(async (tx) => {
    const updated = await tx.organisation.update({ where: { id: org.id }, data: { status } });
    await recordAudit(tx, actor, {
      action: status === "ACTIVE" ? "organisation.activated" : "organisation.deactivated",
      entityType: "Organisation",
      entityId: org.id,
      summary: `${status === "ACTIVE" ? "Activated" : "Deactivated"} ${org.name}`,
    });
    return updated;
  });
}

export async function listUsers(actor: Actor, filters: { search?: string } = {}) {
  requireSuperAdmin(actor);
  const q = filters.search?.trim();
  return db.organisationUser.findMany({
    where: q ? { OR: [{ user: { name: { contains: q, mode: "insensitive" } } }, { user: { email: { contains: q, mode: "insensitive" } } }, { organisation: { name: { contains: q, mode: "insensitive" } } }] } : {},
    include: {
      user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true, createdAt: true } },
      organisation: { select: { id: true, name: true, type: true, status: true } },
      role: true,
    },
    orderBy: [{ organisation: { name: "asc" } }, { user: { name: "asc" } }],
  });
}

export type UserListItem = Awaited<ReturnType<typeof listUsers>>[number];

export async function setUserStatus(actor: Actor, userId: string, status: RecordStatus) {
  requireSuperAdmin(actor);
  if (userId === actor.userId) throw conflict("You cannot change the status of your own account.");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User not found.");
  if (user.status === status) return user;
  return db.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: user.id }, data: { status } });
    await recordAudit(tx, actor, {
      action: status === "ACTIVE" ? "user.activated" : "user.deactivated",
      entityType: "User",
      entityId: user.id,
      summary: `${status === "ACTIVE" ? "Activated" : "Deactivated"} user ${user.email}`,
    });
    return updated;
  });
}

/* ----------------------------------------------------------------------------------------------
 * Platform settings
 * -------------------------------------------------------------------------------------------- */

export const SETTING_DEFINITIONS = {
  "platform.supportEmail": { label: "Support email", description: "Shown to users in help text.", default: "support@brickflow.demo" },
  "platform.defaultCreditPeriodDays": {
    label: "Default credit period (days)",
    description: "Used for new CP–builder empanelments when no due date is given on an invoice.",
    default: "60",
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const rows = await db.platformSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(
    (Object.keys(SETTING_DEFINITIONS) as SettingKey[]).map((key) => [key, map.get(key) ?? SETTING_DEFINITIONS[key].default]),
  ) as Record<SettingKey, string>;
}

const settingValidators: Record<SettingKey, z.ZodType<string>> = {
  "platform.supportEmail": z.email("Enter a valid email"),
  "platform.defaultCreditPeriodDays": z.string().regex(/^\d{1,3}$/, "Enter a number of days").refine((v) => Number(v) >= 1 && Number(v) <= 365, "Between 1 and 365"),
};

export async function updateSettings(actor: Actor, values: Partial<Record<SettingKey, string>>) {
  requireSuperAdmin(actor);
  const entries = Object.entries(values).filter(([key]) => key in SETTING_DEFINITIONS) as [SettingKey, string][];
  const fieldErrors: Record<string, string[]> = {};
  const parsed: [SettingKey, string][] = [];
  for (const [key, value] of entries) {
    const result = settingValidators[key].safeParse(value);
    if (!result.success) fieldErrors[key] = result.error.issues.map((i) => i.message);
    else parsed.push([key, result.data]);
  }
  if (Object.keys(fieldErrors).length) throw invalid("Please correct the highlighted settings.", fieldErrors);
  await db.$transaction(async (tx) => {
    for (const [key, value] of parsed) {
      await tx.platformSetting.upsert({ where: { key }, create: { key, value, updatedById: actor.userId }, update: { value, updatedById: actor.userId } });
    }
    await recordAudit(tx, actor, {
      action: "settings.updated",
      entityType: "PlatformSetting",
      entityId: parsed.map(([k]) => k).join(","),
      summary: `Updated platform settings: ${parsed.map(([k]) => SETTING_DEFINITIONS[k].label).join(", ")}`,
      metadata: Object.fromEntries(parsed),
    });
  });
}

/* ----------------------------------------------------------------------------------------------
 * Audit log
 * -------------------------------------------------------------------------------------------- */

export async function listAuditLogs(
  actor: Actor,
  filters: { entityType?: string; entityId?: string; search?: string; take?: number } = {},
) {
  const scope: Prisma.AuditLogWhereInput = actor.orgType === "PLATFORM" ? {} : { actorOrgId: actor.orgId };
  const q = filters.search?.trim();
  return db.auditLog.findMany({
    where: {
      AND: [
        scope,
        filters.entityType ? { entityType: filters.entityType } : {},
        filters.entityId ? { entityId: filters.entityId } : {},
        q ? { OR: [{ summary: { contains: q, mode: "insensitive" } }, { actorName: { contains: q, mode: "insensitive" } }, { action: { contains: q, mode: "insensitive" } }] } : {},
      ],
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filters.take ?? 200, 500),
  });
}
