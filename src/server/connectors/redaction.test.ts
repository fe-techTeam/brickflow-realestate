import { describe, expect, it } from "vitest";
import { redact, redactHeaders, redactText, redactUrl, REDACTED } from "./redaction";

describe("redaction", () => {
  it("removes secrets and masks identifiers by key", () => {
    const out = redact({
      pan: "ABCPV1234D",
      GSTIN: "29AAICP2912R1ZR",
      bank_account: "026291800001191",
      accountNumber: "500100099005",
      access_token: "eyJhbGciOi",
      password: "hunter2",
      SignedInvoice: "eyJ.payload.sig",
      email: "owner@example.com",
      mobile_number: "9876543210",
      masked_aadhaar_number: "XXXXXXXX8848",
      reference_id: 161,
      registered_name: "JOHN DOE",
      nested: [{ x_client_secret: "abc", ifsc: "YESB0000262" }],
    });
    expect(out).toEqual({
      pan: "AB•••••34D",
      GSTIN: "29AA••••••••1ZR",
      bank_account: "•••••••••••1191",
      accountNumber: "••••••••9005",
      access_token: REDACTED,
      password: REDACTED,
      SignedInvoice: REDACTED,
      email: "o•••@example.com",
      mobile_number: "•••10",
      masked_aadhaar_number: REDACTED,
      reference_id: 161,
      registered_name: "JOHN DOE",
      nested: [{ x_client_secret: REDACTED, ifsc: "YESB0000262" }],
    });
  });

  it("masks identifiers inside free text", () => {
    expect(redactText("PAN ABCPV1234D and GSTIN 27AAPFP9005H1Z6, a/c 500100099005")).toBe("PAN AB•••••34D and GSTIN 27AA••••••••1Z6, a/c ••••••••9005");
  });

  it("redacts sensitive headers and abbreviates the client id", () => {
    expect(redactHeaders({ authorization: "token", "x-client-secret": "s", "x-client-id": "CF123456789", "x-api-key": "k", accept: "application/json" })).toEqual({
      authorization: REDACTED,
      "x-client-secret": REDACTED,
      "x-client-id": "CF12…",
      "x-api-key": REDACTED,
      accept: "application/json",
    });
  });

  it("masks identifiers and IRNs in URLs", () => {
    const irn = "e07607bbbac22dc6bdaba812e197d00e1833930220974d8cd33520ef628acaaa";
    expect(redactUrl(`/invoice/${irn}?gstin=27AAPFP9005H1Z6`)).toBe("/invoice/e07607bb…?gstin=27AA••••••••1Z6");
  });
});
