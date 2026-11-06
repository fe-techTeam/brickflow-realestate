import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/server/auth/token";
import { buildContentSecurityPolicy, cspHeaderName, cspReportOnly, generateNonce } from "@/server/security/csp";

const PROTECTED_PREFIXES = ["/partner", "/builder", "/finance", "/admin", "/api/documents"];

function withContentSecurityPolicy(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
    https: (process.env.APP_URL ?? "").startsWith("https://"),
  });
  const header = cspHeaderName(cspReportOnly());
  // Next.js reads the nonce from the request's CSP header and applies it to its own inline scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(header, policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, policy);
  return response;
}

/**
 * Optimistic gate (unauthenticated workspace requests go to login; the session row is validated
 * server-side on every request) and a per-request nonce-based Content Security Policy for pages.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const claims = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
    if (!claims) {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
      const login = new URL("/login", request.url);
      login.searchParams.set("next", pathname);
      return NextResponse.redirect(login);
    }
  }
  // API routes return JSON, CSV or PDF, never HTML, so they need no document policy.
  if (pathname.startsWith("/api/")) return NextResponse.next();
  return withContentSecurityPolicy(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
