import { NextResponse, type NextRequest } from "next/server";

export const REQUEST_ID_HEADER = "x-request-id";

// Accept IDs from a trusted edge (e.g. the reverse proxy) only when they are short and log-safe.
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Returns the incoming request ID when it is well-formed, otherwise a fresh UUID. */
export function resolveRequestId(incoming: string | null | undefined): string {
  const candidate = incoming?.trim();
  return candidate && VALID_REQUEST_ID.test(candidate) ? candidate : crypto.randomUUID();
}

/**
 * Proxy helper: makes sure the request carries a valid `x-request-id` for downstream handlers and returns
 * the ID together with a `next()` response that forwards it. Call `tagResponse` on any other response
 * the proxy returns (redirects, 401s) so clients always see the ID.
 */
export function withRequestId(request: NextRequest): { requestId: string; next: () => NextResponse } {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    return tagResponse(NextResponse.next({ request: { headers } }), requestId);
  };
  return { requestId, next };
}

export function tagResponse<T extends Response>(response: T, requestId: string): T {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}
