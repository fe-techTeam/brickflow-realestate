import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { ZodError } from "zod";
import { buildInvoiceDocument } from "@/lib/demo/catalogue";
import { parseRupeesToPaise } from "@/lib/money";
import { renderBrokerageInvoicePdf } from "@/lib/pdf/brokerage-invoice";
import { workspaceForOrgType } from "@/lib/workspaces";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import type { DomainErrorCode } from "@/server/errors";
import { approveInvoice, submitInvoice, type UploadedFile } from "@/server/services/invoices";

export const DEMO_PASSWORD = "BrickFlow@2026";

export const USERS = {
  admin: "admin@brickflow.demo",
  finance: "finance@brickflow.demo",
  analyst: "credit.analyst@brickflow.demo",
  godrej: "accounts@godrej-demo.test",
  skyline: "accounts@skyline-demo.test",
  coastal: "accounts@coastal-demo.test",
  prestige: "partner@prestige-demo.test",
  urbannest: "partner@urbannest-demo.test",
} as const;

export type DemoUser = keyof typeof USERS;
export type BuilderKey = "godrej" | "skyline" | "coastal";
type CpKey = "prestige" | "urbannest";

const PROJECT_FOR: Record<BuilderKey, { key: "gfh" | "rgd" | "sbv"; code: string }> = {
  godrej: { key: "gfh", code: "GFH" },
  skyline: { key: "rgd", code: "RGD" },
  coastal: { key: "sbv", code: "SBV" },
};

/** Builds the actor for a seeded user exactly as `getActor()` derives it from the session membership. */
export async function actorFor(user: DemoUser): Promise<Actor> {
  const membership = await db.organisationUser.findFirstOrThrow({
    where: { user: { email: USERS[user] } },
    include: { user: true, organisation: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    membershipId: membership.id,
    orgId: membership.organisationId,
    orgName: membership.organisation.name,
    orgType: membership.organisation.type,
    role: membership.role.key,
    designation: membership.designation,
    workspace: workspaceForOrgType(membership.organisation.type).key,
  };
}

export async function actors() {
  const entries = await Promise.all((Object.keys(USERS) as DemoUser[]).map(async (key) => [key, await actorFor(key)] as const));
  return Object.fromEntries(entries) as Record<DemoUser, Actor>;
}

/** yyyy-mm-dd relative to today (UTC), so date rules stay valid whenever the suite runs. */
export function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

const RUN_TAG = randomUUID().slice(0, 8).toUpperCase();
let serial = 0;

/** Invoice numbers unique across the test files of a run (the database is recreated for every run). */
export function uniqueInvoiceNumber(tag: string): string {
  serial += 1;
  return `T/${tag}/${RUN_TAG}/${serial}`;
}

export async function invoicePdf(options: { invoiceNumber: string; cp: CpKey; builder: BuilderKey; amountPaise: bigint; invoiceDate: string; dueDate?: string }) {
  const data = buildInvoiceDocument({
    invoiceNumber: options.invoiceNumber,
    cp: options.cp,
    builder: options.builder,
    project: PROJECT_FOR[options.builder].key,
    invoiceDate: options.invoiceDate,
    dueDate: options.dueDate,
    amountPaise: options.amountPaise,
    description: "Brokerage on sale of residential units",
    detail: `Automated test invoice ${options.invoiceNumber}`,
  });
  return renderBrokerageInvoicePdf(data);
}

export async function orgId(name: BuilderKey | CpKey): Promise<string> {
  const email = USERS[name];
  const membership = await db.organisationUser.findFirstOrThrow({ where: { user: { email } } });
  return membership.organisationId;
}

export interface SubmitOptions {
  cp?: CpKey;
  builder?: BuilderKey;
  amount?: string;
  invoiceDate?: string;
  dueDate?: string | null;
  invoiceNumber?: string;
  gstAmount?: string;
}

/** Submits a real PDF invoice through the service as the given channel partner. */
export async function submitTestInvoice(cpActor: Actor, options: SubmitOptions = {}) {
  const cp = options.cp ?? (cpActor.email === USERS.urbannest ? "urbannest" : "prestige");
  const builder = options.builder ?? "godrej";
  const invoiceNumber = options.invoiceNumber ?? uniqueInvoiceNumber(builder);
  const invoiceDate = options.invoiceDate ?? isoDate(-10);
  const dueDate = options.dueDate === null ? undefined : (options.dueDate ?? isoDate(60));
  const amount = options.amount ?? "500000";
  const amountPaise = parseRupeesToPaise(amount);
  if (amountPaise === null) throw new Error(`Invalid test amount ${amount}`);
  const builderId = await orgId(builder);
  const project = await db.project.findFirstOrThrow({ where: { builderId, code: PROJECT_FOR[builder].code } });
  const bytes = await invoicePdf({ invoiceNumber, cp, builder, amountPaise, invoiceDate, dueDate });
  const file: UploadedFile = { name: `${invoiceNumber.replace(/\//g, "-")}.pdf`, type: "application/pdf", bytes };
  const created = await submitInvoice(
    cpActor,
    { builderId, projectId: project.id, invoiceNumber, invoiceDate, dueDate, amount, gstAmount: options.gstAmount, description: "Automated test invoice" },
    file,
  );
  return { ...created, invoiceNumber, builderId, projectId: project.id, file };
}

/** Submits and fully approves an invoice, returning its id. */
export async function acceptedInvoice(cpActor: Actor, builderActor: Actor, options: SubmitOptions & { approvedAmount?: string } = {}) {
  const invoice = await submitTestInvoice(cpActor, options);
  await approveInvoice(builderActor, invoice.id, { approvedAmount: options.approvedAmount, comment: "Verified against the booking register." });
  return invoice;
}

export async function expectDomainError(promise: Promise<unknown>, code: DomainErrorCode, message?: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected a ${code} DomainError`).toMatchObject({ name: "DomainError", code });
  if (message) expect((error as Error).message).toMatch(message);
}

export async function expectValidationError(promise: Promise<unknown>, field?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ZodError);
  if (field) expect((error as ZodError).issues.map((i) => i.path.join("."))).toContain(field);
}

export async function auditActions(entityId: string): Promise<string[]> {
  const rows = await db.auditLog.findMany({ where: { entityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map((r) => r.action);
}
