/**
 * Sandbox.co.in (Quicko) — GST e-invoice "Get e-Invoice by IRN" through their GSP access to the
 * Invoice Registration Portal. Built from the public API reference; see docs/INTEGRATIONS.md.
 * Must be exercised with test keys before go-live.
 *
 *   POST /authenticate                                          platform token (24 h), x-api-key + x-api-secret
 *   POST /gst/compliance/e-invoice/tax-payer/authenticate       taxpayer e-invoice session
 *   GET  /gst/compliance/e-invoice/tax-payer/invoice/{irn}      e-invoice by IRN
 *
 * Constraints set by the portal: the authenticated taxpayer must be the supplier or the recipient on
 * the invoice, and IRN details are only served for a short period after generation. Tokens are
 * sent raw in `authorization` (no "Bearer" prefix). Portal errors arrive as HTTP 200 with
 * `data.Status = 0` and `ErrorDetails`, so the body decides the outcome, not the HTTP status.
 */
import { z } from "zod";
import { validateIrn } from "@/lib/verification/validation";
import { connectorError, kindForHttpStatus, NotFoundError, ProviderDownError, type ConnectorErrorKind } from "../../errors";
import { ResilientHttpClient, type HttpResponse } from "../../http-client";
import type { CallContext, EInvoiceInput, EInvoiceResult, EInvoiceVerifier, ProviderOutcome } from "../types";

export const QUICKO_PROVIDER = "quicko";

export const QUICKO_BASE_URLS = {
  test: "https://test-api.sandbox.co.in",
  production: "https://api.sandbox.co.in",
} as const;

const PLATFORM_TOKEN_TTL_MS = 23 * 60 * 60 * 1000;
const TOKEN_SAFETY_MS = 5 * 60 * 1000;

export interface QuickoConfig {
  apiKey: string;
  apiSecret: string;
  environment: keyof typeof QUICKO_BASE_URLS;
  baseUrl?: string;
  /** Taxpayer e-invoice API credentials (created on the e-invoice portal and mapped to the GSP). */
  taxpayerGstin: string;
  taxpayerUsername: string;
  taxpayerPassword: string;
  timeoutMs?: number;
  now?: () => number;
}

const platformAuthBody = z.object({ data: z.object({ access_token: z.string().min(1) }).loose() }).loose();

const nicErrors = z.array(z.object({ ErrorCode: z.union([z.string(), z.number()]).transform(String), ErrorMessage: z.string().nullish() }).loose()).nullish();

const taxpayerAuthBody = z
  .object({
    data: z
      .object({
        Status: z.union([z.number(), z.string()]).nullish(),
        access_token: z.string().nullish(),
        expiry: z.number().nullish(),
        ErrorDetails: nicErrors,
        status_cd: z.string().nullish(),
        error: z.object({ error_cd: z.string().nullish(), message: z.string().nullish() }).loose().nullish(),
      })
      .loose(),
  })
  .loose();

const eInvoiceBody = z
  .object({
    transaction_id: z.string().nullish(),
    data: z
      .object({
        Status: z.union([z.number(), z.string()]).nullish(),
        ErrorDetails: nicErrors,
        status_cd: z.string().nullish(),
        error: z.object({ error_cd: z.string().nullish(), message: z.string().nullish() }).loose().nullish(),
        Data: z
          .object({
            AckNo: z.union([z.number(), z.string()]).nullish(),
            AckDt: z.string().nullish(),
            Irn: z.string().nullish(),
            EwbNo: z.union([z.number(), z.string()]).nullish(),
            SignedInvoice: z.string().nullish(),
            Status: z.string().nullish(),
          })
          .loose()
          .nullish(),
      })
      .loose(),
  })
  .loose();

const errorBody = z.object({ code: z.number().optional(), message: z.string().optional() }).loose();

/** IRP: invalid GSTIN for the user, incorrect user id, incorrect password. */
const AUTH_ERROR_CODES = new Set(["1015", "1017", "1019"]);
/** IRP: IRN unknown, or older than the portal serves. */
const NOT_FOUND_ERROR_CODES = new Set(["2148", "2283"]);

const USER_MESSAGES: Record<ConnectorErrorKind, string> = {
  PROVIDER_DOWN: "The e-invoice portal is temporarily unavailable. Try again shortly.",
  INVALID_INPUT: "The e-invoice portal rejected the details submitted.",
  NOT_FOUND: "The e-invoice portal has no details for this IRN.",
  RATE_LIMITED: "Too many verification requests. Try again in a minute.",
  AUTH_FAILURE: "E-invoice verification is not available at the moment. Our team has been alerted.",
};

function details(operation: string, extra: { httpStatus?: number; providerCode?: string; requestId?: string } = {}) {
  return { provider: QUICKO_PROVIDER, operation, ...extra };
}

/** Maps a non-2xx Sandbox.co.in response ({ code, message, timestamp, transaction_id }). */
export function quickoHttpError(response: Pick<HttpResponse, "status" | "json" | "requestId">, operation: string) {
  const parsed = errorBody.safeParse(response.json);
  let kind = kindForHttpStatus(response.status);
  // 403 covers expired tokens and also exhausted wallet credit or quota: all need operator action.
  if (response.status === 403) kind = "AUTH_FAILURE";
  return connectorError(kind, USER_MESSAGES[kind], details(operation, { httpStatus: response.status, providerCode: parsed.success && parsed.data.code ? String(parsed.data.code) : undefined, requestId: response.requestId }));
}

function portalError(data: { ErrorDetails?: { ErrorCode: string }[] | null; status_cd?: string | null; error?: { error_cd?: string | null } | null }, operation: string, requestId: string) {
  const code = data.ErrorDetails?.[0]?.ErrorCode ?? data.error?.error_cd ?? undefined;
  let kind: ConnectorErrorKind = "INVALID_INPUT";
  if (code && AUTH_ERROR_CODES.has(code)) kind = "AUTH_FAILURE";
  else if (code && NOT_FOUND_ERROR_CODES.has(code)) kind = "NOT_FOUND";
  else if (!code || code.startsWith("GEN")) kind = "PROVIDER_DOWN";
  const message = code === "2283" ? "IRN details are only available for a short period after the e-invoice is generated." : USER_MESSAGES[kind];
  return connectorError(kind, message, details(operation, { httpStatus: 200, providerCode: code, requestId }));
}

function isSuccess(status: number | string | null | undefined): boolean {
  return status === 1 || status === "1";
}

/** Converts a rupee amount (number or decimal string) to paise without floating-point arithmetic on the result. */
export function rupeesToPaiseString(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = typeof value === "number" ? value.toFixed(2) : value.trim();
  const match = /^(\d+)(?:\.(\d{1,2})\d*)?$/.exec(text);
  if (!match) return null;
  return (BigInt(match[1]!) * 100n + BigInt((match[2] ?? "0").padEnd(2, "0"))).toString();
}

/** dd/mm/yyyy → yyyy-mm-dd */
function isoFromIndian(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** "2024-02-21 21:41:00" (IST, as returned by the portal) → ISO 8601 with offset. */
function isoFromPortalTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  return match ? `${match[1]}T${match[2]}+05:30` : value;
}

/**
 * Reads invoice particulars from the SignedInvoice JWT payload. The signature is not verified here,
 * so these fields are informational; the authoritative facts are the portal's Status and AckNo.
 */
export function decodeSignedInvoice(token: string | null | undefined): Pick<EInvoiceResult, "sellerGstin" | "buyerGstin" | "documentNumber" | "documentDate" | "totalValuePaise"> {
  const empty = { sellerGstin: null, buyerGstin: null, documentNumber: null, documentDate: null, totalValuePaise: null };
  if (!token) return empty;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { data?: unknown };
    const invoice = (typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data) as Record<string, Record<string, unknown> | undefined>;
    return {
      sellerGstin: typeof invoice.SellerDtls?.Gstin === "string" ? invoice.SellerDtls.Gstin : null,
      buyerGstin: typeof invoice.BuyerDtls?.Gstin === "string" ? invoice.BuyerDtls.Gstin : null,
      documentNumber: typeof invoice.DocDtls?.No === "string" ? invoice.DocDtls.No : null,
      documentDate: isoFromIndian(invoice.DocDtls?.Dt),
      totalValuePaise: rupeesToPaiseString(invoice.ValDtls?.TotInvVal),
    };
  } catch {
    return empty;
  }
}

export class QuickoEInvoiceProvider implements EInvoiceVerifier {
  readonly provider = QUICKO_PROVIDER;
  private readonly http: ResilientHttpClient;
  private readonly now: () => number;
  private platformToken: { value: string; expiresAt: number } | null = null;
  private taxpayerToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: QuickoConfig,
    http?: ResilientHttpClient,
  ) {
    this.now = config.now ?? Date.now;
    this.http =
      http ??
      new ResilientHttpClient({
        provider: QUICKO_PROVIDER,
        baseUrl: config.baseUrl ?? QUICKO_BASE_URLS[config.environment],
        timeoutMs: config.timeoutMs ?? 20_000,
        defaultHeaders: { "x-api-key": config.apiKey },
      });
  }

  private async platformAccessToken(context?: CallContext): Promise<string> {
    if (this.platformToken && this.platformToken.expiresAt > this.now()) return this.platformToken.value;
    const operation = "auth.platform";
    const response = await this.http.request({
      operation,
      method: "POST",
      path: "/authenticate",
      headers: { "x-api-secret": this.config.apiSecret, "x-api-version": "1.0" },
      retrySafe: true,
      requestId: context?.requestId,
    });
    if (!response.ok) throw quickoHttpError(response, operation);
    const parsed = platformAuthBody.safeParse(response.json);
    if (!parsed.success) throw new ProviderDownError(USER_MESSAGES.PROVIDER_DOWN, details(operation, { requestId: response.requestId }));
    this.platformToken = { value: parsed.data.data.access_token, expiresAt: this.now() + PLATFORM_TOKEN_TTL_MS };
    return this.platformToken.value;
  }

  private async taxpayerAccessToken(context?: CallContext): Promise<string> {
    if (this.taxpayerToken && this.taxpayerToken.expiresAt > this.now()) return this.taxpayerToken.value;
    const operation = "auth.e_invoice_taxpayer";
    const platform = await this.platformAccessToken(context);
    const response = await this.http.request({
      operation,
      method: "POST",
      path: "/gst/compliance/e-invoice/tax-payer/authenticate",
      query: { force: "true" },
      headers: { authorization: platform, "x-source": "primary" },
      json: { username: this.config.taxpayerUsername, password: this.config.taxpayerPassword, gstin: this.config.taxpayerGstin },
      retrySafe: true,
      requestId: context?.requestId,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) this.platformToken = null;
      throw quickoHttpError(response, operation);
    }
    const parsed = taxpayerAuthBody.safeParse(response.json);
    if (!parsed.success) throw new ProviderDownError(USER_MESSAGES.PROVIDER_DOWN, details(operation, { requestId: response.requestId }));
    const data = parsed.data.data;
    if (!isSuccess(data.Status) || !data.access_token) throw portalError(data, operation, response.requestId);
    const expiresAt = data.expiry ? data.expiry - TOKEN_SAFETY_MS : this.now() + 60 * 60 * 1000;
    this.taxpayerToken = { value: data.access_token, expiresAt };
    return data.access_token;
  }

  async verifyEInvoice(input: EInvoiceInput, context?: CallContext): Promise<ProviderOutcome<EInvoiceResult>> {
    const operation = "e_invoice.verify";
    const valid = validateIrn(input.irn);
    if (!valid.ok) throw connectorError("INVALID_INPUT", valid.error, details(operation));

    let response: HttpResponse | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.taxpayerAccessToken(context);
      response = await this.http.request({
        operation,
        method: "GET",
        path: `/gst/compliance/e-invoice/tax-payer/invoice/${valid.value}`,
        query: { supplier_gstin: input.supplierGstin },
        headers: { authorization: token, "x-source": "primary" },
        requestId: context?.requestId,
      });
      // An expired session surfaces as 401/403; refresh it once.
      if ((response.status === 401 || response.status === 403) && attempt === 0) {
        this.taxpayerToken = null;
        continue;
      }
      break;
    }
    if (!response!.ok) throw quickoHttpError(response!, operation);

    const parsed = eInvoiceBody.safeParse(response!.json);
    if (!parsed.success) throw new ProviderDownError(USER_MESSAGES.PROVIDER_DOWN, details(operation, { requestId: response!.requestId }));
    const data = parsed.data.data;
    if (!isSuccess(data.Status) || !data.Data) {
      if (data.Status === 0 || data.Status === "0" || data.status_cd === "0") throw portalError(data, operation, response!.requestId);
      throw new NotFoundError(USER_MESSAGES.NOT_FOUND, details(operation, { httpStatus: 200, requestId: response!.requestId }));
    }
    const invoice = data.Data;
    const status = (invoice.Status ?? "").toUpperCase();
    if (status !== "ACT" && status !== "CNL") {
      throw new ProviderDownError(USER_MESSAGES.PROVIDER_DOWN, details(operation, { providerCode: status || undefined, requestId: response!.requestId }));
    }
    const result: EInvoiceResult = {
      irn: (invoice.Irn ?? valid.value).toLowerCase(),
      status: status === "ACT" ? "ACTIVE" : "CANCELLED",
      ackNumber: invoice.AckNo === null || invoice.AckNo === undefined ? null : String(invoice.AckNo),
      ackDate: isoFromPortalTimestamp(invoice.AckDt),
      ewayBillNumber: invoice.EwbNo === null || invoice.EwbNo === undefined ? null : String(invoice.EwbNo),
      ...decodeSignedInvoice(invoice.SignedInvoice),
    };
    return { result, provider: QUICKO_PROVIDER, providerReference: parsed.data.transaction_id ?? null, rawBody: response!.text, rawJson: response!.json };
  }
}
