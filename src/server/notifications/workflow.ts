import "server-only";
import type { RoleKey } from "@/generated/prisma/client";
import type { Actor } from "../auth/session";
import type { Tx } from "../db";
import { notify, type NotifyResult } from "./notify";

/**
 * Workflow event wiring for the invoice and financing services. Each helper loads what its template
 * needs through the caller's transaction and calls `notify`, so a service needs a single line.
 */

const ROLES = {
  cp: ["CP_ADMIN"],
  builder: ["BUILDER_ACCOUNTS"],
  financier: ["FINANCE_OPS"],
} satisfies Record<string, RoleKey[]>;

type Who = Pick<Actor, "userId"> | null;

const exclude = (actor: Who) => (actor ? [actor.userId] : []);

async function invoiceData(tx: Tx, invoiceId: string, note?: string | null) {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      id: true,
      invoiceNumber: true,
      reference: true,
      amountPaise: true,
      approvedAmountPaise: true,
      cpId: true,
      builderId: true,
      cp: { select: { name: true } },
      builder: { select: { name: true } },
      project: { select: { name: true } },
    },
  });
  return {
    invoice,
    data: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceReference: invoice.reference,
      amountPaise: invoice.amountPaise.toString(),
      approvedAmountPaise: invoice.approvedAmountPaise?.toString() ?? null,
      cpName: invoice.cp.name,
      builderName: invoice.builder.name,
      projectName: invoice.project.name,
      note: note ?? null,
    },
  };
}

/** A channel partner submitted (or resubmitted after clarification) an invoice: tell the builder. */
export async function notifyInvoiceSubmitted(tx: Tx, invoiceId: string, actor: Who, options: { resubmitted?: boolean; note?: string } = {}): Promise<NotifyResult> {
  const { invoice, data } = await invoiceData(tx, invoiceId, options.note);
  return notify(tx, {
    event: options.resubmitted ? "invoice.resubmitted" : "invoice.submitted",
    recipients: [{ organisationId: invoice.builderId, roles: ROLES.builder }],
    data,
    excludeUserIds: exclude(actor),
  });
}

const INVOICE_DECISIONS = {
  UNDER_REVIEW: "invoice.under_review",
  APPROVED: "invoice.approved",
  REJECTED: "invoice.rejected",
  CLARIFICATION_REQUESTED: "invoice.clarification_requested",
} as const;

/** The builder moved an invoice through review: tell the channel partner. */
export async function notifyInvoiceReviewed(tx: Tx, action: keyof typeof INVOICE_DECISIONS, invoiceId: string, actor: Who, comment?: string | null): Promise<NotifyResult> {
  const { invoice, data } = await invoiceData(tx, invoiceId, comment);
  return notify(tx, {
    event: INVOICE_DECISIONS[action],
    recipients: [{ organisationId: invoice.cpId, roles: ROLES.cp }],
    data,
    excludeUserIds: exclude(actor),
  });
}

export async function offerData(tx: Tx, offerId: string) {
  const offer = await tx.financingOffer.findUniqueOrThrow({
    where: { id: offerId },
    select: {
      id: true,
      reference: true,
      approvedAmountPaise: true,
      netPayablePaise: true,
      discountRateBps: true,
      validUntil: true,
      status: true,
      invoice: { select: { id: true, invoiceNumber: true, cpId: true, cp: { select: { name: true } }, builder: { select: { name: true } } } },
    },
  });
  return {
    offer,
    data: {
      offerId: offer.id,
      offerReference: offer.reference,
      invoiceId: offer.invoice.id,
      invoiceNumber: offer.invoice.invoiceNumber,
      approvedAmountPaise: offer.approvedAmountPaise.toString(),
      netPayablePaise: offer.netPayablePaise.toString(),
      discountRateBps: offer.discountRateBps,
      validUntil: offer.validUntil.toISOString(),
      cpName: offer.invoice.cp.name,
      builderName: offer.invoice.builder.name,
    },
  };
}

/** An offer was generated: tell the rest of the partner team and schedule the expiry reminder. */
export async function notifyOfferGenerated(tx: Tx, offerId: string, actor: Who): Promise<NotifyResult> {
  const { offer, data } = await offerData(tx, offerId);
  return notify(tx, {
    event: "offer.generated",
    recipients: [{ organisationId: offer.invoice.cpId, roles: ROLES.cp }],
    data,
    dedupeKey: `offer-generated:${offer.id}`,
    excludeUserIds: exclude(actor),
  });
}

async function requestData(tx: Tx, requestId: string) {
  return tx.financingRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: {
      id: true,
      reference: true,
      cpId: true,
      builderId: true,
      financierId: true,
      netPayablePaise: true,
      approvedAmountPaise: true,
      decisionNote: true,
      offer: { select: { reference: true } },
      invoice: { select: { id: true, invoiceNumber: true } },
      cp: { select: { name: true } },
      builder: { select: { name: true } },
      financier: { select: { name: true } },
      disbursement: { select: { reference: true, amountPaise: true, utr: true } },
      settlement: { select: { id: true, amountPaise: true, dueDate: true, reference: true } },
    },
  });
}

/** A partner accepted an offer: the financier has a request to decide; the partner team gets a receipt. */
export async function notifyOfferAccepted(tx: Tx, requestId: string, actor: Who): Promise<NotifyResult> {
  const r = await requestData(tx, requestId);
  return notify(tx, {
    event: "offer.accepted",
    recipients: [
      { organisationId: r.financierId, roles: ROLES.financier },
      { organisationId: r.cpId, roles: ROLES.cp },
    ],
    data: {
      requestId: r.id,
      requestReference: r.reference,
      offerReference: r.offer.reference,
      invoiceId: r.invoice.id,
      invoiceNumber: r.invoice.invoiceNumber,
      netPayablePaise: r.netPayablePaise.toString(),
      cpName: r.cp.name,
      builderName: r.builder.name,
    },
    excludeUserIds: exclude(actor),
  });
}

/** The financier approved or declined a financing request: tell the partner. */
export async function notifyFinancingDecision(tx: Tx, requestId: string, approved: boolean, actor: Who): Promise<NotifyResult> {
  const r = await requestData(tx, requestId);
  return notify(tx, {
    event: approved ? "financing.approved" : "financing.rejected",
    recipients: [{ organisationId: r.cpId, roles: ROLES.cp }],
    data: {
      requestId: r.id,
      requestReference: r.reference,
      invoiceId: r.invoice.id,
      invoiceNumber: r.invoice.invoiceNumber,
      netPayablePaise: r.netPayablePaise.toString(),
      cpName: r.cp.name,
      builderName: r.builder.name,
      financierName: r.financier.name,
      note: r.decisionNote,
    },
    excludeUserIds: exclude(actor),
  });
}

/** Payout initiated (partner) or completed (partner, and the builder whose settlement is now scheduled). */
export async function notifyDisbursement(tx: Tx, requestId: string, completed: boolean, actor: Who): Promise<NotifyResult> {
  const r = await requestData(tx, requestId);
  if (!r.disbursement) throw new Error(`Financing request ${r.reference} has no disbursement`);
  return notify(tx, {
    event: completed ? "disbursement.completed" : "disbursement.initiated",
    recipients: completed
      ? [
          { organisationId: r.cpId, roles: ROLES.cp },
          { organisationId: r.builderId, roles: ROLES.builder },
        ]
      : [{ organisationId: r.cpId, roles: ROLES.cp }],
    data: {
      requestId: r.id,
      requestReference: r.reference,
      invoiceId: r.invoice.id,
      invoiceNumber: r.invoice.invoiceNumber,
      paymentReference: r.disbursement.reference,
      amountPaise: r.disbursement.amountPaise.toString(),
      cpName: r.cp.name,
      builderName: r.builder.name,
      utr: r.disbursement.utr,
      settlementAmountPaise: r.settlement?.amountPaise.toString() ?? null,
      settlementDueDate: r.settlement?.dueDate.toISOString().slice(0, 10) ?? null,
    },
    excludeUserIds: exclude(actor),
  });
}

export type SettlementEvent = "settlement.due_soon" | "settlement.due_today" | "settlement.overdue" | "settlement.settled";

/** Settlement reminders and confirmations go to the builder that owes and the financier that is owed. */
export async function notifySettlement(
  tx: Tx,
  requestId: string,
  event: SettlementEvent,
  actor: Who,
  options: { dedupeKey?: string; daysUntilDue?: number; daysOverdue?: number } = {},
): Promise<NotifyResult> {
  const r = await requestData(tx, requestId);
  if (!r.settlement) throw new Error(`Financing request ${r.reference} has no settlement`);
  return notify(tx, {
    event,
    recipients: [
      { organisationId: r.builderId, roles: ROLES.builder },
      { organisationId: r.financierId, roles: ROLES.financier },
    ],
    data: {
      settlementId: r.settlement.id,
      requestId: r.id,
      requestReference: r.reference,
      invoiceId: r.invoice.id,
      invoiceNumber: r.invoice.invoiceNumber,
      amountPaise: r.settlement.amountPaise.toString(),
      dueDate: r.settlement.dueDate.toISOString().slice(0, 10),
      builderName: r.builder.name,
      financierName: r.financier.name,
      cpName: r.cp.name,
      daysUntilDue: options.daysUntilDue,
      daysOverdue: options.daysOverdue,
      settlementReference: r.settlement.reference,
    },
    dedupeKey: options.dedupeKey,
    excludeUserIds: exclude(actor),
  });
}
