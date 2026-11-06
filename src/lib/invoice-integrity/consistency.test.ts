import { describe, expect, it } from "vitest";
import {
  agreedBrokeragePaise,
  applyBps,
  checkInvoiceConsistency,
  expectedSupplyMode,
  inferGstRateBps,
  normaliseBuyerInitials,
  splitInclusiveTotal,
  BUYER_INITIALS_PATTERN,
  type ConsistencyInput,
} from "./consistency";

const MH_CP = "27AAPFP9005H1Z6";
const MH_BUILDER = "27AAACG9002E1Z3";
const KA_BUILDER = "29AAKFS9003F1Z1";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** ₹5,00,000 intra-state brokerage at 18%: taxable 4,23,728.81 + CGST 38,135.59 + SGST 38,135.60. */
function intra(overrides: Partial<ConsistencyInput> = {}): ConsistencyInput {
  return {
    today: day("2026-11-06"),
    invoiceDate: day("2026-10-20"),
    dueDate: day("2026-12-19"),
    totalPaise: 5_00_000_00n,
    gstAmountPaise: 76_271_19n,
    taxableValuePaise: 4_23_728_81n,
    cgstPaise: 38_135_59n,
    sgstPaise: 38_135_60n,
    igstPaise: null,
    gstRateBps: 1800,
    supplierGstin: MH_CP,
    recipientGstin: MH_BUILDER,
    agreementDate: day("2026-09-30"),
    agreementValuePaise: 2_11_86_400_00n,
    agreementBrokerageBps: 200,
    tdsRateBps: 200,
    ...overrides,
  };
}

const fields = (input: ConsistencyInput) => checkInvoiceConsistency(input).map((i) => i.field);

describe("checkInvoiceConsistency", () => {
  it("accepts a consistent intra-state invoice", () => {
    expect(checkInvoiceConsistency(intra())).toEqual([]);
  });

  it("accepts a consistent inter-state invoice with IGST", () => {
    const input = intra({ recipientGstin: KA_BUILDER, cgstPaise: null, sgstPaise: null, igstPaise: 76_271_19n });
    expect(checkInvoiceConsistency(input)).toEqual([]);
  });

  it("requires total = taxable value + GST, allowing rounding to the rupee", () => {
    expect(fields(intra({ totalPaise: 5_00_000_00n + 100n, gstAmountPaise: null }))).toEqual([]);
    expect(fields(intra({ totalPaise: 5_00_002_00n, gstAmountPaise: null }))).toContain("amount");
  });

  it("requires the GST amount to equal the sum of the components", () => {
    expect(fields(intra({ gstAmountPaise: 76_000_00n }))).toContain("gstAmount");
  });

  it("requires a taxable value when the GST is broken down", () => {
    expect(fields(intra({ taxableValuePaise: null }))).toContain("taxableValue");
  });

  it("matches the GST split to the supply type from both GSTINs", () => {
    expect(fields(intra({ igstPaise: 1_00n }))).toContain("igst");
    expect(fields(intra({ cgstPaise: 38_000_00n, sgstPaise: 38_271_19n }))).toContain("sgst");
    const interWithCgst = intra({ recipientGstin: KA_BUILDER });
    expect(fields(interWithCgst)).toContain("cgst");
  });

  it("uses an explicit place of supply over the recipient's state", () => {
    const input = intra({ placeOfSupplyStateCode: "29", cgstPaise: null, sgstPaise: null, igstPaise: 76_271_19n });
    expect(checkInvoiceConsistency(input)).toEqual([]);
    expect(fields(intra({ placeOfSupplyStateCode: "99" }))).toContain("placeOfSupply");
  });

  it("skips the split check when a GSTIN is missing", () => {
    expect(checkInvoiceConsistency(intra({ supplierGstin: null, igstPaise: null }))).toEqual([]);
  });

  it("checks the GST rate is a standard slab and agrees with the tax", () => {
    expect(fields(intra({ gstRateBps: 1700 }))).toContain("gstRate");
    expect(fields(intra({ gstRateBps: 1200 }))).toContain("gstRate");
  });

  it("checks the agreement brokerage against the invoiced taxable value within 1%", () => {
    expect(fields(intra({ agreementValuePaise: 2_14_00_000_00n }))).toEqual([]);
    expect(fields(intra({ agreementValuePaise: 2_20_00_000_00n }))).toContain("agreementBrokerageRate");
    expect(fields(intra({ agreementBrokerageBps: null, agreementValuePaise: null, agreementBrokeragePaise: 4_23_700_00n }))).toEqual([]);
    expect(fields(intra({ agreementBrokerageBps: null, agreementValuePaise: null, agreementBrokeragePaise: 3_00_000_00n }))).toContain("agreementBrokerageAmount");
  });

  it("checks a stated brokerage amount against the stated rate", () => {
    expect(fields(intra({ agreementBrokeragePaise: 4_23_728_00n }))).toEqual([]);
    expect(fields(intra({ agreementBrokeragePaise: 4_00_000_00n }))).toContain("agreementBrokerageAmount");
  });

  it("validates brokerage rate bounds and needs the agreement value", () => {
    expect(fields(intra({ agreementBrokerageBps: 1500 }))).toContain("agreementBrokerageRate");
    expect(fields(intra({ agreementValuePaise: null }))).toContain("agreementValue");
  });

  it("requires sensible dates", () => {
    expect(fields(intra({ agreementDate: day("2026-10-21") }))).toContain("agreementDate");
    expect(fields(intra({ agreementDate: day("2010-01-01") }))).toContain("agreementDate");
    expect(fields(intra({ invoiceDate: day("2017-06-30"), agreementDate: null }))).toContain("invoiceDate");
    expect(fields(intra({ dueDate: day("2027-12-31") }))).toContain("dueDate");
  });

  it("validates the IRN and acknowledgement", () => {
    const irn = "a".repeat(64);
    expect(fields(intra({ irn, eInvoiceAckNumber: "112010036595310", eInvoiceAckDate: day("2026-10-20") }))).toEqual([]);
    expect(fields(intra({ irn: "not-an-irn" }))).toContain("irn");
    expect(fields(intra({ irn: "A".repeat(64) }))).toEqual([]);
    expect(fields(intra({ eInvoiceAckNumber: "112010036595310", eInvoiceAckDate: day("2026-10-20") }))).toContain("irn");
    expect(fields(intra({ irn, eInvoiceAckNumber: "1234", eInvoiceAckDate: day("2026-10-20") }))).toContain("ackNumber");
    expect(fields(intra({ irn, eInvoiceAckNumber: "112010036595310", eInvoiceAckDate: day("2026-10-19") }))).toContain("ackDate");
    expect(fields(intra({ irn, eInvoiceAckNumber: "112010036595310", eInvoiceAckDate: day("2026-12-01") }))).toContain("ackDate");
    expect(fields(intra({ irn, eInvoiceAckNumber: "112010036595310" }))).toContain("ackDate");
  });

  it("bounds the TDS rate", () => {
    expect(fields(intra({ tdsRateBps: 2500 }))).toContain("tdsRate");
    expect(fields(intra({ tdsRateBps: 0 }))).toEqual([]);
  });

  it("reports one message per field", () => {
    const issues = checkInvoiceConsistency(intra({ agreementBrokerageBps: 1500, agreementValuePaise: 2_20_00_000_00n }));
    expect(issues.filter((i) => i.field === "agreementBrokerageRate")).toHaveLength(1);
  });
});

describe("arithmetic helpers", () => {
  it("applies basis points with half-up rounding", () => {
    expect(applyBps(2_11_86_400_00n, 200)).toBe(4_23_728_00n);
    expect(applyBps(101n, 50)).toBe(1n);
  });

  it("derives the agreed brokerage from an amount or a rate", () => {
    expect(agreedBrokeragePaise({ agreementBrokeragePaise: 5n, agreementBrokerageBps: 200, agreementValuePaise: 100n })).toBe(5n);
    expect(agreedBrokeragePaise({ agreementBrokeragePaise: null, agreementBrokerageBps: 250, agreementValuePaise: 1_00_00_000_00n })).toBe(2_50_000_00n);
    expect(agreedBrokeragePaise({ agreementBrokeragePaise: null, agreementBrokerageBps: 250, agreementValuePaise: null })).toBeNull();
  });

  it("splits GST-inclusive totals exactly", () => {
    expect(splitInclusiveTotal(5_00_000_00n, 1800, "INTRA")).toEqual({ taxablePaise: 4_23_728_81n, cgstPaise: 38_135_59n, sgstPaise: 38_135_60n, igstPaise: 0n });
    expect(splitInclusiveTotal(2_95_000_00n, 1800, "INTER")).toEqual({ taxablePaise: 2_50_000_00n, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 45_000_00n });
  });

  it("infers the GST slab", () => {
    expect(inferGstRateBps(4_23_728_81n, 76_271_19n)).toBe(1800);
    expect(inferGstRateBps(1_00_000_00n, 0n)).toBe(0);
    expect(inferGstRateBps(1_00_000_00n, 7_000_00n)).toBeNull();
  });

  it("derives the supply type", () => {
    expect(expectedSupplyMode({ supplierGstin: MH_CP, recipientGstin: MH_BUILDER })).toBe("INTRA");
    expect(expectedSupplyMode({ supplierGstin: MH_CP, recipientGstin: KA_BUILDER })).toBe("INTER");
    expect(expectedSupplyMode({ supplierGstin: null, recipientGstin: KA_BUILDER })).toBeNull();
  });

  it("accepts initials only for the buyer", () => {
    expect(normaliseBuyerInitials("r. k.")).toBe("RK");
    expect(BUYER_INITIALS_PATTERN.test(normaliseBuyerInitials("Rahul Kumar"))).toBe(false);
    expect(BUYER_INITIALS_PATTERN.test("RKS")).toBe(true);
  });
});
