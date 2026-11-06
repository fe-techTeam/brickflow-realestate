import { describe, expect, it } from "vitest";
import { checkInvoiceConsistency } from "../invoice-integrity/consistency";
import { IRN_PATTERN, ACK_NUMBER_PATTERN } from "../invoice-integrity/irn";
import { splitGstInclusive } from "../pdf/brokerage-invoice";
import { DEMO_DATASETS, demoClock, GST_RATE_PERCENT, invoiceBrokerageContext } from "./catalogue";
import { demoBrokerageContext } from "./brokerage-context";

const clock = demoClock(new Date("2026-11-03T06:30:00.000Z"));
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe.each(Object.values(DEMO_DATASETS))("brokerage particulars for dataset $key", (dataset) => {
  const documents = [...dataset.invoices(clock), ...dataset.samples(clock)];

  it("passes the invoice consistency rules for every invoice and sample", () => {
    for (const doc of documents) {
      const context = invoiceBrokerageContext(doc, dataset);
      const cp = dataset.organisations[doc.cp]!;
      const builder = dataset.organisations[doc.builder]!;
      const mode = cp.state === builder.state ? "INTRA" : "INTER";
      const gst = splitGstInclusive(doc.amountPaise, GST_RATE_PERCENT, mode);
      const issues = checkInvoiceConsistency({
        today: clock.now,
        invoiceDate: day(doc.invoiceDate),
        dueDate: doc.dueDate ? day(doc.dueDate) : null,
        totalPaise: doc.amountPaise,
        gstAmountPaise: gst.cgstPaise + gst.sgstPaise + gst.igstPaise,
        taxableValuePaise: gst.taxablePaise,
        cgstPaise: gst.cgstPaise,
        sgstPaise: gst.sgstPaise,
        igstPaise: gst.igstPaise,
        gstRateBps: GST_RATE_PERCENT * 100,
        supplierGstin: cp.gstin,
        recipientGstin: builder.gstin,
        agreementDate: day(context.agreementDate),
        agreementValuePaise: context.agreementValuePaise,
        agreementBrokerageBps: context.agreementBrokerageBps,
        tdsRateBps: context.tdsRateBps,
        irn: context.eInvoice?.irn ?? null,
        eInvoiceAckNumber: context.eInvoice?.ackNumber ?? null,
        eInvoiceAckDate: context.eInvoice ? day(context.eInvoice.ackDate) : null,
      });
      expect(issues, doc.invoiceNumber).toEqual([]);
    }
  });

  it("limits the buyer to initials and issues well-formed e-invoice references", () => {
    for (const doc of documents) {
      const context = invoiceBrokerageContext(doc, dataset);
      expect(context.buyerInitials).toMatch(/^[A-Z]{1,4}$/);
      expect(context.agreementDate <= doc.invoiceDate).toBe(true);
      if (context.eInvoice) {
        expect(context.eInvoice.irn).toMatch(IRN_PATTERN);
        expect(context.eInvoice.ackNumber).toMatch(ACK_NUMBER_PATTERN);
        expect(context.eInvoice.ackDate >= doc.invoiceDate).toBe(true);
      }
    }
  });
});

describe("demoBrokerageContext", () => {
  const input = { invoiceNumber: "T/GODREJ/ABC/7", invoiceDate: "2026-10-20", amountPaise: 5_00_000_00n, gstRatePercent: 18, supplierGstin: "27AAPFP9005H1Z6" };

  it("is deterministic per invoice number", () => {
    expect(demoBrokerageContext(input)).toEqual(demoBrokerageContext(input));
    expect(demoBrokerageContext({ ...input, invoiceNumber: "T/GODREJ/ABC/8" }).agreementRegistrationNumber).not.toBe(demoBrokerageContext(input).agreementRegistrationNumber);
  });

  it("reads the brokerage rate quoted in the description", () => {
    expect(demoBrokerageContext({ ...input, detail: "Brokerage @ 2.5% of agreement value" }).agreementBrokerageBps).toBe(250);
    expect(demoBrokerageContext(input).agreementBrokerageBps).toBe(200);
  });

  it("issues an IRN only when asked and a supplier GSTIN exists", () => {
    expect(demoBrokerageContext(input).eInvoice).toBeNull();
    expect(demoBrokerageContext({ ...input, eInvoice: true }).eInvoice?.irn).toMatch(IRN_PATTERN);
    expect(demoBrokerageContext({ ...input, eInvoice: true, supplierGstin: null }).eInvoice).toBeNull();
  });
});
