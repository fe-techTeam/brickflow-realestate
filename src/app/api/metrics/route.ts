import { NextResponse, type NextRequest } from "next/server";
import { metricsAccess, renderMetrics } from "@/server/observability/metrics-endpoint";

export const dynamic = "force-dynamic";

/** Prometheus scrape endpoint, protected by `Authorization: Bearer $METRICS_TOKEN`; 404 when not configured. */
export async function GET(request: NextRequest) {
  const access = metricsAccess(request.headers.get("authorization"));
  if (access === "disabled") return new NextResponse("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (access === "unauthorised") {
    return new NextResponse("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store", "WWW-Authenticate": 'Bearer realm="metrics"' } });
  }
  return new NextResponse(await renderMetrics(), {
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" },
  });
}
