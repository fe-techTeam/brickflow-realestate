import { describe, expect, it } from "vitest";
import { maskAccountNumber, maskGstin, maskIrn, maskPan, maskUdyam } from "./masking";
import { matchNames, nameMatchBand, normaliseName, scoreNames } from "./name-match";
import {
  gstinCheckCharacter,
  isMahaReraAgentNumber,
  panFromGstin,
  panHolderType,
  validateAccountNumber,
  validateGstin,
  validateIfsc,
  validateIrn,
  validatePan,
  validateReraAgentNumber,
  validateUdyam,
} from "./validation";

describe("GSTIN", () => {
  it("accepts a GSTIN with a correct check character, normalising case and spaces", () => {
    expect(validateGstin(" 29aaicp2912r1zr ")).toEqual({ ok: true, value: "29AAICP2912R1ZR" });
    expect(gstinCheckCharacter("29AAICP2912R1Z")).toBe("R");
  });

  it("rejects a wrong check character, unknown state code, bad PAN part and wrong length", () => {
    expect(validateGstin("29AAICP2912R1ZX")).toMatchObject({ ok: false, error: expect.stringMatching(/check digit/) });
    expect(validateGstin("00AAICP2912R1Z" + gstinCheckCharacter("00AAICP2912R1Z"))).toMatchObject({ ok: false, error: expect.stringMatching(/state code/) });
    expect(validateGstin("29AAIXP2912R1ZR")).toMatchObject({ ok: false });
    expect(validateGstin("29AAICP2912R1Z")).toMatchObject({ ok: false, error: expect.stringMatching(/15 characters/) });
  });

  it("extracts the embedded PAN", () => {
    expect(panFromGstin("29AAICP2912R1ZR")).toBe("AAICP2912R");
  });
});

describe("PAN", () => {
  it("validates format and the holder-type character", () => {
    expect(validatePan("abcpv1234d")).toEqual({ ok: true, value: "ABCPV1234D" });
    expect(validatePan("ABCXV1234D").ok).toBe(false);
    expect(validatePan("ABCPV12345").ok).toBe(false);
    expect(panHolderType("AAOCS4553K")).toBe("Company");
    expect(panHolderType("AAPFP9005H")).toBe("Firm or LLP");
  });
});

describe("bank details", () => {
  it("validates IFSC (fifth character zero) and account numbers", () => {
    expect(validateIfsc("yesb0000262")).toEqual({ ok: true, value: "YESB0000262" });
    expect(validateIfsc("YESB1000262").ok).toBe(false);
    expect(validateIfsc("YESB000026").ok).toBe(false);
    expect(validateAccountNumber("0262 9180 0001 191")).toEqual({ ok: true, value: "026291800001191" });
    expect(validateAccountNumber("12345678").ok).toBe(false);
    expect(validateAccountNumber("000000000000").ok).toBe(false);
    expect(validateAccountNumber("12345678901234567890").ok).toBe(false);
  });
});

describe("other identifiers", () => {
  it("validates Udyam numbers", () => {
    expect(validateUdyam("udyam-mh-12-1234567")).toEqual({ ok: true, value: "UDYAM-MH-12-1234567" });
    expect(validateUdyam("UDYAM-MH-12-123456").ok).toBe(false);
  });

  it("validates IRNs as 64 hex characters", () => {
    expect(validateIrn("E07607BBBAC22DC6BDABA812E197D00E1833930220974D8CD33520EF628ACAAA").ok).toBe(true);
    expect(validateIrn("e07607bb").ok).toBe(false);
  });

  it("validates RERA agent numbers and recognises the MahaRERA format", () => {
    expect(validateReraAgentNumber("a51800099005")).toEqual({ ok: true, value: "A51800099005" });
    expect(isMahaReraAgentNumber("A51800099005")).toBe(true);
    expect(isMahaReraAgentNumber("PRM/KA/RERA/1251")).toBe(false);
    expect(validateReraAgentNumber("x").ok).toBe(false);
  });
});

describe("masking", () => {
  it("keeps only the recognisable ends", () => {
    expect(maskPan("ABCPV1234D")).toBe("AB•••••34D");
    expect(maskGstin("27AAPFP9005H1Z6")).toBe("27AA••••••••1Z6");
    expect(maskAccountNumber("500100099005")).toBe("••••••••9005");
    expect(maskUdyam("UDYAM-MH-12-1234567")).toBe("UDYAM-MH-12-•••4567");
    expect(maskIrn("e07607bbbac22dc6bdaba812e197d00e1833930220974d8cd33520ef628acaaa")).toBe("e07607bb…8acaaa");
  });
});

describe("name matching", () => {
  it("ignores case, punctuation, legal-form suffixes and bracketed notes", () => {
    expect(normaliseName("M/s. Prestige Realty Partners LLP (Demo)")).toEqual(["PRESTIGE", "REALTY", "PARTNERS"]);
    expect(scoreNames("PRESTIGE REALTY PARTNERS", "Prestige Realty Partners LLP (Demo)")).toBe(100);
    expect(scoreNames("SAANCHI ENERGY PVT. LTD.", "Saanchi Energy Private Limited")).toBe(100);
    expect(scoreNames("Shah & Sons", "SHAH AND SONS")).toBe(100);
  });

  it("gives credit for initials and close spellings", () => {
    expect(scoreNames("J DOE", "JOHN DOE")).toBeGreaterThanOrEqual(85);
    expect(scoreNames("UrbanNest Property Advisors", "URBAN NEST PROPERTY ADVISORS")).toBeGreaterThanOrEqual(85);
  });

  it("scores unrelated names low", () => {
    expect(scoreNames("SANDBOX UNRELATED TRADERS PRIVATE LIMITED", "Prestige Realty Partners LLP")).toBeLessThan(40);
    expect(scoreNames("", "Prestige")).toBe(0);
  });

  it("returns the best candidate and its band", () => {
    expect(matchNames("WESTLINE REALTY PARTNERS", ["Something Else", "Westline Realty Partners LLP (Demo)"])).toMatchObject({ score: 100, band: "EXACT", comparedWith: "Westline Realty Partners LLP (Demo)" });
    expect(matchNames(null, ["x"])).toBeNull();
    expect([nameMatchBand(100), nameMatchBand(90), nameMatchBand(70), nameMatchBand(45), nameMatchBand(10)]).toEqual(["EXACT", "STRONG", "PARTIAL", "WEAK", "NONE"]);
  });
});
