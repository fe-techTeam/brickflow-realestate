import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/server/auth/token";
import { tagResponse, withRequestId } from "@/server/observability/request-id";

const PROTECTED_PREFIXES = ["/partner", "/builder", "/finance", "/admin", "/api/documents"];

/** Optimistic gate: unauthenticated requests to workspaces go to login. Authorisation is enforced server-side. */
export async function proxy(request: NextRequest) {
  const { requestId, next } = withRequestId(request);
  const { pathname } = request.nextUrl;
  if (!PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return next();

  const claims = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (claims) return next();

  if (pathname.startsWith("/api/")) return tagResponse(NextResponse.json({ error: "Unauthenticated" }, { status: 401 }), requestId);
  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  return tagResponse(NextResponse.redirect(login), requestId);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
