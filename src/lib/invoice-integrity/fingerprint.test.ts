import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalFingerprintInput, computeFingerprint, deriveIrn, normaliseInvoiceNumber, type FingerprintSource } from "./fingerprint";
import { financialYear, gstinStateCode, isGstinFormat, normaliseGstin } from "./gst";
import { isAckNumberFormat, isIrnFormat, normaliseIrn, shortIrn } from "./irn";
import { describeMatchItems, isMatchItemKey, MATCH_ITEM_KEYS } from "./match";

const source: FingerprintSource = {
  supplierGstin: " 27aapfp9005h1z6 ",
  recipientGstin: "27AAACG9002E1Z3",
  cpId: "cp1",
  builderId: "b1",
  invoiceNumber: "gfh/2026 - 001",
  invoiceDate: new Date("2026-10-20T00:00:00.000Z"),
  totalPaise: 5_00_000_00n,
};

describe("invoice fingerprint", () => {
  it("normalises invoice numbers to upper-case letters and digits", () => {
    expect(normaliseInvoiceNumber("gfh/2026 - 001")).toBe("GFH2026001");
    expect(normaliseInvoiceNumber("GFH_2026.001")).toBe("GFH2026001");
  });

  it("builds the documented canonical string", () => {
    expect(canonicalFingerprintInput(source)).toBe("v1|27AAPFP9005H1Z6|27AAACG9002E1Z3|GFH2026001|2026-10-20|50000000|");
    expect(canonicalFingerprintInput({ ...source, irn: "ABC" })).toMatch(/\|abc$/);
  });

  it("hashes the canonical string with SHA-256", () => {
    const parts = computeFingerprint(source);
    expect(parts.fingerprint).toBe(createHash("sha256").update(canonicalFingerprintInput(source)).digest("hex"));
    expect(parts).toMatchObject({ version: 1, supplierKey: "27AAPFP9005H1Z6", numberKey: "GFH2026001", totalPaise: 5_00_000_00n, irn: null });
  });

  it("collides for formatting variants of the same invoice", () => {
    const variant = computeFingerprint({ ...source, supplierGstin: "27AAPFP9005H1Z6", invoiceNumber: "GFH-2026-001", invoiceDate: new Date("2026-10-20T15:30:00.000Z") });
    expect(variant.fingerprint).toBe(computeFingerprint(source).fingerprint);
  });

  it("differs when any identifying field differs", () => {
    const base = computeFingerprint(source).fingerprint;
    expect(computeFingerprint({ ...source, totalPaise: 5_00_000_01n }).fingerprint).not.toBe(base);
    expect(computeFingerprint({ ...source, invoiceDate: new Date("2026-10-21T00:00:00.000Z") }).fingerprint).not.toBe(base);
    expect(computeFingerprint({ ...source, recipientGstin: "29AAKFS9003F1Z1" }).fingerprint).not.toBe(base);
    expect(computeFingerprint({ ...source, irn: "a".repeat(64) }).fingerprint).not.toBe(base);
  });

  it("falls back to organisation ids when a GSTIN is missing", () => {
    expect(computeFingerprint({ ...source, supplierGstin: null }).supplierKey).toBe("ORG:cp1");
    expect(computeFingerprint({ ...source, recipientGstin: "" }).recipientKey).toBe("ORG:b1");
  });

  it("derives an IRN like the IRP", () => {
    const irn = deriveIrn("27AAPFP9005H1Z6", new Date("2026-10-20T00:00:00.000Z"), "GFH/2026/001");
    expect(irn).toBe(createHash("sha256").update("27AAPFP9005H1Z62026-27INVGFH/2026/001").digest("hex"));
    expect(isIrnFormat(irn)).toBe(true);
  });
});

describe("GST and IRN helpers", () => {
  it("reads GSTIN state codes and formats", () => {
    expect(normaliseGstin(" 27aapfp9005h1z6")).toBe("27AAPFP9005H1Z6");
    expect(gstinStateCode("29AAKFS9003F1Z1")).toBe("29");
    expect(gstinStateCode("99AAKFS9003F1Z1")).toBeNull();
    expect(gstinStateCode(null)).toBeNull();
    expect(isGstinFormat("27AAPFP9005H1Z6")).toBe(true);
    expect(isGstinFormat("27AAPFP9005H1X6")).toBe(false);
  });

  it("labels the Indian financial year", () => {
    expect(financialYear(new Date("2026-04-01T00:00:00.000Z"))).toBe("2026-27");
    expect(financialYear(new Date("2026-03-31T00:00:00.000Z"))).toBe("2025-26");
    expect(financialYear(new Date("2099-12-01T00:00:00.000Z"))).toBe("2099-00");
  });

  it("validates IRN and acknowledgement formats", () => {
    expect(normaliseIrn(" ABC def ")).toBe("abcdef");
    expect(isIrnFormat("f".repeat(64))).toBe(true);
    expect(isIrnFormat("f".repeat(63))).toBe(false);
    expect(isIrnFormat("g".repeat(64))).toBe(false);
    expect(isAckNumberFormat("112010036595310")).toBe(true);
    expect(isAckNumberFormat("11201003659531")).toBe(false);
    expect(shortIrn("0123456789abcdef")).toBe("012345…abcdef");
  });
});

describe("three-way match items", () => {
  const subject = {
    amountPaise: 5_00_000_00n,
    gstAmountPaise: 76_271_19n,
    taxableValuePaise: 4_23_728_81n,
    bookingTower: "B",
    bookingUnit: "1104",
    buyerInitials: "RK",
    agreementRegistrationNumber: "HVL-2/4821/2026",
    agreementDate: new Date("2026-09-30T00:00:00.000Z"),
    agreementValuePaise: 2_11_86_400_00n,
    agreementBrokerageBps: 200,
    agreementBrokeragePaise: null,
  };

  it("describes each item with the invoice's figures", () => {
    const items = describeMatchItems(subject);
    expect(items.map((i) => i.key)).toEqual(MATCH_ITEM_KEYS);
    expect(items.find((i) => i.key === "UNIT")?.invoiceValue).toBe("Tower B · Unit 1104 · Buyer RK");
    expect(items.find((i) => i.key === "AGREEMENT_NUMBER")?.invoiceValue).toBe("HVL-2/4821/2026 · 2026-09-30");
    expect(items.find((i) => i.key === "BROKERAGE")).toMatchObject({ invoiceValue: "2% of agreement value", consistent: true });
    expect(items.find((i) => i.key === "AMOUNT")?.consistent).toBe(true);
  });

  it("flags inconsistent brokerage and missing particulars", () => {
    const items = describeMatchItems({ ...subject, agreementValuePaise: 3_00_00_000_00n, bookingTower: null, bookingUnit: null, buyerInitials: null, agreementRegistrationNumber: null });
    expect(items.find((i) => i.key === "BROKERAGE")?.consistent).toBe(false);
    expect(items.find((i) => i.key === "UNIT")?.invoiceValue).toBe("Not stated on the invoice");
    expect(items.find((i) => i.key === "AGREEMENT_NUMBER")?.invoiceValue).toBe("Not stated on the invoice");
  });

  it("recognises item keys", () => {
    expect(isMatchItemKey("AMOUNT")).toBe(true);
    expect(isMatchItemKey("amount")).toBe(false);
  });
});
