import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const MAX_BYTES = 16 * 1024;

function field(report: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = report[name];
    if (typeof value === "string" && value) return value.slice(0, 300);
  }
  return undefined;
}

/**
 * Receives browser Content Security Policy violation reports (`report-uri`). Public by design, so
 * input is size-capped and only a few known fields are logged; nothing is stored.
 */
export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) return new NextResponse(null, { status: 413 });
  const text = (await request.text()).slice(0, MAX_BYTES);
  try {
    const parsed: unknown = JSON.parse(text);
    const entries = Array.isArray(parsed) ? parsed.map((r) => (r as { body?: unknown }).body) : [(parsed as { "csp-report"?: unknown })["csp-report"]];
    for (const entry of entries.slice(0, 10)) {
      if (!entry || typeof entry !== "object") continue;
      const report = entry as Record<string, unknown>;
      console.warn(
        "[csp] violation",
        JSON.stringify({
          directive: field(report, "effective-directive", "effectiveDirective", "violated-directive"),
          blocked: field(report, "blocked-uri", "blockedURL"),
          page: field(report, "document-uri", "documentURL"),
          source: field(report, "source-file", "sourceFile"),
          disposition: field(report, "disposition"),
        }),
      );
    }
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  return new NextResponse(null, { status: 204 });
}
