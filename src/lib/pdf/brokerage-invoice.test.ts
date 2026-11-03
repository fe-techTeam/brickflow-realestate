import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildInvoiceDocument, SAMPLE_INVOICES } from "../demo/catalogue";
import { renderBrokerageInvoicePdf, splitGstInclusive } from "./brokerage-invoice";

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

describe("splitGstInclusive", () => {
  it("splits an intra-state total into CGST and SGST", () => {
    expect(splitGstInclusive(5_00_000_00n, 18, "INTRA")).toEqual({
      taxablePaise: 4_23_728_81n,
      cgstPaise: 38_135_59n,
      sgstPaise: 38_135_60n,
      igstPaise: 0n,
      totalPaise: 5_00_000_00n,
    });
  });

  it("puts the whole tax in IGST for inter-state supplies", () => {
    expect(splitGstInclusive(2_95_000_00n, 18, "INTER")).toEqual({
      taxablePaise: 2_50_000_00n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      igstPaise: 45_000_00n,
      totalPaise: 2_95_000_00n,
    });
  });

  it("rounds the taxable value half up to the paisa", () => {
    expect(splitGstInclusive(118n, 18, "INTRA")).toMatchObject({ taxablePaise: 100n, cgstPaise: 9n, sgstPaise: 9n });
    expect(splitGstInclusive(101n, 18, "INTRA")).toMatchObject({ taxablePaise: 86n, cgstPaise: 7n, sgstPaise: 8n });
  });

  it("always reconciles to the total", () => {
    for (const total of [1n, 101n, 3_50_000_00n, 8_40_000_01n, 12_34_567_89n]) {
      for (const mode of ["INTRA", "INTER"] as const) {
        const split = splitGstInclusive(total, 18, mode);
        expect(split.taxablePaise + split.cgstPaise + split.sgstPaise + split.igstPaise).toBe(total);
      }
    }
  });

  it("returns the total as taxable value at a zero rate", () => {
    expect(splitGstInclusive(5_00_000_00n, 0, "INTRA")).toMatchObject({ taxablePaise: 5_00_000_00n, cgstPaise: 0n, sgstPaise: 0n });
  });
});

describe("renderBrokerageInvoicePdf", () => {
  it("renders a valid single-page PDF", async () => {
    const bytes = await renderBrokerageInvoicePdf(buildInvoiceDocument(SAMPLE_INVOICES[0]!));

    expect(latin1(bytes.subarray(0, 5))).toBe("%PDF-");
    expect(latin1(bytes.subarray(-8))).toContain("%%EOF");

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getTitle()).toBe("Tax Invoice GFH/2026/001");
  });

  it("renders invoices without GST", async () => {
    const bytes = await renderBrokerageInvoicePdf({ ...buildInvoiceDocument(SAMPLE_INVOICES[1]!), gst: null });
    expect(latin1(bytes.subarray(0, 5))).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
