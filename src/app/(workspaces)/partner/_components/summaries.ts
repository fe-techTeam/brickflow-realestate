import "server-only";
import type { OfferInvoiceSummary } from "./offer-center";

/** Client-safe invoice summary for the offer dialog. */
export function offerInvoice(invoice: {
  id: string;
  invoiceNumber: string;
  builder: { name: string };
  project?: { name: string } | null;
}): OfferInvoiceSummary {
  return { id: invoice.id, invoiceNumber: invoice.invoiceNumber, builderName: invoice.builder.name, projectName: invoice.project?.name };
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
