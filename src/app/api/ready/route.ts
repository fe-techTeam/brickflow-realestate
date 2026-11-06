import { NextResponse } from "next/server";
import { readiness } from "@/server/observability/readiness";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Readiness probe: the database answers, every migration bundled with this build is applied and the
 * document store accepts writes. Public by design; reports check states only, never error details.
 */
export async function GET() {
  const report = await readiness();
  return NextResponse.json({ status: report.ready ? "ready" : "not_ready", checks: report.checks }, { status: report.ready ? 200 : 503, headers: NO_STORE });
}
