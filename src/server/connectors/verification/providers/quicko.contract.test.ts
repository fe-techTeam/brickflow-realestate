import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../../circuit-breaker";
import { ConnectorError } from "../../errors";
import { ResilientHttpClient } from "../../http-client";
import { silentConnectorLogger } from "../../log";
import { fakeFetch, noSleep, type ScriptedReply } from "../../testing/fake-fetch";
import { decodeSignedInvoice, QuickoEInvoiceProvider, rupeesToPaiseString } from "./quicko";

const BASE = "https://test-api.sandbox.co.in";
const IRN = "e07607bbbac22dc6bdaba812e197d00e1833930220974d8cd33520ef628acaaa";

/* Bodies follow the documented shapes on developer.sandbox.co.in (tokens shortened). */
const PLATFORM_AUTH = { code: 200, data: { access_token: "platform-token" }, timestamp: 1750687659809, transaction_id: "3a31716a-6a4d-4670-83fe-849d8209e35a" };
const TAXPAYER_AUTH = (expiry: number) => ({ code: 200, data: { ErrorDetails: null, InfoDtls: null, Status: 1, access_token: "einvoice-token", expiry }, timestamp: 1708690232000, transaction_id: "t-1" });

function signedInvoice(invoice: unknown): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ data: JSON.stringify(invoice), iss: "NIC" })}.signature`;
}

const INVOICE = {
  DocDtls: { Typ: "INV", No: "WRP/2026/014", Dt: "21/02/2024" },
  SellerDtls: { Gstin: "27AAJFW5520P1Z2" },
  BuyerDtls: { Gstin: "27AAHCC7314K1Z9" },
  ValDtls: { TotInvVal: 590000.5 },
};

const E_INVOICE_ACTIVE = {
  code: 200,
  data: {
    Data: {
      AckDt: "2024-02-21 21:41:00",
      AckNo: 112410188572921,
      EwbDt: null,
      EwbNo: null,
      EwbValidTill: null,
      Irn: IRN,
      Remarks: null,
      SignedInvoice: signedInvoice(INVOICE),
      SignedQRCode: "eyJ.qr.code",
      Status: "ACT",
    },
    ErrorDetails: null,
    InfoDtls: null,
    Status: 1,
  },
  timestamp: 1763446641000,
  transaction_id: "d74d4b8c-bd3a-4b21-82e0-6ee7cffe0fd7",
};

const E_INVOICE_NOT_AVAILABLE = {
  code: 200,
  data: { Data: null, ErrorDetails: [{ ErrorCode: "2148", ErrorMessage: "Requested IRN data is not available" }], InfoDtls: null, Status: 0 },
  timestamp: 1763446641000,
  transaction_id: "175fe134-c501-4ac0-8403-b52a4abccd0b",
};

function provider(replies: ScriptedReply[], now = () => Date.now()) {
  const fetch = fakeFetch(replies);
  const http = new ResilientHttpClient({
    provider: "quicko",
    baseUrl: BASE,
    fetchImpl: fetch.impl,
    sleep: noSleep,
    logger: silentConnectorLogger,
    breaker: new CircuitBreaker("quicko-test"),
    defaultHeaders: { "x-api-key": "key_test_123" },
  });
  const quicko = new QuickoEInvoiceProvider(
    {
      apiKey: "key_test_123",
      apiSecret: "secret_test_456",
      environment: "test",
      taxpayerGstin: "27AAHCC7314K1Z9",
      taxpayerUsername: "chandak_api",
      taxpayerPassword: "portal-password",
      now,
    },
    http,
  );
  return { quicko, fetch };
}

async function failure(promise: Promise<unknown>): Promise<ConnectorError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectorError);
  return error as ConnectorError;
}

describe("Sandbox.co.in e-invoice contract", () => {
  it("authenticates the platform, then the taxpayer, then fetches the IRN with raw tokens", async () => {
    const { quicko, fetch } = provider([
      { status: 200, body: PLATFORM_AUTH },
      { status: 200, body: TAXPAYER_AUTH(Date.now() + 6 * 3600_000) },
      { status: 200, body: E_INVOICE_ACTIVE },
    ]);
    const outcome = await quicko.verifyEInvoice({ irn: IRN.toUpperCase(), supplierGstin: "27AAJFW5520P1Z2" }, { requestId: "req-abcdef12" });
    const [platform, taxpayer, lookup] = fetch.requests;

    expect(platform!.method).toBe("POST");
    expect(platform!.url).toBe(`${BASE}/authenticate`);
    expect(platform!.headers).toMatchObject({ "x-api-key": "key_test_123", "x-api-secret": "secret_test_456", "x-api-version": "1.0" });

    expect(taxpayer!.url).toBe(`${BASE}/gst/compliance/e-invoice/tax-payer/authenticate?force=true`);
    expect(taxpayer!.headers).toMatchObject({ authorization: "platform-token", "x-api-key": "key_test_123", "x-source": "primary" });
    expect(taxpayer!.body).toEqual({ username: "chandak_api", password: "portal-password", gstin: "27AAHCC7314K1Z9" });

    expect(lookup!.method).toBe("GET");
    expect(lookup!.url).toBe(`${BASE}/gst/compliance/e-invoice/tax-payer/invoice/${IRN}?supplier_gstin=27AAJFW5520P1Z2`);
    expect(lookup!.headers).toMatchObject({ authorization: "einvoice-token", "x-api-key": "key_test_123", "x-request-id": "req-abcdef12" });
    expect(lookup!.headers.authorization).not.toMatch(/^Bearer/);

    expect(outcome.providerReference).toBe("d74d4b8c-bd3a-4b21-82e0-6ee7cffe0fd7");
    expect(outcome.result).toEqual({
      irn: IRN,
      status: "ACTIVE",
      ackNumber: "112410188572921",
      ackDate: "2024-02-21T21:41:00+05:30",
      ewayBillNumber: null,
      sellerGstin: "27AAJFW5520P1Z2",
      buyerGstin: "27AAHCC7314K1Z9",
      documentNumber: "WRP/2026/014",
      documentDate: "2024-02-21",
      totalValuePaise: "59000050",
    });
  });

  it("reuses both sessions until they expire", async () => {
    const { quicko, fetch } = provider([
      { status: 200, body: PLATFORM_AUTH },
      { status: 200, body: TAXPAYER_AUTH(Date.now() + 6 * 3600_000) },
      { status: 200, body: E_INVOICE_ACTIVE },
      { status: 200, body: E_INVOICE_ACTIVE },
    ]);
    await quicko.verifyEInvoice({ irn: IRN });
    await quicko.verifyEInvoice({ irn: IRN });
    expect(fetch.requests.map((r) => new URL(r.url).pathname)).toEqual([
      "/authenticate",
      "/gst/compliance/e-invoice/tax-payer/authenticate",
      `/gst/compliance/e-invoice/tax-payer/invoice/${IRN}`,
      `/gst/compliance/e-invoice/tax-payer/invoice/${IRN}`,
    ]);
  });

  it("re-authenticates the taxpayer once when the session is rejected", async () => {
    const { quicko, fetch } = provider([
      { status: 200, body: PLATFORM_AUTH },
      { status: 200, body: TAXPAYER_AUTH(Date.now() + 6 * 3600_000) },
      { status: 403, body: { code: 403, message: "Forbidden", timestamp: 1, transaction_id: "x" } },
      { status: 200, body: TAXPAYER_AUTH(Date.now() + 6 * 3600_000) },
      { status: 200, body: E_INVOICE_ACTIVE },
    ]);
    expect((await quicko.verifyEInvoice({ irn: IRN })).result.status).toBe("ACTIVE");
    expect(fetch.requests).toHaveLength(5);
  });

  it("maps a cancelled IRN", async () => {
    const cancelled = { ...E_INVOICE_ACTIVE, data: { ...E_INVOICE_ACTIVE.data, Data: { ...E_INVOICE_ACTIVE.data.Data, Status: "CNL" } } };
    const { quicko } = provider([{ status: 200, body: PLATFORM_AUTH }, { status: 200, body: TAXPAYER_AUTH(Date.now() + 3600_000) }, { status: 200, body: cancelled }]);
    expect((await quicko.verifyEInvoice({ irn: IRN })).result.status).toBe("CANCELLED");
  });

  it("maps portal error 2148 (HTTP 200, Status 0) to not found", async () => {
    const { quicko } = provider([{ status: 200, body: PLATFORM_AUTH }, { status: 200, body: TAXPAYER_AUTH(Date.now() + 3600_000) }, { status: 200, body: E_INVOICE_NOT_AVAILABLE }]);
    const error = await failure(quicko.verifyEInvoice({ irn: IRN }));
    expect(error.kind).toBe("NOT_FOUND");
    expect(error.providerCode).toBe("2148");
  });

  it("maps taxpayer credential errors (1017 incorrect user id) to an auth failure", async () => {
    const authError = { code: 200, data: { ErrorDetails: [{ ErrorCode: "1017", ErrorMessage: "Incorrect user id/User does not exists" }], InfoDtls: null, Status: 0 }, timestamp: 1, transaction_id: "t" };
    const { quicko } = provider([{ status: 200, body: PLATFORM_AUTH }, { status: 200, body: authError }]);
    const error = await failure(quicko.verifyEInvoice({ irn: IRN }));
    expect(error.kind).toBe("AUTH_FAILURE");
    expect(error.providerCode).toBe("1017");
  });

  it("maps a GSTN server error (status_cd 0, GEN5008) to provider down", async () => {
    const gstnDown = { code: 200, data: { error: { error_cd: "GEN5008", message: "GSTN Server Error" }, status_cd: "0" }, timestamp: 1735661058000, transaction_id: "14f91604" };
    const { quicko } = provider([{ status: 200, body: PLATFORM_AUTH }, { status: 200, body: gstnDown }]);
    expect((await failure(quicko.verifyEInvoice({ irn: IRN }))).kind).toBe("PROVIDER_DOWN");
  });

  it("maps documented HTTP errors", async () => {
    const unauthorised = { code: 401, message: "Unauthorized", timestamp: 1687602744185, transaction_id: "2230d738-2ef4-4821-a510-cb7fa51d19d8" };
    const { quicko } = provider([{ status: 401, body: unauthorised }]);
    expect((await failure(quicko.verifyEInvoice({ irn: IRN }))).kind).toBe("AUTH_FAILURE");

    const unavailable = { code: 503, message: "Service Unavailable", timestamp: 1, transaction_id: "t" };
    const { quicko: second } = provider([{ status: 200, body: PLATFORM_AUTH }, { status: 200, body: TAXPAYER_AUTH(Date.now() + 3600_000) }, { status: 503, body: unavailable }, { status: 503, body: unavailable }, { status: 503, body: unavailable }]);
    expect((await failure(second.verifyEInvoice({ irn: IRN }))).kind).toBe("PROVIDER_DOWN");
  });

  it("rejects a malformed IRN without calling the provider", async () => {
    const { quicko, fetch } = provider([]);
    expect((await failure(quicko.verifyEInvoice({ irn: "not-an-irn" }))).kind).toBe("INVALID_INPUT");
    expect(fetch.requests).toHaveLength(0);
  });
});

describe("e-invoice helpers", () => {
  it("converts rupee amounts to paise exactly", () => {
    expect(rupeesToPaiseString(590000.5)).toBe("59000050");
    expect(rupeesToPaiseString("1234.56")).toBe("123456");
    expect(rupeesToPaiseString(100)).toBe("10000");
    expect(rupeesToPaiseString("abc")).toBeNull();
  });

  it("tolerates unreadable signed invoices", () => {
    expect(decodeSignedInvoice("garbage")).toEqual({ sellerGstin: null, buyerGstin: null, documentNumber: null, documentDate: null, totalValuePaise: null });
    expect(decodeSignedInvoice(null).sellerGstin).toBeNull();
  });
});
