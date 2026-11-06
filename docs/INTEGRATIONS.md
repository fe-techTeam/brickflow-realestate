# Integrations: verification and KYC

BrickFlow verifies organisations (GSTIN, PAN, Udyam), payout bank accounts (penny drop) and e-invoices (IRN) through paid third-party APIs. This document records which providers are used, the exact API versions and endpoints the adapters were built against, and how to switch from the built-in sandbox to live keys.

> **Status: built from documentation, not yet exercised with provider keys.** The Cashfree and Sandbox.co.in adapters follow the providers' published API references (links below) and pass contract tests against the documented request and response shapes. No sandbox or live credentials were available while building them. **Before go-live, run every check against each provider's test environment with real test keys** (see [Go-live checklist](#go-live-checklist)) and update the fixtures if a live response differs from the documentation.

## Providers

| Check | Provider | Why |
| --- | --- | --- |
| GSTIN | Cashfree Payments — Secure ID (Verification API v2) | One RBI-regulated payments provider covers four of the five checks with a single contract, public API reference, published sandbox test data and a synchronous penny drop. |
| PAN (with name match) | Cashfree Secure ID | Returns a provider name-match score and band. |
| Bank account (penny drop) | Cashfree Secure ID | Synchronous `bank-account/sync`; returns name at bank, match score and a UTR. |
| Udyam (MSME) | Cashfree Secure ID | Returns enterprise name, category (micro/small/medium) and status. |
| E-invoice (IRN) | Sandbox.co.in (Quicko) — GST compliance API | Cashfree has no e-invoice endpoint. Sandbox.co.in is a GST Suvidha Provider with a public reference for NIC's "Get e-Invoice by IRN". |
| MahaRERA agent registration | Manual review | MahaRERA publishes no API. The partner records the number, expiry and certificate; an administrator checks the public register. |

Other aggregators considered: Surepass, Signzy, IDfy, Perfios/Karza and Setu. None publishes endpoint-level e-invoice documentation without a login, and Cashfree's public OpenAPI file made an exact, testable adapter possible.

## Cashfree Secure ID (Verification API v2)

- API reference: <https://www.cashfree.com/docs/api-reference/vrs/getting-started>
- OpenAPI specification the adapter was built from: <https://www.cashfree.com/docs/openapi/vrs/vrsv2.yaml> (spec `info.version` 2023-12-18)
- Sandbox test data: <https://www.cashfree.com/docs/api-reference/vrs/data-to-test-integration>
- Rate limits: <https://www.cashfree.com/docs/api-reference/vrs/v2/verification-rate-limits> (100 requests/minute for GSTIN and bank account, 200 for PAN)
- Base URLs: sandbox `https://sandbox.cashfree.com/verification`, production `https://api.cashfree.com/verification`
- Authentication: `x-client-id` and `x-client-secret` on every request. When the account's two-factor method is **Public Key**, the adapter also sends `x-cf-signature`: RSA-OAEP (SHA-1) encryption of `<clientId>.<unix seconds>` with the dashboard public key, base64-encoded, valid for 5 minutes. With the **IP allow-list** method, add the server's egress IP in the dashboard instead.
- `x-api-version: 2022-10-26` is sent on `POST /pan` (any date after 2022-09-12 returns the Aadhaar-seeding fields).

| Check | Endpoint | Docs | Request | Key response fields |
| --- | --- | --- | --- | --- |
| GSTIN | `POST /gstin` | [verify-gstin](https://www.cashfree.com/docs/api-reference/vrs/v2/gstin/verify-gstin) | `GSTIN`, `business_name` | `valid`, `gst_in_status`, `legal_name_of_business`, `trade_name_of_business`, `date_of_registration`, `constitution_of_business`, `taxpayer_type`, `reference_id`. "GSTIN Doesn't Exist" is HTTP 200 without `valid`. |
| PAN | `POST /pan` | [verify-pan-sync](https://www.cashfree.com/docs/api-reference/vrs/v2/pan/verify-pan-sync) | `pan`, `name` | `valid`, `pan_status` (VALID/INVALID/DELETED/DEACTIVATED), `registered_name`, `type`, `name_match_score`, `name_match_result`, `aadhaar_seeding_status` |
| Bank account | `POST /bank-account/sync` | [bank-account-verification-sync-v2](https://www.cashfree.com/docs/api-reference/vrs/v2/bav-v2/bank-account-verification-sync-v2) | `bank_account`, `ifsc`, `name` | `account_status` (VALID/INVALID), `account_status_code`, `name_at_bank`, `name_match_score`, `name_match_result`, `bank_name`, `branch`, `utr` |
| Udyam | `POST /udyam` | [verify-udyam](https://www.cashfree.com/docs/api-reference/vrs/v2/udyam/verify-udyam) | `verification_id` (unique), `udyam` | `status` (SUCCESS/UDYAM_NOT_FOUND/UDYAM_IS_CANCELLED), `enterprise_name`, `enterprise_type`, `organization_type`, `date_of_udyam_registration` |

Error mapping (body `{ type, code, message }`):

| Provider response | BrickFlow error |
| --- | --- |
| 401 `authentication_failed`, 403 `ip_validation_failed`, 400 `x-client-*` codes, 422 `insufficient_balance` | `AUTH_FAILURE` (operator action; the user sees "not available at the moment") |
| 400 field validation codes, 409 duplicate `verification_id`, 422 `fraud_account` | `INVALID_INPUT` (check recorded as failed) |
| 422 `verification_already_under_process`, 429 | `RATE_LIMITED` |
| 422 bank-side codes (`failed_at_bank`, `npci_unavailable`, `connection_timeout`, `source_bank_declined`, `bene_bank_declined`, `imps_mode_fail`, `benficiary_bank_offline`), 5xx | `PROVIDER_DOWN` |

Retries: GSTIN and PAN lookups are retried on 5xx and network errors. The penny drop moves ₹1, so it is never retried after the provider may have processed it (only on HTTP 429). Udyam requires a unique `verification_id`, so it is not blind-retried either.

## Sandbox.co.in (Quicko) — e-invoice by IRN

- Overview: <https://developer.sandbox.co.in/api-reference/gst/compliance/guides/e-invoice/overview>
- Platform authentication: <https://developer.sandbox.co.in/api-reference/authenticate>
- Taxpayer e-invoice session: <https://developer.sandbox.co.in/api-reference/gst/compliance/endpoints/e-invoice/authenticate>
- Get e-invoice by IRN: <https://developer.sandbox.co.in/api-reference/gst/compliance/endpoints/e-invoice/get_e_invoice>
- Errors: <https://developer.sandbox.co.in/guides/developer-resources/errors>
- Base URLs: test `https://test-api.sandbox.co.in`, production `https://api.sandbox.co.in`; `x-api-version: 1.0`

Flow, with every token sent raw in `authorization` (the documentation states these are not bearer tokens):

1. `POST /authenticate` with `x-api-key` and `x-api-secret` → platform token (`data.access_token`, valid 24 hours; cached for 23).
2. `POST /gst/compliance/e-invoice/tax-payer/authenticate?force=true` with the platform token and the taxpayer's e-invoice API credentials `{ username, password, gstin }` → e-invoice session (`data.access_token`, `data.expiry` in ms).
3. `GET /gst/compliance/e-invoice/tax-payer/invoice/{irn}` with the e-invoice session → `data.Data` with `Irn`, `AckNo`, `AckDt`, `Status` (`ACT`/`CNL`), `EwbNo` and `SignedInvoice`.

Portal errors arrive as HTTP 200 with `data.Status = 0` and `ErrorDetails[].ErrorCode`: 2148 (IRN not available) and 2283 (older than the portal serves) map to `NOT_FOUND`; 1015/1017/1019 (credential errors) map to `AUTH_FAILURE`; `status_cd: "0"` with `GEN5008` maps to `PROVIDER_DOWN`. An expired session (401/403) is renewed once automatically.

**Constraints set by the Invoice Registration Portal**, which also apply to every other GSP:

- The authenticated taxpayer must be the supplier or the recipient on the invoice. BrickFlow therefore authenticates as one configured taxpayer (`QUICKO_EINVOICE_GSTIN`), normally the builder that receives the channel partner's invoices. Per-builder credentials (stored encrypted) are a follow-up once more than one builder needs online IRN checks.
- IRN details are served only for a short period after generation (two to three days). Sandbox.co.in also documents a GST taxpayer-API route (`GET /gst/compliance/tax-payer/e-invoice/{irn}`, six months of history, needs a GST-portal taxpayer session); it is not implemented yet.
- Invoice particulars (seller and buyer GSTIN, document number and date, total value) are read from the `SignedInvoice` JWT payload without verifying NIC's signature, so they are informational. The `Status` and `AckNo` returned by the portal are authoritative.

## Sandbox provider (development, tests and demonstrations)

`VERIFICATION_PROVIDER=sandbox` uses a deterministic, offline provider. Results depend only on the input, so tests and demonstrations are reproducible. It echoes the organisation's legal name as the registered name, so normal inputs verify. Trigger values:

| Input | Trigger | Result |
| --- | --- | --- |
| PAN (also inside a GSTIN) | digits `0000` | GSTIN not found; PAN invalid |
| | digits `9999` | GSTIN cancelled; PAN deactivated |
| | digits `1111` | Registered to a different name (routes to admin review) |
| | digits `5555` | Provider unavailable |
| Bank account | ends `0000` / `9999` / `1111` / `5555` | Invalid account / blocked / name mismatch / unavailable |
| Udyam number | ends `0000` / `9999` / `5555` | Not found / cancelled / unavailable; last digit 0–6 micro, 7–8 small, 9 medium |
| IRN | starts `0000` / `ffff` / `5555` | Not found / cancelled / unavailable |

In production the sandbox is refused unless `ALLOW_SANDBOX_VERIFICATION=true`, and every use then logs a `SANDBOX VERIFICATION PROVIDER ACTIVE IN PRODUCTION` warning. Use that only for non-customer environments such as the demo server.

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `VERIFICATION_PROVIDER` | Production | `sandbox` outside production | `cashfree` or `sandbox`. |
| `VERIFICATION_EINVOICE_PROVIDER` | No | `sandbox` when the primary provider is the sandbox; otherwise none | `quicko` or `sandbox`. Without one, e-invoice checks report "not available". |
| `ALLOW_SANDBOX_VERIFICATION` | No | `false` | Must be `true` to use the sandbox when `NODE_ENV=production`. |
| `CASHFREE_VERIFICATION_CLIENT_ID` / `CASHFREE_VERIFICATION_CLIENT_SECRET` | With `cashfree` | — | Secure ID credentials (Dashboard → Developers → API keys). |
| `CASHFREE_VERIFICATION_ENV` | No | `production` in production, else `sandbox` | Selects the base URL. |
| `CASHFREE_VERIFICATION_PUBLIC_KEY` | With public-key 2FA | — | PEM public key; `\n` escapes are accepted. |
| `CASHFREE_VERIFICATION_BASE_URL` | No | — | Overrides the base URL (e.g. a test proxy). |
| `QUICKO_API_KEY` / `QUICKO_API_SECRET` | With `quicko` | — | Sandbox.co.in API key and secret (`key_live_…` / `key_test_…`). |
| `QUICKO_ENV` | No | `production` in production, else `test` | Selects the base URL. |
| `QUICKO_EINVOICE_GSTIN` / `QUICKO_EINVOICE_USERNAME` / `QUICKO_EINVOICE_PASSWORD` | With `quicko` | — | E-invoice API credentials of the taxpayer BrickFlow authenticates as. |
| `QUICKO_BASE_URL` | No | — | Overrides the base URL. |
| `VERIFICATION_CACHE_TTL_HOURS` | No | `24` | An identical check for the same organisation within this window reuses the stored result instead of calling the provider. `0` disables the cache. |
| `CONNECTOR_DEBUG` | No | `false` | `true` also logs debug-level connector events. |

KYC policy variables (`KYC_ENFORCED`, name-match thresholds, validity periods, cooling-off) are listed in [DEPLOYMENT.md](DEPLOYMENT.md#environment-variables).

## Connector framework

`src/server/connectors/` is the shared base for every external provider:

- `ResilientHttpClient` (on `fetch`): per-call timeout, retries with exponential backoff and full jitter for idempotent or explicitly retry-safe calls (HTTP 429 is always retried, honouring `Retry-After`), a circuit breaker per provider (opens after 5 consecutive failures for 30 seconds, then lets one trial call through), `x-request-id` propagation, and one structured JSON log line per call.
- Redaction (`redaction.ts`): secrets (authorisation headers, client secrets, tokens, passwords, signed invoices) are removed; PAN, GSTIN, account numbers, email addresses and phone numbers are partially masked in logs, audit metadata and the stored provider response.
- Typed errors: `ProviderDownError`, `InvalidInputError`, `NotFoundError`, `RateLimitedError`, `AuthFailureError` (`kind` on the base `ConnectorError`).
- Registry: `verification.gstin()`, `.pan()`, `.bankAccount()`, `.udyam()`, `.eInvoice()` return the configured adapter.

Each check is stored in `VerificationCheck` with the normalised result, the provider and its reference, a SHA-256 hash of the raw response body and a redacted copy of it (never the raw response), the status, `checkedAt` and `expiresAt`.

## Go-live checklist

1. Create Cashfree Secure ID test credentials; choose the 2FA method (public key or IP allow-list) and configure it.
2. Set `VERIFICATION_PROVIDER=cashfree`, `CASHFREE_VERIFICATION_ENV=sandbox` and the credentials on a staging environment.
3. Run each check with the documented test data (GSTIN `29AAICP2912R1ZR`, PAN `ABCPV1234D`, account `026291800001191` / IFSC `YESB0000262`, Udyam `UDYAM-UP-43-1234567`) and their negative counterparts. Compare each raw response (from the redacted copy) with the fixtures in `src/server/connectors/verification/providers/fixtures/cashfree.ts`; update the fixtures and adapter if they differ.
4. Repeat for Sandbox.co.in test keys and a taxpayer test account mapped to the GSP; verify a recent IRN.
5. Confirm error handling with wrong credentials (expect `AUTH_FAILURE` in the logs) and the circuit breaker by pointing `*_BASE_URL` at an unreachable host.
6. Switch to production credentials, set `KYC_ENFORCED=true` and remove `ALLOW_SANDBOX_VERIFICATION`.
