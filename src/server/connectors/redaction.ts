/**
 * Redaction of secrets and personal data before anything reaches logs, audit metadata or the stored
 * copy of a provider response. Secrets are removed entirely; identifiers are partially masked so a
 * record stays recognisable to an operator without exposing the full value.
 */
import { maskAccountNumber, maskGstin, maskPan } from "@/lib/verification/masking";

export const REDACTED = "[REDACTED]";

const SECRET_KEY = /(authori[sz]ation|secret|password|passwd|token|signature|api[-_]?key|cookie|session|signedinvoice|signedqrcode|private[-_]?key)/i;
const ACCOUNT_KEY = /(bank[-_]?account|account[-_]?(number|no)|acc[-_]?no|beneficiary[-_]?account)$/i;
const PAN_KEY = /^pan(_?number)?$/i;
const GSTIN_KEY = /gstin/i;
const CONTACT_KEY = /(aadhaar|aadhar|email|mobile|phone)/i;
const MASKED_AADHAAR_KEY = /masked_aadhaar/i;

const PAN_IN_TEXT = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const GSTIN_IN_TEXT = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g;
const LONG_DIGITS_IN_TEXT = /\b\d{9,18}\b/g;
const EMAIL_IN_TEXT = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

function maskContact(value: string): string {
  if (value.includes("@")) return value.replace(EMAIL_IN_TEXT, "$1•••@$2");
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `•••${digits.slice(-2)}` : REDACTED;
}

/** Masks identifiers embedded in free text (error messages, addresses, URLs). */
export function redactText(text: string): string {
  return text
    .replace(GSTIN_IN_TEXT, (match) => maskGstin(match))
    .replace(PAN_IN_TEXT, (match) => maskPan(match))
    .replace(EMAIL_IN_TEXT, "$1•••@$2")
    .replace(LONG_DIGITS_IN_TEXT, (match) => maskAccountNumber(match));
}

function redactByKey(key: string, value: string): string | null {
  if (SECRET_KEY.test(key)) return REDACTED;
  if (ACCOUNT_KEY.test(key)) return maskAccountNumber(value);
  if (PAN_KEY.test(key)) return maskPan(value);
  if (GSTIN_KEY.test(key)) return maskGstin(value);
  if (MASKED_AADHAAR_KEY.test(key)) return REDACTED;
  if (CONTACT_KEY.test(key)) return maskContact(value);
  return null;
}

/** Deep copy with secrets removed and identifiers masked. Numbers and booleans pass through. */
export function redact<T>(value: T, key = "", depth = 0): T {
  if (depth > 12) return REDACTED as T;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return (redactByKey(key, value) ?? redactText(value)) as T;
  if (typeof value === "number" || typeof value === "boolean") {
    if (key && (SECRET_KEY.test(key) || ACCOUNT_KEY.test(key))) return REDACTED as T;
    return value;
  }
  if (typeof value === "bigint") return value.toString() as T;
  if (Array.isArray(value)) return value.map((item) => redact(item, key, depth + 1)) as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) out[childKey] = redact(child, childKey, depth + 1);
    return out as T;
  }
  return REDACTED as T;
}

const SENSITIVE_HEADER = /^(authorization|x-client-secret|x-api-secret|x-api-key|api_key|x-cf-signature|cookie|set-cookie|proxy-authorization)$/i;

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER.test(name)) out[name] = REDACTED;
    else if (/^x-client-id$/i.test(name)) out[name] = value.length > 6 ? `${value.slice(0, 4)}…` : REDACTED;
    else out[name] = value;
  }
  return out;
}

/** Path and query with identifiers masked (some providers put the subject in the URL). */
export function redactUrl(pathAndQuery: string): string {
  return redactText(decodeURIComponentSafe(pathAndQuery)).replace(/\b[0-9a-f]{64}\b/gi, (irn) => `${irn.slice(0, 8)}…`);
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
