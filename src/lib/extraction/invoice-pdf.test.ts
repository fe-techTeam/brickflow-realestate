import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { buildInvoiceDocument, DEMO_DATASETS, demoClock, invoiceBrokerageContext } from "../demo/catalogue";
import { paiseToDecimalString } from "../money";
import { renderBrokerageInvoicePdf } from "../pdf/brokerage-invoice";
import { linesFromPositionedText, parseInvoiceText, type PositionedText } from "./invoice-fields";

/** Reads the text layer the same way the upload form does in the browser. */
async function readText(bytes: Uint8Array): Promise<string> {
  const task = getDocument({ data: bytes, verbosity: 0 });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const items: PositionedText[] = [];
    for (const item of content.items) {
      if ("str" in item) items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height });
    }
    return linesFromPositionedText(items, page.getViewport({ scale: 1 }).width).join("\n");
  } finally {
    await task.destroy();
  }
}

const clock = demoClock(new Date("2026-11-03T06:30:00.000Z"));

describe("extraction from rendered sample invoices", () => {
  const cases = Object.values(DEMO_DATASETS).flatMap((dataset) => dataset.samples(clock).map((sample) => ({ dataset, sample, name: `${dataset.key} ${sample.invoiceNumber}` })));

  it.each(cases)("pre-fills every printed field of $name", async ({ dataset, sample }) => {
    const context = invoiceBrokerageContext(sample, dataset);
    const document = buildInvoiceDocument(sample, dataset);
    const fields = parseInvoiceText(await readText(await renderBrokerageInvoicePdf(document)));

    expect(fields).toMatchObject({
      invoiceNumber: sample.invoiceNumber,
      invoiceDate: sample.invoiceDate,
      totalAmount: paiseToDecimalString(sample.amountPaise),
      gstRateBps: 1800,
      placeOfSupplyStateCode: document.recipient.gstin!.slice(0, 2),
      bookingTower: context.bookingTower,
      bookingUnit: context.bookingUnit,
      buyerInitials: context.buyerInitials,
      agreementRegistrationNumber: context.agreementRegistrationNumber,
      agreementDate: context.agreementDate,
      agreementValue: paiseToDecimalString(context.agreementValuePaise),
      amountsReconcile: true,
    });
    expect(fields.agreementBrokerageRate).toBe(String(context.agreementBrokerageBps / 100));
    if (context.eInvoice) {
      expect(fields).toMatchObject({ irn: context.eInvoice.irn, ackNumber: context.eInvoice.ackNumber, ackDate: context.eInvoice.ackDate });
    } else {
      expect(fields.irn).toBeUndefined();
      expect(fields.ackNumber).toBeUndefined();
    }
  });
});
