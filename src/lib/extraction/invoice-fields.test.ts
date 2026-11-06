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

  it("reads the GST rate and place of supply", () => {
    expect(fields.gstRateBps).toBe(1800);
    expect(fields.placeOfSupplyStateCode).toBe("27");
    expect(fields.irn).toBeUndefined();
    expect(fields.agreementRegistrationNumber).toBeUndefined();
  });
});

const IRN = "a46a5d32a3e25e8fa098d654131b148eaffdb12388d327717ab81f892cfe0409";

/** Lines as reconstructed from a brokerage invoice with e-invoice and booking particulars. */
const PARTICULARS_INVOICE = [
  "Prestige Realty Partners LLP\tTAX INVOICE",
  "\tOriginal for recipient",
  "(Demo)",
  "\tInvoice No.\tGFH/2026/001",
  "Real estate channel partner · Brokerage & advisory services",
  "\tInvoice Date\t20 Oct 2026",
  `IRN: ${IRN}`,
  "\tDue Date\t19 Dec 2026",
  "\tPlace of Supply\tMaharashtra (27)",
  "\tAck No.\t112004200659788",
  "\tAck Date\t21 Oct 2026",
  "SUPPLIER (CHANNEL PARTNER)\tBILL TO (BUILDER)",
  "Prestige Realty Partners LLP (Demo)\tGodrej Properties Demo Limited",
  "Office 702, Demo Corporate Park, Andheri East\tDemo Business District, Vikhroli East",
  "GSTIN: 27AAPFP9005H1Z6\tGSTIN: 27AAACG9002E1Z3",
  "PROJECT",
  "Greenfield Heights (GFH), Pune\tProject RERA: P52100099011",
  "BOOKING & AGREEMENT",
  "Booking: Tower B · Unit 1104 · Buyer RK\tAgreement value: INR 2,11,86,400.00",
  "Agreement for sale: HVL-2/9131/2026\tAgreement date: 15 Sept 2026",
  "Brokerage: 2.5% of agreement value · INR 5,29,660.00\tTDS u/s 194H: 2%",
  "#\tDESCRIPTION OF SERVICE\tSAC\tTAXABLE VALUE",
  "1 Brokerage on sale of residential units — Tower B\t997222\tINR 4,23,728.81",
  "\tTaxable value\tINR 4,23,728.81",
  "\tCGST @ 9%\tINR 38,135.59",
  "\tSGST @ 9%\tINR 38,135.60",
  "\tTOTAL INVOICE VALUE\tINR 5,00,000.00",
].join("\n");

describe("parseInvoiceText — booking, agreement and e-invoice particulars", () => {
  const fields = parseInvoiceText(PARTICULARS_INVOICE);

  it("reads the e-invoice registration", () => {
    expect(fields.irn).toBe(IRN);
    expect(fields.ackNumber).toBe("112004200659788");
    expect(fields.ackDate).toBe("2026-10-21");
  });

  it("reads the booking and agreement", () => {
    expect(fields).toMatchObject({
      bookingTower: "B",
      bookingUnit: "1104",
      buyerInitials: "RK",
      agreementRegistrationNumber: "HVL-2/9131/2026",
      agreementDate: "2026-09-15",
      agreementValue: "21186400.00",
      agreementBrokerageRate: "2.5",
      tdsRate: "2",
    });
  });

  it("reads the TDS rate without mistaking the section number for it", () => {
    expect(parseInvoiceText("TDS u/s 194H: 2%").tdsRate).toBe("2");
    expect(parseInvoiceText("TDS @ 5% under section 194H").tdsRate).toBe("5");
    expect(parseInvoiceText("Section 194H applies").tdsRate).toBeUndefined();
  });

  it("keeps the existing fields intact", () => {
    expect(fields).toMatchObject({
      invoiceNumber: "GFH/2026/001",
      invoiceDate: "2026-10-20",
      dueDate: "2026-12-19",
      builderGstin: "27AAACG9002E1Z3",
      taxableAmount: "423728.81",
      totalAmount: "500000.00",
      gstRateBps: 1800,
      placeOfSupplyStateCode: "27",
      amountsReconcile: true,
    });
  });
});

describe("parseInvoiceText — particulars in other layouts", () => {
  it("joins an IRN wrapped across two lines and tolerates spaced acknowledgement numbers", () => {
    const fields = parseInvoiceText([`IRN : ${IRN.slice(0, 40)}`, IRN.slice(40), "Ack No : 1120 0420 0659 788", "Ack Dt / Ack Date : 21/10/2026"].join("\n"));
    expect(fields.irn).toBe(IRN);
    expect(fields.ackNumber).toBe("112004200659788");
    expect(fields.ackDate).toBe("2026-10-21");
  });

  it("finds an unlabelled IRN and ignores hex runs of the wrong length", () => {
    expect(parseInvoiceText(`E-invoice\n${IRN.toUpperCase()}`).irn).toBe(IRN);
    expect(parseInvoiceText(`IRN: ${IRN.slice(0, 60)}`).irn).toBeUndefined();
  });

  it.each([
    ["Place of Supply: 29-Karnataka", "29"],
    ["Place of Supply   Karnataka", "29"],
    ["Place of supply: Andhra Pradesh", "37"],
    ["Place of Supply: (30) Goa", "30"],
    ["Place of Supply: 99", undefined],
  ])("reads the place of supply from %s", (line, code) => {
    expect(parseInvoiceText(line).placeOfSupplyStateCode).toBe(code);
  });

  it("derives the GST rate from IGST or half-rate CGST", () => {
    expect(parseInvoiceText("IGST @ 18% ₹64,067.80").gstRateBps).toBe(1800);
    expect(parseInvoiceText("CGST 2.5% 250.00\nSGST 2.5% 250.00").gstRateBps).toBe(500);
    expect(parseInvoiceText("Taxable value 1000").gstRateBps).toBeUndefined();
  });

  it("reads unit and wing from the service description when there is no booking line", () => {
    const fields = parseInvoiceText(
      [
        "SUPPLIER        BILL TO",
        "Flat 12, Sea View, Bandra        Godrej Properties Demo Limited",
        "Description of service",
        "Brokerage on sale of Flat No. 1802, Wing B — Brokerage @ 2% of agreement value",
        "Agreement No.: MBI-12/3456/2026 registered on 02/09/2026",
        "Sale consideration Rs. 1,25,00,000",
      ].join("\n"),
    );
    expect(fields).toMatchObject({
      bookingUnit: "1802",
      bookingTower: "Wing B",
      agreementRegistrationNumber: "MBI-12/3456/2026",
      agreementDate: "2026-09-02",
      agreementValue: "12500000.00",
      agreementBrokerageRate: "2",
    });
  });

  it("does not read units from addresses above the service description", () => {
    const fields = parseInvoiceText(["Flat 12, Sea View, Bandra", "Office 702, Demo Corporate Park"].join("\n"));
    expect(fields.bookingUnit).toBeUndefined();
    expect(fields.bookingTower).toBeUndefined();
  });

  it("only takes buyer initials, never names", () => {
    expect(parseInvoiceText("Booking: Tower C · Unit 0405 · Buyer A.K.").buyerInitials).toBe("AK");
    expect(parseInvoiceText("Buyer initials: PD").buyerInitials).toBe("PD");
    expect(parseInvoiceText("Booking: Tower C · Unit 0405 · Buyer Rahul Kumar").buyerInitials).toBeUndefined();
    expect(parseInvoiceText("Booking: Tower C · Unit 0405 · Buyer RAHUL").buyerInitials).toBeUndefined();
    expect(parseInvoiceText("Buyer: ABC Developers Ltd\nBuyer GSTIN 29AAKFS9003F1Z1").buyerInitials).toBeUndefined();
  });

  it("does not take the computed brokerage as the agreement value or a date as the agreement number", () => {
    const fields = parseInvoiceText("Brokerage: 2% of agreement value · INR 4,23,728.00\nAgreement for sale registered 15/09/2026");
    expect(fields.agreementValue).toBeUndefined();
    expect(fields.agreementRegistrationNumber).toBeUndefined();
    expect(fields.agreementBrokerageRate).toBe("2");
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
