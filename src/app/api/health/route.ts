import { NextResponse } from "next/server";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Liveness and readiness probe for load balancers and container health checks. Public by design. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "ok" }, { headers: NO_STORE });
  } catch (error) {
    console.error("[health] database check failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ status: "error", db: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
