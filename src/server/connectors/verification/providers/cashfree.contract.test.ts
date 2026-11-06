import { generateKeyPairSync, privateDecrypt, constants } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../../circuit-breaker";
import { ConnectorError } from "../../errors";
import { ResilientHttpClient } from "../../http-client";
import { silentConnectorLogger } from "../../log";
import { fakeFetch, noSleep, type ScriptedReply } from "../../testing/fake-fetch";
import { CASHFREE_PAN_API_VERSION, CashfreeVerificationProvider } from "./cashfree";
import * as F from "./fixtures/cashfree";

const BASE = "https://sandbox.cashfree.com/verification";

function provider(replies: ScriptedReply[], options: { publicKeyPem?: string } = {}) {
  const fetch = fakeFetch(replies);
  const config = { clientId: "CF_TEST_CLIENT", clientSecret: "cf_test_secret_value", environment: "sandbox" as const, publicKeyPem: options.publicKeyPem };
  let instance: CashfreeVerificationProvider;
  const http = new ResilientHttpClient({
    provider: "cashfree",
    baseUrl: BASE,
    fetchImpl: fetch.impl,
    sleep: noSleep,
    logger: silentConnectorLogger,
    breaker: new CircuitBreaker("cashfree-test"),
    defaultHeaders: () => instance.authHeaders(),
  });
  instance = new CashfreeVerificationProvider(config, http);
  return { cf: instance, fetch };
}

async function failure(promise: Promise<unknown>): Promise<ConnectorError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectorError);
  return error as ConnectorError;
}

describe("Cashfree request contract", () => {
  it("POSTs /gstin with the documented auth headers and uppercase GSTIN key", async () => {
    const { cf, fetch } = provider([{ status: 200, body: F.GSTIN_EXISTS }]);
    await cf.verifyGstin({ gstin: "29aaicp2912r1zr", name: "Ujjivan Small Finance Bank" }, { requestId: "req-123456" });
    const [request] = fetch.requests;
    expect(request!.method).toBe("POST");
    expect(request!.url).toBe(`${BASE}/gstin`);
    expect(request!.headers).toMatchObject({ "x-client-id": "CF_TEST_CLIENT", "x-client-secret": "cf_test_secret_value", "content-type": "application/json", "x-request-id": "req-123456" });
    expect(request!.body).toEqual({ GSTIN: "29AAICP2912R1ZR", business_name: "Ujjivan Small Finance Bank" });
  });

  it("POSTs /pan with x-api-version and the name to match", async () => {
    const { cf, fetch } = provider([{ status: 200, body: F.PAN_VALID }]);
    await cf.verifyPan({ pan: "ABCPV1234D", name: "John Doe" });
    expect(fetch.requests[0]!.url).toBe(`${BASE}/pan`);
    expect(fetch.requests[0]!.headers["x-api-version"]).toBe(CASHFREE_PAN_API_VERSION);
    expect(fetch.requests[0]!.body).toEqual({ pan: "ABCPV1234D", name: "John Doe" });
  });

  it("POSTs /bank-account/sync with bank_account, ifsc and name", async () => {
    const { cf, fetch } = provider([{ status: 200, body: F.BANK_VALID }]);
    await cf.verifyBankAccount({ accountNumber: "026291800001191", ifsc: "yesb0000262", name: "Bharath Kumar" });
    expect(fetch.requests[0]!.url).toBe(`${BASE}/bank-account/sync`);
    expect(fetch.requests[0]!.body).toEqual({ bank_account: "026291800001191", ifsc: "YESB0000262", name: "Bharath Kumar" });
  });

  it("POSTs /udyam with a unique verification_id", async () => {
    const { cf, fetch } = provider([
      { status: 200, body: F.UDYAM_SUCCESS },
      { status: 200, body: F.UDYAM_SUCCESS },
    ]);
    await cf.verifyUdyam({ udyamNumber: "UDYAM-UP-43-1234567" });
    await cf.verifyUdyam({ udyamNumber: "UDYAM-UP-43-1234567" }, { verificationId: "bf-fixed_id.1" });
    const [first, second] = fetch.requests;
    expect(first!.url).toBe(`${BASE}/udyam`);
    expect(first!.body).toMatchObject({ udyam: "UDYAM-UP-43-1234567" });
    expect((first!.body as { verification_id: string }).verification_id).toMatch(/^bf-[A-Za-z0-9._-]{1,47}$/);
    expect((second!.body as { verification_id: string }).verification_id).toBe("bf-fixed_id.1");
  });

  it("adds x-cf-signature (RSA-OAEP SHA-1 of clientId.timestamp) when a public key is configured", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const { cf, fetch } = provider([{ status: 200, body: F.PAN_VALID }], { publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() });
    const before = Math.floor(Date.now() / 1000);
    await cf.verifyPan({ pan: "ABCPV1234D" });
    const signature = fetch.requests[0]!.headers["x-cf-signature"]!;
    const plain = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" }, Buffer.from(signature, "base64")).toString();
    const [clientId, timestamp] = plain.split(".");
    expect(clientId).toBe("CF_TEST_CLIENT");
    expect(Number(timestamp)).toBeGreaterThanOrEqual(before);
  });

  it("rejects malformed input before calling the provider", async () => {
    const { cf, fetch } = provider([]);
    expect((await failure(cf.verifyGstin({ gstin: "29AAICP2912R1ZX" }))).kind).toBe("INVALID_INPUT");
    expect((await failure(cf.verifyBankAccount({ accountNumber: "12345678901", ifsc: "YESB1000262" }))).kind).toBe("INVALID_INPUT");
    expect(fetch.requests).toHaveLength(0);
  });
});

describe("Cashfree response normalisation", () => {
  it("normalises an active GSTIN", async () => {
    const { cf } = provider([{ status: 200, body: F.GSTIN_EXISTS }]);
    const { result, providerReference, provider: name, rawBody } = await cf.verifyGstin({ gstin: "29AAICP2912R1ZR" });
    expect(name).toBe("cashfree");
    expect(providerReference).toBe("19");
    expect(rawBody).toBe(JSON.stringify(F.GSTIN_EXISTS));
    expect(result).toEqual({
      gstin: "29AAICP2912R1ZR",
      status: "ACTIVE",
      providerStatus: "Active",
      legalName: "UJJIVAN SMALL FINANCE BANK LIMITED",
      tradeName: "UJJIVAN SMALL FINANCE BANK",
      stateCode: "29",
      stateName: "Karnataka",
      registrationDate: "2017-09-30",
      constitution: "Public Limited Company",
      taxpayerType: "Regular",
      nameMatch: null,
    });
  });

  it("maps a cancelled GSTIN status", async () => {
    const { cf } = provider([{ status: 200, body: { ...F.GSTIN_EXISTS, gst_in_status: "Cancelled suo-moto" } }]);
    expect((await cf.verifyGstin({ gstin: "29AAICP2912R1ZR" })).result).toMatchObject({ status: "CANCELLED", providerStatus: "Cancelled suo-moto" });
  });

  it("treats \"GSTIN Doesn't Exist\" (HTTP 200 without valid) as not found", async () => {
    const { cf } = provider([{ status: 200, body: F.GSTIN_NOT_FOUND }]);
    expect((await failure(cf.verifyGstin({ gstin: "29AAICP2912R1ZR" }))).kind).toBe("NOT_FOUND");
  });

  it("normalises PAN results, including string and numeric match scores", async () => {
    const { cf } = provider([
      { status: 200, body: F.PAN_VALID },
      { status: 200, body: F.PAN_PARTIAL_COMPANY },
      { status: 200, body: F.PAN_INVALID },
    ]);
    expect((await cf.verifyPan({ pan: "ABCPV1234D", name: "John Doe" })).result).toEqual({
      pan: "ABCPV1234D",
      status: "VALID",
      holderType: "Individual",
      registeredName: "JOHN DOE",
      nameMatch: { score: 100, band: "EXACT", source: "provider", comparedWith: "John Doe" },
      aadhaarSeeded: true,
    });
    expect((await cf.verifyPan({ pan: "AAOCS4553K", name: "saanchi" })).result).toMatchObject({
      holderType: "Company",
      registeredName: "SAANCHI ENERGY PRIVATE LIMITED",
      nameMatch: { score: 60, band: "PARTIAL" },
      aadhaarSeeded: null,
    });
    expect((await cf.verifyPan({ pan: "ABCPV1234D" })).result).toMatchObject({ status: "INVALID", registeredName: null, nameMatch: null });
  });

  it("normalises a valid penny drop", async () => {
    const { cf } = provider([{ status: 200, body: F.BANK_VALID }]);
    const { result, providerReference } = await cf.verifyBankAccount({ accountNumber: "026291800001191", ifsc: "YESB0000262", name: "Bharath Kumar" });
    expect(providerReference).toBe("34");
    expect(result).toEqual({
      accountLast4: "1191",
      ifsc: "YESB0000262",
      status: "VALID",
      statusCode: "ACCOUNT_VALID",
      beneficiaryName: "BHARATHTEST GKUMARUT",
      bankName: "YES BANK",
      branch: "SANTACRUZ, MUMBAI",
      city: "MUMBAI",
      nameMatch: { score: 90, band: "STRONG", source: "provider", comparedWith: "Bharath Kumar" },
      utr: "404223241811",
    });
  });

  it("normalises invalid and blocked accounts (documented as HTTP 200)", async () => {
    const { cf } = provider([
      { status: 200, body: F.BANK_INVALID_ACCOUNT },
      { status: 200, body: F.BANK_BLOCKED },
    ]);
    expect((await cf.verifyBankAccount({ accountNumber: "026291800001190", ifsc: "YESB0000262" })).result).toMatchObject({ status: "INVALID", statusCode: "INVALID_ACCOUNT", beneficiaryName: null });
    expect((await cf.verifyBankAccount({ accountNumber: "026291800001190", ifsc: "YESB0000262" })).result).toMatchObject({ status: "INVALID", statusCode: "ACCOUNT_BLOCKED" });
  });

  it("normalises Udyam success, not-found and cancelled", async () => {
    const { cf } = provider([
      { status: 200, body: F.UDYAM_SUCCESS },
      { status: 200, body: F.UDYAM_NOT_FOUND },
      { status: 200, body: F.UDYAM_CANCELLED },
    ]);
    expect((await cf.verifyUdyam({ udyamNumber: "UDYAM-UP-43-1234567" })).result).toEqual({
      udyamNumber: "UDYAM-UP-43-1234567",
      status: "ACTIVE",
      enterpriseName: "helloscholar",
      enterpriseType: "MICRO",
      organisationType: "Proprietary",
      majorActivity: "Services",
      registrationDate: "2022-01-02",
      classificationYear: "2024-25",
    });
    expect((await failure(cf.verifyUdyam({ udyamNumber: "UDYAM-MH-43-1234567" }))).kind).toBe("NOT_FOUND");
    expect((await cf.verifyUdyam({ udyamNumber: "UDYAM-KA-43-1234567" })).result.status).toBe("CANCELLED");
  });

  it("treats an unexpected body shape as a provider fault", async () => {
    const { cf } = provider([{ status: 200, body: "<html>gateway</html>" }]);
    expect((await failure(cf.verifyBankAccount({ accountNumber: "026291800001191", ifsc: "YESB0000262" }))).kind).toBe("PROVIDER_DOWN");
  });
});

describe("Cashfree error mapping", () => {
  const cases: [string, ScriptedReply, string, string | undefined][] = [
    ["401 authentication_failed", { status: 401, body: F.ERRORS.authFailed }, "AUTH_FAILURE", "authentication_failed"],
    ["403 ip_validation_failed", { status: 403, body: F.ERRORS.ipNotWhitelisted }, "AUTH_FAILURE", "ip_validation_failed"],
    ["400 x-client-id_missing", { status: 400, body: F.ERRORS.clientIdMissing }, "AUTH_FAILURE", "x-client-id_missing"],
    ["422 insufficient_balance", { status: 422, body: F.ERRORS.insufficientBalance }, "AUTH_FAILURE", "insufficient_balance"],
    ["400 GSTIN_value_invalid", { status: 400, body: F.ERRORS.gstinInvalid }, "INVALID_INPUT", "GSTIN_value_invalid"],
    ["409 verification_id_already_exists", { status: 409, body: F.ERRORS.verificationIdExists }, "INVALID_INPUT", "verification_id_already_exists"],
    ["429 too_many_requests_per_operation", { status: 429, body: F.ERRORS.rateLimited, headers: { "retry-after": "1" } }, "RATE_LIMITED", "too_many_requests_per_operation"],
    ["502 verification_failed", { status: 502, body: F.ERRORS.sourceDown }, "PROVIDER_DOWN", "verification_failed"],
  ];

  for (const [name, reply, kind, code] of cases) {
    it(`maps ${name} to ${kind}`, async () => {
      const replies = reply && "status" in reply && (reply.status === 429 || reply.status === 502) ? [reply, reply, reply] : [reply];
      const { cf } = provider(replies);
      const error = await failure(cf.verifyGstin({ gstin: "29AAICP2912R1ZR" }));
      expect(error.kind).toBe(kind);
      expect(error.providerCode).toBe(code);
      expect(error.message).not.toMatch(/106\.51|clientSecret/);
    });
  }

  const bankCases: [string, unknown, string][] = [
    ["fraud_account", F.ERRORS.fraudAccount, "INVALID_INPUT"],
    ["npci_unavailable", F.ERRORS.npciUnavailable, "PROVIDER_DOWN"],
    ["verification_already_under_process", F.ERRORS.underProcess, "RATE_LIMITED"],
    ["ifsc_value_invalid", F.ERRORS.ifscInvalid, "INVALID_INPUT"],
  ];
  for (const [code, body, kind] of bankCases) {
    it(`maps the penny-drop code ${code} to ${kind}`, async () => {
      const { cf } = provider([{ status: code === "ifsc_value_invalid" ? 400 : 422, body }]);
      const error = await failure(cf.verifyBankAccount({ accountNumber: "026291800001191", ifsc: "YESB0000262" }));
      expect(error.kind).toBe(kind);
      expect(error.providerCode).toBe(code);
    });
  }

  it("never retries a penny drop after a server error (it may have moved money)", async () => {
    const { cf, fetch } = provider([{ status: 502, body: F.ERRORS.sourceDown }]);
    expect((await failure(cf.verifyBankAccount({ accountNumber: "026291800001191", ifsc: "YESB0000262" }))).kind).toBe("PROVIDER_DOWN");
    expect(fetch.requests).toHaveLength(1);
  });

  it("retries a GSTIN lookup after a transient 502 and succeeds", async () => {
    const { cf, fetch } = provider([{ status: 502, body: F.ERRORS.sourceDown }, { status: 200, body: F.GSTIN_EXISTS }]);
    expect((await cf.verifyGstin({ gstin: "29AAICP2912R1ZR" })).result.status).toBe("ACTIVE");
    expect(fetch.requests).toHaveLength(2);
  });
});

