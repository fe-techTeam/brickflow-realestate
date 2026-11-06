/**
 * Invoice-integrity particulars for seeded invoices: booking, agreement, GST split and e-invoice
 * fields (matching the printed sample PDF), the registry fingerprint and the builder's three-way
 * match attestation on approved invoices. Used by prisma/seed.ts.
 */
import type { PrismaClient } from "../../generated/prisma/client";
import { computeFingerprint } from "../invoice-integrity/fingerprint";
import { describeMatchItems, type MatchAttestation } from "../invoice-integrity/match";
import { splitGstInclusive } from "../pdf/brokerage-invoice";
import { GST_RATE_PERCENT, invoiceBrokerageContext } from "./catalogue";
import type { DemoDataset, DemoSeedInvoice } from "./types";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Invoice columns to spread into the seeded `invoice.create` data. */
export function seedInvoiceParticulars(inv: DemoSeedInvoice, dataset: DemoDataset) {
  const cp = dataset.organisations[inv.cp]!;
  const builder = dataset.organisations[inv.builder]!;
  const context = invoiceBrokerageContext(inv, dataset);
  const gst = splitGstInclusive(inv.amountPaise, GST_RATE_PERCENT, cp.state === builder.state ? "INTRA" : "INTER");
  return {
    bookingTower: context.bookingTower,
    bookingUnit: context.bookingUnit,
    buyerInitials: context.buyerInitials,
    agreementRegistrationNumber: context.agreementRegistrationNumber,
    agreementDate: day(context.agreementDate),
    agreementValuePaise: context.agreementValuePaise,
    agreementBrokerageBps: context.agreementBrokerageBps,
    taxableValuePaise: gst.taxablePaise,
    cgstPaise: gst.cgstPaise,
    sgstPaise: gst.sgstPaise,
    igstPaise: gst.igstPaise,
    gstRateBps: GST_RATE_PERCENT * 100,
    tdsRateBps: context.tdsRateBps,
    irn: context.eInvoice?.irn ?? null,
    eInvoiceAckNumber: context.eInvoice?.ackNumber ?? null,
    eInvoiceAckDate: context.eInvoice ? day(context.eInvoice.ackDate) : null,
    placeOfSupplyStateCode: builder.gstin?.slice(0, 2) ?? null,
    supplierGstin: cp.gstin ?? null,
    recipientGstin: builder.gstin ?? null,
  };
}

/** Registers the seeded invoice's fingerprint and attaches the attestation to its approval, if approved. */
export async function seedInvoiceIntegrity(db: PrismaClient, invoiceId: string) {
  const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { approvals: true } });
  await db.invoiceFingerprint.create({
    data: {
      invoiceId,
      ...computeFingerprint({
        supplierGstin: invoice.supplierGstin,
        recipientGstin: invoice.recipientGstin,
        cpId: invoice.cpId,
        builderId: invoice.builderId,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        totalPaise: invoice.amountPaise,
        irn: invoice.irn,
      }),
      createdAt: invoice.createdAt,
    },
  });
  const approval = invoice.approvals.find((a) => a.action === "APPROVED");
  if (!approval) return;
  const attestation: MatchAttestation = {
    version: 1,
    required: true,
    items: describeMatchItems(invoice).map((i) => ({ key: i.key, label: i.label, invoiceValue: i.invoiceValue })),
  };
  await db.invoiceApproval.update({
    where: { id: approval.id },
    data: { attestedById: approval.actorUserId, attestedByName: approval.actorName, attestedAt: approval.createdAt, attestation: attestation as object },
  });
}
