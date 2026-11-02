import { describe, expect, it } from "vitest";
import {
  isTextSparse,
  linesFromPositionedText,
  matchBuilder,
  matchProject,
  nameSimilarity,
  parseAmount,
  parseInvoiceDate,
  parseInvoiceText,
  type BuilderCandidate,
  type PositionedText,
} from "./invoice-fields";

/** Lines as reconstructed from a BrickFlow brokerage invoice PDF (intra-state, CGST + SGST). */
const DIGITAL_INVOICE = [
  "Prestige Realty Partners LLP\tTAX INVOICE",
  "\tOriginal for recipient",
  "(Demo)",
  "\tInvoice No.\tGFH/2026/001",
  "Real estate channel partner · Brokerage & advisory services",
  "\tInvoice Date\t20 Oct 2026",
  "\tDue Date\t19 Dec 2026",
  "\tPlace of Supply\tMaharashtra (27)",
  "SUPPLIER (CHANNEL PARTNER)\tBILL TO (BUILDER)",
  "Prestige Realty Partners LLP (Demo)\tGodrej Properties Demo Limited",
  "Office 702, Demo Corporate Park, Andheri East\tDemo Business District, Vikhroli East",
  "Mumbai, Maharashtra 400069\tMumbai, Maharashtra 400079",
  "GSTIN: 27AAPFP9005H1Z6\tGSTIN: 27AAACG9002E1Z3",
  "PAN: AAPFP9005H\tPAN: AAACG9002E",
  "PROJECT",
  "Greenfield Heights (GFH), Pune\tProject RERA: P52100099011",
  "#\tDESCRIPTION OF SERVICE\tSAC\tTAXABLE VALUE",
  "1 Brokerage on sale of residential units — Tower B\t997222\tINR 4,23,728.81",
  "\tTaxable value\tINR 4,23,728.81",
  "\tCGST @ 9%\tINR 38,135.59",
  "\tSGST @ 9%\tINR 38,135.60",
  "\tTOTAL INVOICE VALUE\tINR 5,00,000.00",
  "Amount in words",
  "Indian Rupees Five Lakh Only",
  "BANK DETAILS FOR PAYMENT\tFor Prestige Realty Partners LLP (Demo)",
  "Account name Prestige Realty Partners LLP (Demo)",
].join("\n");

const BUILDERS: BuilderCandidate[] = [
  { id: "godrej", name: "Godrej Properties Demo", legalName: "Godrej Properties Demo Limited", gstin: "27AAACG9002E1Z3" },
  { id: "skyline", name: "Skyline Habitat Developers", legalName: "Skyline Habitat Developers Demo LLP", gstin: "29AAKFS9003F1Z1" },
];

describe("parseInvoiceText — digital PDF layout", () => {
  const fields = parseInvoiceText(DIGITAL_INVOICE);

  it("reads the invoice number and dates", () => {
    expect(fields.invoiceNumber).toBe("GFH/2026/001");
    expect(fields.invoiceDate).toBe("2026-10-20");
    expect(fields.dueDate).toBe("2026-12-19");
  });

  it("separates supplier and builder from the two-column party block", () => {
    expect(fields.supplierName).toBe("Prestige Realty Partners LLP (Demo)");
    expect(fields.builderName).toBe("Godrej Properties Demo Limited");
    expect(fields.supplierGstin).toBe("27AAPFP9005H1Z6");
    expect(fields.builderGstin).toBe("27AAACG9002E1Z3");
    expect(fields.gstins).toEqual(["27AAPFP9005H1Z6", "27AAACG9002E1Z3"]);
  });

  it("reads taxable value, CGST/SGST and the GST-inclusive total", () => {
    expect(fields.taxableAmount).toBe("423728.81");
    expect(fields.cgstAmount).toBe("38135.59");
    expect(fields.sgstAmount).toBe("38135.60");
    expect(fields.igstAmount).toBeUndefined();
    expect(fields.taxAmount).toBe("76271.19");
    expect(fields.totalAmount).toBe("500000.00");
    expect(fields.amountsReconcile).toBe(true);
  });
});

describe("parseInvoiceText — OCR-style text", () => {
  it("handles single-spaced OCR output with IGST and labelled parties", () => {
    const text = [
      "TAX INVOICE",
      "Invoice No: RGD/2026/007",
      "Invoice Date: 05/10/2026",
      "Due Date: 19-Nov-2026",
      "Bill To: Skyline Habitat Developers Demo LLP",
      "Supplier GSTIN 27AAPFP9005H1Z6",
      "Buyer GSTIN 29AAKFS9003F1Z1",
      "Taxable value ₹3,55,932.20",
      "IGST @ 18% ₹64,067.80",
      "Grand Total ₹4,20,000.00",
    ].join("\n");
    const fields = parseInvoiceText(text);
    expect(fields.invoiceNumber).toBe("RGD/2026/007");
    expect(fields.invoiceDate).toBe("2026-10-05");
    expect(fields.dueDate).toBe("2026-11-19");
    expect(fields.builderName).toBe("Skyline Habitat Developers Demo LLP");
    expect(fields.supplierGstin).toBe("27AAPFP9005H1Z6");
    expect(fields.builderGstin).toBe("29AAKFS9003F1Z1");
    expect(fields.igstAmount).toBe("64067.80");
    expect(fields.taxAmount).toBe("64067.80");
    expect(fields.totalAmount).toBe("420000.00");
    expect(fields.amountsReconcile).toBe(true);
  });

  it("treats runs of spaces as column breaks", () => {
    const text = ["SUPPLIER        BILL TO", "Acme Realty Advisors LLP        Godrej Properties Demo Limited", "GSTIN: 27AAPFP9005H1Z6     GSTIN: 27AAACG9002E1Z3"].join("\n");
    const fields = parseInvoiceText(text);
    expect(fields.supplierName).toBe("Acme Realty Advisors LLP");
    expect(fields.builderName).toBe("Godrej Properties Demo Limited");
    expect(fields.builderGstin).toBe("27AAACG9002E1Z3");
  });

  it("reads real Tesseract output of a scanned invoice, correcting common OCR slips", () => {
    const text = [
      "Prestige Realty Partners LLP (Demo) TAX INVOICE",
      "Invoice No.        RGD/2026/019",
      "Invoice Date      26 Oct 2026",
      "Due Date          10 Dec 2026",
      "SUPPLIER                                                               BILLTO",
      "Prestige Realty Partners LLP (Demo)                    Skyline Habitat Developers Demo LLP",
      "Andheri East, Mumbai 400069                          Residency Road, Bengaluru 560025",
      "GSTIN: 27AAPFP9005H1Z6                             GSTIN: 29AAKFS9003F121",
      "Project: Royal Gardens (RGD), Bengaluru",
      "Taxable value              INR 2,54,237.29",
      "IGST @ 18%            INR 45,762.71",
      "TOTAL INVOICE VALUINR 3,00,000.00",
    ].join("\n");
    const fields = parseInvoiceText(text);
    expect(fields.invoiceNumber).toBe("RGD/2026/019");
    expect(fields.invoiceDate).toBe("2026-10-26");
    expect(fields.dueDate).toBe("2026-12-10");
    expect(fields.supplierName).toBe("Prestige Realty Partners LLP (Demo)");
    expect(fields.builderName).toBe("Skyline Habitat Developers Demo LLP");
    expect(fields.builderGstin).toBe("29AAKFS9003F1Z1");
    expect(fields.totalAmount).toBe("300000.00");
    expect(fields.taxAmount).toBe("45762.71");
    expect(matchBuilder(fields, BUILDERS)).toEqual({ id: "skyline", by: "gstin" });
  });

  it("splits party columns by character position when the header has single spacing between columns", () => {
    const text = ["Supplier Details        Bill To", "Acme Realty LLP   Godrej Properties Demo Limited", "                        GSTIN 27AAACG9002E1Z3"].join("\n");
    const fields = parseInvoiceText(text);
    expect(fields.supplierName).toBe("Acme Realty LLP");
    expect(fields.builderName).toBe("Godrej Properties Demo Limited");
    expect(fields.builderGstin).toBe("27AAACG9002E1Z3");
  });

  it("strips the document title from a supplier name taken from the first line", () => {
    expect(parseInvoiceText("Acme Realty Advisors LLP TAX INVOICE\nInvoice No: AR/26/11").supplierName).toBe("Acme Realty Advisors LLP");
  });

  it("derives the total from taxable value and tax when no total is printed", () => {
    const fields = parseInvoiceText("Taxable Amount 1,00,000.00\nCGST 9% 9,000.00\nSGST 9% 9,000.00");
    expect(fields.taxAmount).toBe("18000.00");
    expect(fields.totalAmount).toBe("118000.00");
  });

  it("derives tax from the total and taxable value", () => {
    const fields = parseInvoiceText("Sub Total Rs. 50,000\nInvoice Total Rs. 59,000");
    expect(fields.taxAmount).toBe("9000.00");
    expect(fields.totalAmount).toBe("59000.00");
  });

  it("does not take the amount in words as the total", () => {
    const fields = parseInvoiceText("Total amount in words: Rupees Five Lakh Only\nTotal Amount 5,00,000.00");
    expect(fields.totalAmount).toBe("500000.00");
  });

  it("returns an empty result for unrelated text", () => {
    const fields = parseInvoiceText("Meeting notes\nDiscussed the launch plan.");
    expect(fields.invoiceNumber).toBeUndefined();
    expect(fields.totalAmount).toBeUndefined();
    expect(fields.gstins).toEqual([]);
    expect(fields.amountsReconcile).toBeUndefined();
  });
});

describe("parseInvoiceDate", () => {
  it.each([
    ["20 Oct 2026", "2026-10-20"],
    ["28 Sept 2026", "2026-09-28"],
    ["5th March, 2026", "2026-03-05"],
    ["October 8, 2026", "2026-10-08"],
    ["2026-10-08", "2026-10-08"],
    ["08/10/2026", "2026-10-08"],
    ["08.10.26", "2026-10-08"],
  ])("parses %s", (input, expected) => {
    expect(parseInvoiceDate(input)).toBe(expected);
  });

  it("rejects impossible dates", () => {
    expect(parseInvoiceDate("31/02/2026")).toBeUndefined();
    expect(parseInvoiceDate("no date here")).toBeUndefined();
  });
});

describe("parseAmount", () => {
  it("reads Indian-grouped and plain amounts, ignoring percentages", () => {
    expect(parseAmount("INR 4,23,728.81")).toBe("423728.81");
    expect(parseAmount("CGST @ 9% ₹38,135.59")).toBe("38135.59");
    expect(parseAmount("Rs. 1250")).toBe("1250.00");
    expect(parseAmount("@ 18%")).toBeUndefined();
  });
});

describe("linesFromPositionedText", () => {
  const item = (str: string, x: number, y: number, width: number, height = 8.5): PositionedText => ({ str, x, y, width, height });

  it("groups items into top-to-bottom lines, inserting tabs for wide gaps and right-column starts", () => {
    const lines = linesFromPositionedText(
      [
        item("INR 2,50,000.00", 477.7, 411.9, 65.5, 9),
        item("Taxable value", 311.3, 411.9, 56, 9),
        item("GSTIN:", 44, 599.9, 27.1, 8),
        item(" ", 71.1, 599.9, 10.9, 0),
        item("27AACCU9006J1Z2", 82, 599.9, 77),
        item("Pune, Maharashtra 411045", 44, 613.9, 103),
        item("GSTIN: 27AAACG9002E1Z3", 309.6, 612.9, 110),
      ],
      595.28,
    );
    expect(lines).toEqual(["Pune, Maharashtra 411045\tGSTIN: 27AAACG9002E1Z3", "GSTIN: 27AACCU9006J1Z2", "\tTaxable value\tINR 2,50,000.00"]);
  });
});

describe("matchBuilder", () => {
  it("prefers an exact GSTIN match", () => {
    const fields = parseInvoiceText(DIGITAL_INVOICE);
    expect(matchBuilder(fields, BUILDERS)).toEqual({ id: "godrej", by: "gstin" });
  });

  it("falls back to the builder name, ignoring legal suffixes", () => {
    expect(matchBuilder({ gstins: [], builderName: "SKYLINE HABITAT DEVELOPERS LLP" }, BUILDERS)).toEqual({ id: "skyline", by: "name" });
  });

  it("returns null when nothing matches", () => {
    expect(matchBuilder({ gstins: ["30AAECC9004G1Z8"], builderName: "Coastal Crest Builders" }, BUILDERS)).toBeNull();
  });

  it("scores name similarity on meaningful tokens", () => {
    expect(nameSimilarity("Godrej Properties Demo Limited", "Godrej Properties Demo")).toBe(1);
    expect(nameSimilarity("Godrej Properties", "Skyline Habitat")).toBe(0);
  });
});

describe("matchProject", () => {
  const projects = [
    { id: "gfh", name: "Greenfield Heights", code: "GFH" },
    { id: "ghz", name: "Godrej Horizon", code: "GHZ" },
  ];

  it("matches the bracketed project code or the project name", () => {
    expect(matchProject(DIGITAL_INVOICE, projects)).toBe("gfh");
    expect(matchProject("Brokerage for units at Godrej Horizon, Wadala", projects)).toBe("ghz");
    expect(matchProject("Unrelated project", projects)).toBeNull();
  });
});

describe("isTextSparse", () => {
  it("flags scanned documents with little or no text layer", () => {
    expect(isTextSparse("")).toBe(true);
    expect(isTextSparse(" \n Page 1 \n")).toBe(true);
    expect(isTextSparse(DIGITAL_INVOICE)).toBe(false);
  });
});
