import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, cspHeaderName, cspReportOnly, generateNonce, TESSERACT_CORE_VERSION, TESSERACT_VERSION } from "./csp";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name!, values];
    }),
  );
}

afterEach(() => {
  delete process.env.CSP_REPORT_ONLY;
});

describe("content security policy", () => {
  const production = directives(buildContentSecurityPolicy({ nonce: "abc123==", development: false, https: true }));

  it("allows scripts only from self, the request nonce and the pinned OCR packages", () => {
    expect(production.get("script-src")).toEqual([
      "'self'",
      "'nonce-abc123=='",
      "'wasm-unsafe-eval'",
      `https://cdn.jsdelivr.net/npm/tesseract.js@v${TESSERACT_VERSION}/`,
      `https://cdn.jsdelivr.net/npm/tesseract.js-core@v${TESSERACT_CORE_VERSION}/`,
    ]);
    const all = [...production.values()].flat();
    expect(all).not.toContain("'unsafe-eval'");
    expect(all).not.toContain("https://cdn.jsdelivr.net");
    expect(all).not.toContain("*");
  });

  it("keeps OCR language data, workers and embedded PDFs working", () => {
    expect(production.get("connect-src")).toContain("https://cdn.jsdelivr.net/npm/@tesseract.js-data/");
    expect(production.get("worker-src")).toEqual(["'self'", "blob:"]);
    expect(production.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(production.get("object-src")).toEqual(["'self'"]);
  });

  it("locks down framing, base URI, form targets and reports violations", () => {
    expect(production.get("default-src")).toEqual(["'self'"]);
    expect(production.get("frame-ancestors")).toEqual(["'self'"]);
    expect(production.get("base-uri")).toEqual(["'self'"]);
    expect(production.get("form-action")).toEqual(["'self'"]);
    expect(production.get("report-uri")).toEqual(["/api/security/csp-report"]);
    expect(production.has("upgrade-insecure-requests")).toBe(true);
  });

  it("adds eval and websocket HMR only in development, and no upgrade over plain HTTP", () => {
    const dev = directives(buildContentSecurityPolicy({ nonce: "n", development: true, https: false }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("connect-src")).toEqual(expect.arrayContaining(["ws:", "wss:"]));
    expect(dev.has("upgrade-insecure-requests")).toBe(false);
  });

  it("pins the same tesseract.js versions that are installed", () => {
    const read = (pkg: string) => JSON.parse(readFileSync(path.join(process.cwd(), "node_modules", pkg, "package.json"), "utf8")) as { version: string };
    expect(read("tesseract.js").version).toBe(TESSERACT_VERSION);
    expect(read("tesseract.js-core").version).toBe(TESSERACT_CORE_VERSION);
  });

  it("generates unpredictable 128-bit nonces", () => {
    const nonces = new Set(Array.from({ length: 50 }, generateNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(Buffer.from(nonce, "base64")).toHaveLength(16);
  });

  it("switches to Report-Only through CSP_REPORT_ONLY", () => {
    expect(cspReportOnly()).toBe(false);
    expect(cspHeaderName(false)).toBe("Content-Security-Policy");
    process.env.CSP_REPORT_ONLY = "true";
    expect(cspReportOnly()).toBe(true);
    expect(cspHeaderName(true)).toBe("Content-Security-Policy-Report-Only");
    process.env.CSP_REPORT_ONLY = "false";
    expect(cspReportOnly()).toBe(false);
    process.env.CSP_REPORT_ONLY = "maybe";
    expect(() => cspReportOnly()).toThrow(/CSP_REPORT_ONLY/);
  });
});
