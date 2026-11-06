/**
 * Cashfree Payments — Secure ID (Verification API v2).
 *
 * Built from the public API reference (OpenAPI: https://www.cashfree.com/docs/openapi/vrs/vrsv2.yaml);
 * see docs/INTEGRATIONS.md for endpoint links. Must be exercised with sandbox keys before go-live.
 *
 *   POST /gstin               GSTIN details
 *   POST /pan                 PAN status with name match
 *   POST /bank-account/sync   penny-drop bank account verification (synchronous)
 *   POST /udyam               Udyam (MSME) registration
 *
 * Cashfree has no e-invoice (IRN) endpoint; that check is served by another provider.
 */
import { constants, publicEncrypt, randomUUID } from "node:crypto";
import { z } from "zod";
import { nameMatchBand, type NameMatch, type NameMatchBand } from "@/lib/verification/name-match";
import { gstStateName, validateAccountNumber, validateGstin, validateIfsc, validatePan, validateUdyam } from "@/lib/verification/validation";
import { connectorError, InvalidInputError, kindForHttpStatus, NotFoundError, ProviderDownError, type ConnectorErrorKind } from "../../errors";
import { ResilientHttpClient, parseRetryAfter, type HttpResponse } from "../../http-client";
import type {
  BankAccountInput,
  BankAccountResult,
  BankAccountVerifier,
  CallContext,
  GstinInput,
  GstinResult,
  GstinVerifier,
  PanInput,
  PanResult,
  PanVerifier,
  ProviderOutcome,
  UdyamInput,
  UdyamResult,
  UdyamVerifier,
} from "../types";

export const CASHFREE_PROVIDER = "cashfree";

export const CASHFREE_BASE_URLS = {
  sandbox: "https://sandbox.cashfree.com/verification",
  production: "https://api.cashfree.com/verification",
} as const;

/** Sent on POST /pan; any date after 2022-09-12 adds the Aadhaar-seeding fields. */
export const CASHFREE_PAN_API_VERSION = "2022-10-26";

export interface CashfreeConfig {
  clientId: string;
  clientSecret: string;
  environment: keyof typeof CASHFREE_BASE_URLS;
  baseUrl?: string;
  /** PEM public key from the dashboard; required only when the account's 2FA method is "Public Key". */
  publicKeyPem?: string;
  timeoutMs?: number;
}

/* Documented response shapes. Fields are optional/nullable because negative results omit them. */

const nullableString = z.string().nullish();
const scoreValue = z.union([z.string(), z.number()]).nullish();

const errorBody = z.object({ type: z.string().optional(), code: z.string().optional(), message: z.string().optional() }).loose();

const gstinBody = z
  .object({
    reference_id: z.number().nullish(),
    GSTIN: nullableString,
    legal_name_of_business: nullableString,
    trade_name_of_business: nullableString,
    date_of_registration: nullableString,
    constitution_of_business: nullableString,
    taxpayer_type: nullableString,
    gst_in_status: nullableString,
    valid: z.boolean().nullish(),
    message: nullableString,
  })
  .loose();

const panBody = z
  .object({
    pan: nullableString,
    type: nullableString,
    reference_id: z.number().nullish(),
    registered_name: nullableString,
    name_pan_card: nullableString,
    valid: z.boolean().nullish(),
    message: nullableString,
    name_match_score: scoreValue,
    name_match_result: nullableString,
    aadhaar_seeding_status: nullableString,
    pan_status: nullableString,
  })
  .loose();

const bankBody = z
  .object({
    reference_id: z.number().nullish(),
    name_at_bank: nullableString,
    bank_name: nullableString,
    city: nullableString,
    branch: nullableString,
    name_match_score: scoreValue,
    name_match_result: nullableString,
    account_status: z.string(),
    account_status_code: nullableString,
    utr: nullableString,
  })
  .loose();

const udyamBody = z
  .object({
    verification_id: nullableString,
    reference_id: z.number().nullish(),
    status: z.string(),
    udyam_number: nullableString,
    enterprise_name: nullableString,
    organization_type: nullableString,
    major_activity: nullableString,
    date_of_udyam_registration: nullableString,
    enterprise_type: nullableString,
    classification_year: nullableString,
  })
  .loose();

const MATCH_RESULT_BAND: Record<string, NameMatchBand> = {
  DIRECT_MATCH: "EXACT",
  GOOD_PARTIAL_MATCH: "STRONG",
  MODERATE_PARTIAL_MATCH: "PARTIAL",
  POOR_PARTIAL_MATCH: "WEAK",
  NO_MATCH: "NONE",
};

const BANK_STATUS_CODE: Record<string, BankAccountResult["statusCode"]> = {
  ACCOUNT_IS_VALID: "ACCOUNT_VALID",
  INVALID_ACCOUNT_FAIL: "INVALID_ACCOUNT",
  ACCOUNT_BLOCKED: "ACCOUNT_BLOCKED",
  INVALID_IFSC_FAIL: "INVALID_IFSC",
  NRE_ACCOUNT_FAIL: "NRE_ACCOUNT",
};

/** Bank-side penny-drop failures documented under HTTP 422 that are transient, not a verdict on the account. */
const BANK_TRANSIENT_CODES = new Set([
  "failed_at_bank",
  "npci_unavailable",
  "connection_timeout",
  "source_bank_declined",
  "bene_bank_declined",
  "imps_mode_fail",
  "benficiary_bank_offline",
  "beneficiary_bank_offline",
]);

const USER_MESSAGES: Record<ConnectorErrorKind, string> = {
  PROVIDER_DOWN: "The verification source is temporarily unavailable. Try again shortly.",
  INVALID_INPUT: "The verification provider rejected the details submitted.",
  NOT_FOUND: "No matching record was found.",
  RATE_LIMITED: "Too many verification requests. Try again in a minute.",
  AUTH_FAILURE: "The verification service is not available at the moment. Our team has been alerted.",
};

/** Maps a documented Cashfree error response to a typed connector error. */
export function cashfreeError(response: Pick<HttpResponse, "status" | "json" | "headers" | "requestId">, operation: string) {
  const parsed = errorBody.safeParse(response.json);
  const code = parsed.success ? parsed.data.code : undefined;
  let kind: ConnectorErrorKind = kindForHttpStatus(response.status);

  if (code?.startsWith("x-client-") || code === "authentication_failed" || code === "ip_validation_failed") kind = "AUTH_FAILURE";
  else if (code === "insufficient_balance") kind = "AUTH_FAILURE";
  else if (code === "verification_already_under_process") kind = "RATE_LIMITED";
  else if (code && BANK_TRANSIENT_CODES.has(code)) kind = "PROVIDER_DOWN";
  else if (code === "invalid_request" && response.status === 400) kind = "AUTH_FAILURE";

  const resetHeader = response.headers.get("x-ratelimit-reset");
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after")) ?? (resetHeader && Number.isFinite(Number(resetHeader)) ? Number(resetHeader) * 1000 : undefined);
  const message = code === "fraud_account" ? "The bank flagged this account. It cannot be used for payouts." : USER_MESSAGES[kind];
  return connectorError(kind, message, {
    provider: CASHFREE_PROVIDER,
    operation,
    httpStatus: response.status,
    providerCode: code,
    requestId: response.requestId,
    retryAfterMs,
  });
}

function parseBody<T>(schema: z.ZodType<T>, response: HttpResponse, operation: string): T {
  const parsed = schema.safeParse(response.json);
  if (!parsed.success) {
    throw new ProviderDownError("The verification provider returned an unexpected response.", {
      provider: CASHFREE_PROVIDER,
      operation,
      httpStatus: response.status,
      requestId: response.requestId,
    });
  }
  return parsed.data;
}

function providerScore(score: string | number | null | undefined, result: string | null | undefined, comparedWith?: string): NameMatch | null {
  if (score === null || score === undefined || score === "") return null;
  const numeric = typeof score === "number" ? score : Number.parseFloat(score);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.max(0, Math.min(100, Math.round(numeric)));
  return { score: rounded, band: (result && MATCH_RESULT_BAND[result]) || nameMatchBand(rounded), source: "provider", comparedWith };
}

/** Accepts yyyy-mm-dd or dd/mm/yyyy (both appear in Cashfree responses). */
function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function gstinStatus(raw: string | null | undefined): GstinResult["status"] {
  const value = (raw ?? "").toLowerCase();
  if (value === "active" || value.startsWith("active")) return "ACTIVE";
  if (value.includes("cancel")) return "CANCELLED";
  if (value.includes("suspend")) return "SUSPENDED";
  return "INACTIVE";
}

const reference = (value: number | null | undefined) => (value === null || value === undefined ? null : String(value));

export class CashfreeVerificationProvider implements GstinVerifier, PanVerifier, BankAccountVerifier, UdyamVerifier {
  readonly provider = CASHFREE_PROVIDER;
  private readonly http: ResilientHttpClient;

  constructor(
    private readonly config: CashfreeConfig,
    http?: ResilientHttpClient,
  ) {
    this.http =
      http ??
      new ResilientHttpClient({
        provider: CASHFREE_PROVIDER,
        baseUrl: config.baseUrl ?? CASHFREE_BASE_URLS[config.environment],
        timeoutMs: config.timeoutMs ?? 15_000,
        defaultHeaders: () => this.authHeaders(),
      });
  }

  /** x-cf-signature: RSA-OAEP(SHA-1) of "<clientId>.<unix seconds>" with the dashboard public key, base64. Valid for 5 minutes. */
  signature(nowSeconds = Math.floor(Date.now() / 1000)): string | null {
    if (!this.config.publicKeyPem) return null;
    const payload = Buffer.from(`${this.config.clientId}.${nowSeconds}`, "utf8");
    return publicEncrypt({ key: this.config.publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" }, payload).toString("base64");
  }

  authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "x-client-id": this.config.clientId, "x-client-secret": this.config.clientSecret };
    const signature = this.signature();
    if (signature) headers["x-cf-signature"] = signature;
    return headers;
  }

  private async post(operation: string, path: string, json: unknown, context: CallContext | undefined, options: { retrySafe: boolean; headers?: Record<string, string> }) {
    const response = await this.http.request({ operation, method: "POST", path, json, retrySafe: options.retrySafe, headers: options.headers, requestId: context?.requestId });
    if (!response.ok) throw cashfreeError(response, operation);
    return response;
  }

  private outcome<T>(result: T, referenceId: string | null, response: HttpResponse): ProviderOutcome<T> {
    return { result, provider: CASHFREE_PROVIDER, providerReference: referenceId, rawBody: response.text, rawJson: response.json };
  }

  async verifyGstin(input: GstinInput, context?: CallContext): Promise<ProviderOutcome<GstinResult>> {
    const operation = "gstin.verify";
    const valid = validateGstin(input.gstin);
    if (!valid.ok) throw new InvalidInputError(valid.error, { provider: CASHFREE_PROVIDER, operation });
    const json: Record<string, string> = { GSTIN: valid.value };
    if (input.name) json.business_name = input.name.slice(0, 200);
    const response = await this.post(operation, "/gstin", json, context, { retrySafe: true });
    const body = parseBody(gstinBody, response, operation);
    // "GSTIN Doesn't Exist" is documented as HTTP 200 without a `valid` field.
    if (body.valid !== true) {
      throw new NotFoundError("No GST registration exists for this GSTIN.", { provider: CASHFREE_PROVIDER, operation, httpStatus: 200, requestId: response.requestId });
    }
    const gstin = (body.GSTIN ?? valid.value).toUpperCase();
    return this.outcome(
      {
        gstin,
        status: gstinStatus(body.gst_in_status),
        providerStatus: body.gst_in_status ?? "Unknown",
        legalName: body.legal_name_of_business ?? null,
        tradeName: body.trade_name_of_business ?? null,
        stateCode: gstin.slice(0, 2),
        stateName: gstStateName(gstin),
        registrationDate: isoDate(body.date_of_registration),
        constitution: body.constitution_of_business ?? null,
        taxpayerType: body.taxpayer_type ?? null,
        nameMatch: null,
      },
      reference(body.reference_id),
      response,
    );
  }

  async verifyPan(input: PanInput, context?: CallContext): Promise<ProviderOutcome<PanResult>> {
    const operation = "pan.verify";
    const valid = validatePan(input.pan);
    if (!valid.ok) throw new InvalidInputError(valid.error, { provider: CASHFREE_PROVIDER, operation });
    const json: Record<string, string> = { pan: valid.value };
    if (input.name) json.name = input.name.replace(/[^A-Za-z0-9 .\-/&]/g, " ").trim();
    const response = await this.post(operation, "/pan", json, context, { retrySafe: true, headers: { "x-api-version": CASHFREE_PAN_API_VERSION } });
    const body = parseBody(panBody, response, operation);
    const declared = (body.pan_status ?? "").toUpperCase();
    const status: PanResult["status"] =
      declared === "VALID" || declared === "INVALID" || declared === "DELETED" || declared === "DEACTIVATED" ? declared : body.valid ? "VALID" : "INVALID";
    const seeding = (body.aadhaar_seeding_status ?? "").toUpperCase();
    return this.outcome(
      {
        pan: valid.value,
        status,
        holderType: body.type ?? null,
        registeredName: body.registered_name ?? body.name_pan_card ?? null,
        nameMatch: input.name ? providerScore(body.name_match_score, body.name_match_result, input.name) : null,
        aadhaarSeeded: seeding === "Y" ? true : seeding === "" || seeding === "NA" ? null : false,
      },
      reference(body.reference_id),
      response,
    );
  }

  async verifyBankAccount(input: BankAccountInput, context?: CallContext): Promise<ProviderOutcome<BankAccountResult>> {
    const operation = "bank_account.verify";
    const account = validateAccountNumber(input.accountNumber);
    if (!account.ok) throw new InvalidInputError(account.error, { provider: CASHFREE_PROVIDER, operation });
    const ifsc = validateIfsc(input.ifsc);
    if (!ifsc.ok) throw new InvalidInputError(ifsc.error, { provider: CASHFREE_PROVIDER, operation });
    const json: Record<string, string> = { bank_account: account.value, ifsc: ifsc.value };
    if (input.name) json.name = input.name.replace(/[^A-Za-z0-9 .\-/&]/g, " ").trim().slice(0, 100);
    // A penny drop moves money, so it is never retried after the provider may have processed it.
    const response = await this.post(operation, "/bank-account/sync", json, context, { retrySafe: false });
    const body = parseBody(bankBody, response, operation);
    const accountStatus = body.account_status.toUpperCase();
    if (accountStatus !== "VALID" && accountStatus !== "INVALID") {
      throw new ProviderDownError("The bank has not confirmed the account yet. Try again shortly.", {
        provider: CASHFREE_PROVIDER,
        operation,
        httpStatus: response.status,
        providerCode: body.account_status_code ?? accountStatus,
        requestId: response.requestId,
      });
    }
    const valid = accountStatus === "VALID";
    const statusCode = (body.account_status_code && BANK_STATUS_CODE[body.account_status_code]) || (valid ? "ACCOUNT_VALID" : "INVALID_ACCOUNT");
    return this.outcome(
      {
        accountLast4: account.value.slice(-4),
        ifsc: ifsc.value,
        status: valid ? "VALID" : "INVALID",
        statusCode,
        beneficiaryName: body.name_at_bank ?? null,
        bankName: body.bank_name ?? null,
        branch: body.branch ?? null,
        city: body.city ?? null,
        nameMatch: valid && input.name ? providerScore(body.name_match_score, body.name_match_result, input.name) : null,
        utr: body.utr ?? null,
      },
      reference(body.reference_id),
      response,
    );
  }

  async verifyUdyam(input: UdyamInput, context?: CallContext): Promise<ProviderOutcome<UdyamResult>> {
    const operation = "udyam.verify";
    const valid = validateUdyam(input.udyamNumber);
    if (!valid.ok) throw new InvalidInputError(valid.error, { provider: CASHFREE_PROVIDER, operation });
    const verificationId = (context?.verificationId ?? `bf-${randomUUID()}`).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 50);
    // verification_id must be unique, so a blind retry would fail with 409 rather than repeat the lookup.
    const response = await this.post(operation, "/udyam", { verification_id: verificationId, udyam: valid.value }, context, { retrySafe: false });
    const body = parseBody(udyamBody, response, operation);
    const status = body.status.toUpperCase();
    if (status === "UDYAM_NOT_FOUND") {
      throw new NotFoundError("No Udyam registration exists for this number.", { provider: CASHFREE_PROVIDER, operation, httpStatus: 200, requestId: response.requestId });
    }
    if (status !== "SUCCESS" && status !== "UDYAM_IS_CANCELLED") {
      throw new ProviderDownError("The verification provider returned an unexpected status.", {
        provider: CASHFREE_PROVIDER,
        operation,
        providerCode: status,
        requestId: response.requestId,
      });
    }
    const type = (body.enterprise_type ?? "").toUpperCase();
    return this.outcome(
      {
        udyamNumber: (body.udyam_number ?? valid.value).toUpperCase(),
        status: status === "SUCCESS" ? "ACTIVE" : "CANCELLED",
        enterpriseName: body.enterprise_name ?? null,
        enterpriseType: type === "MICRO" || type === "SMALL" || type === "MEDIUM" ? type : null,
        organisationType: body.organization_type ?? null,
        majorActivity: body.major_activity ?? null,
        registrationDate: isoDate(body.date_of_udyam_registration),
        classificationYear: body.classification_year ?? null,
      },
      reference(body.reference_id),
      response,
    );
  }
}
