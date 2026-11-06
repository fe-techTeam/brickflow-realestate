/**
 * Redaction for structured logs. Field names are matched case-insensitively and ignoring separators,
 * so `accountNumber`, `account_number` and `ACCOUNT-NUMBER` are treated alike. Free-text values are
 * scrubbed for credentials embedded in URLs, bearer tokens, JWTs and Indian tax identifiers.
 */

export const REDACTED = "[REDACTED]";

const SECRET_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "passwordhash",
  "secret",
  "clientsecret",
  "authsecret",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "csrftoken",
  "apikey",
  "xapikey",
  "authorization",
  "proxyauthorization",
  "cookie",
  "cookies",
  "setcookie",
  "privatekey",
  "otp",
  "pin",
  "cvv",
  "databaseurl",
  "connectionstring",
  "bfsession",
]);
const SECRET_SUFFIXES = ["password", "secret", "token", "apikey", "privatekey"];
const FULLY_REDACTED_PII = new Set(["pan", "pannumber", "aadhaar", "aadhaarnumber", "vpa", "upiid"]);
const ACCOUNT_KEYS = new Set(["accountnumber", "bankaccountnumber", "beneficiaryaccount", "accountno"]);
const GSTIN_KEYS = new Set(["gstin", "gstnumber", "gst"]);
const EMAIL_KEYS = new Set(["email", "contactemail", "useremail"]);
const PHONE_KEYS = new Set(["phone", "mobile", "contactphone", "phonenumber"]);

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 4_000;

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function maskTail(value: string, visible: number): string {
  const compact = value.replace(/\s+/g, "");
  if (compact.length <= visible) return "*".repeat(compact.length);
  return `${"*".repeat(compact.length - visible)}${compact.slice(-visible)}`;
}

/** Keeps the two-digit state code and the last three characters; hides the embedded PAN. */
export function maskGstin(value: string): string {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  if (compact.length < 6) return "*".repeat(compact.length);
  return `${compact.slice(0, 2)}${"*".repeat(compact.length - 5)}${compact.slice(-3)}`;
}

function maskEmail(value: string): string {
  const at = value.lastIndexOf("@");
  if (at <= 0) return REDACTED;
  return `${value[0]}***${value.slice(at)}`;
}

const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi;
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const GSTIN_TEXT = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/g;
const PAN_TEXT = /\b[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]\b/g;

/** Scrubs secrets and identifiers that can appear inside free text such as error messages. */
export function scrubText(text: string): string {
  const scrubbed = text
    .replace(URL_CREDENTIALS, `$1${REDACTED}@`)
    .replace(AUTH_SCHEME, `$1 ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(GSTIN_TEXT, (match) => maskGstin(match))
    .replace(PAN_TEXT, REDACTED);
  return scrubbed.length > MAX_STRING_LENGTH ? `${scrubbed.slice(0, MAX_STRING_LENGTH)}…[truncated]` : scrubbed;
}

function redactByKey(key: string, value: unknown): { matched: true; value: unknown } | { matched: false } {
  const k = normaliseKey(key);
  if (SECRET_KEYS.has(k) || SECRET_SUFFIXES.some((s) => k.endsWith(s))) return { matched: true, value: value == null ? value : REDACTED };
  if (FULLY_REDACTED_PII.has(k)) return { matched: true, value: value == null ? value : REDACTED };
  if (typeof value !== "string") return { matched: false };
  if (ACCOUNT_KEYS.has(k)) return { matched: true, value: maskTail(value, 4) };
  if (GSTIN_KEYS.has(k)) return { matched: true, value: maskGstin(value) };
  if (EMAIL_KEYS.has(k)) return { matched: true, value: maskEmail(value) };
  if (PHONE_KEYS.has(k)) return { matched: true, value: maskTail(value, 4) };
  return { matched: false };
}

export function serialiseError(error: Error, seen: WeakSet<object>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = { name: error.name, message: scrubText(error.message) };
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" || typeof code === "number") out.code = code;
  if (error.stack) out.stack = scrubText(error.stack);
  if (error.cause !== undefined && depth < MAX_DEPTH) out.cause = redactValue(error.cause, seen, depth + 1);
  return out;
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case "string":
      return scrubText(value);
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "symbol":
      return value.toString();
    case "function":
      return undefined;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  const obj = value as object;
  if (seen.has(obj)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  seen.add(obj);
  try {
    if (obj instanceof Error) return serialiseError(obj, seen, depth);
    if (obj instanceof URL) return scrubText(obj.toString());
    if (obj instanceof Map) return redactObject(Object.fromEntries(obj), seen, depth);
    if (obj instanceof Set) return redactArray([...obj], seen, depth);
    if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) return `[Binary ${(obj as ArrayBuffer).byteLength} bytes]`;
    if (Array.isArray(obj)) return redactArray(obj, seen, depth);
    if (typeof Headers !== "undefined" && obj instanceof Headers) return redactObject(Object.fromEntries(obj.entries()), seen, depth);
    return redactObject(obj as Record<string, unknown>, seen, depth);
  } finally {
    seen.delete(obj);
  }
}

function redactArray(items: unknown[], seen: WeakSet<object>, depth: number): unknown[] {
  const out = items.slice(0, MAX_ARRAY_ITEMS).map((item) => redactValue(item, seen, depth + 1));
  if (items.length > MAX_ARRAY_ITEMS) out.push(`…${items.length - MAX_ARRAY_ITEMS} more`);
  return out;
}

function redactObject(obj: Record<string, unknown>, seen: WeakSet<object>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(obj)) {
    const byKey = redactByKey(key, raw);
    const next = byKey.matched ? byKey.value : redactValue(raw, seen, depth + 1);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

/** Returns a JSON-safe deep copy with secrets removed and personal identifiers masked. */
export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet(), 0);
}
