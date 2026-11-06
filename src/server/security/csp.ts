/**
 * Content Security Policy for HTML responses, applied per request in `src/proxy.ts` with a fresh nonce.
 *
 * What the app genuinely loads, and why each exception exists:
 * - Next.js scripts are same-origin; its inline bootstrap scripts carry the request nonce.
 * - In-browser OCR (tesseract.js) runs in a `blob:` worker that inherits this policy and imports its
 *   worker and WebAssembly core from jsDelivr, then fetches language data from jsDelivr. Those sources
 *   are pinned to the exact package paths (not the whole CDN, which would allow any npm package).
 *   WebAssembly compilation needs 'wasm-unsafe-eval' (not 'unsafe-eval').
 * - The PDF.js worker is a same-origin static file.
 * - Inter is self-hosted by next/font, so no third-party font or style origins are needed.
 * - Inline style attributes (Radix positioning, chart sizing) need style-src 'unsafe-inline'.
 * - Invoice PDFs are embedded with <object> from the same origin.
 */
export const TESSERACT_VERSION = "7.0.0";
export const TESSERACT_CORE_VERSION = "7.0.0";

const JSDELIVR = "https://cdn.jsdelivr.net/npm";
export const CSP_REPORT_PATH = "/api/security/csp-report";

export interface CspOptions {
  nonce: string;
  /** Development needs eval (React refresh) and websocket HMR. */
  development: boolean;
  /** Adds upgrade-insecure-requests when the site is served over HTTPS. */
  https: boolean;
}

export function buildContentSecurityPolicy({ nonce, development, https }: CspOptions): string {
  const ocrScripts = [`${JSDELIVR}/tesseract.js@v${TESSERACT_VERSION}/`, `${JSDELIVR}/tesseract.js-core@v${TESSERACT_CORE_VERSION}/`];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'wasm-unsafe-eval'", ...ocrScripts, ...(development ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...ocrScripts, `${JSDELIVR}/@tesseract.js-data/`, ...(development ? ["ws:", "wss:"] : [])],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'self'"],
    "object-src": ["'self'"],
    "media-src": ["'self'"],
    "manifest-src": ["'self'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'self'"],
    "report-uri": [CSP_REPORT_PATH],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (https) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** 128-bit random nonce, base64-encoded (Web Crypto, available in the proxy runtime). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function cspReportOnly(): boolean {
  const value = process.env.CSP_REPORT_ONLY?.trim().toLowerCase();
  if (!value) return false;
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;
  throw new Error(`CSP_REPORT_ONLY must be "true" or "false" (got "${process.env.CSP_REPORT_ONLY}")`);
}

export function cspHeaderName(reportOnly: boolean): "Content-Security-Policy" | "Content-Security-Policy-Report-Only" {
  return reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}
