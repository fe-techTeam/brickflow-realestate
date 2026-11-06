import { NextResponse, type NextRequest } from "next/server";
import { CSV_BOM, csvLine } from "@/lib/csv";
import { toDateInputValue } from "@/lib/format";
import { recordAudit } from "@/server/audit";
import { getActor } from "@/server/auth/session";
import { db } from "@/server/db";
import { logger } from "@/server/observability/logger";
import { countAuditLogs, iterateAuditLogs, MAX_AUDIT_EXPORT_ROWS, parseAuditFilters } from "@/server/queries/audit";

export const dynamic = "force-dynamic";

const HEADERS = [
  "Sequence",
  "Recorded at (UTC)",
  "Actor",
  "Actor user ID",
  "Actor role",
  "Organisation",
  "Organisation ID",
  "Action",
  "Record type",
  "Record ID",
  "Summary",
  "Recorded values",
  "Entry hash",
  "Previous entry hash",
];

/** CSV export of the audit log with the same filters as the Audit logs page. Platform administrators only. */
export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (actor.orgType !== "PLATFORM") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const filters = parseAuditFilters(request.nextUrl.searchParams);
  try {
    const total = await countAuditLogs(actor, filters);
    if (total > MAX_AUDIT_EXPORT_ROWS) {
      return NextResponse.json(
        { error: `This export would contain ${total.toLocaleString("en-IN")} entries. Narrow the date range or filters to ${MAX_AUDIT_EXPORT_ROWS.toLocaleString("en-IN")} entries or fewer.` },
        { status: 422 },
      );
    }
    const organisations = new Map((await db.organisation.findMany({ select: { id: true, name: true } })).map((o) => [o.id, o.name]));
    await db.$transaction((tx) =>
      recordAudit(tx, actor, {
        action: "audit.exported",
        entityType: "AuditLog",
        entityId: "export",
        summary: `Exported ${total} audit ${total === 1 ? "entry" : "entries"} to CSV`,
        metadata: { filters, rows: total },
      }),
    );

    const encoder = new TextEncoder();
    const batches = iterateAuditLogs(actor, filters);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${CSV_BOM}${csvLine(HEADERS)}\r\n`));
      },
      async pull(controller) {
        try {
          const next = await batches.next();
          if (next.done) {
            controller.close();
            return;
          }
          const chunk = next.value
            .map((row) =>
              csvLine([
                row.seq.toString(),
                row.createdAt.toISOString(),
                row.actorName,
                row.actorUserId,
                row.actorRole,
                row.actorOrgId ? organisations.get(row.actorOrgId) : null,
                row.actorOrgId,
                row.action,
                row.entityType,
                row.entityId,
                row.summary,
                row.metadata,
                row.hash,
                row.prevHash,
              ]),
            )
            .join("\r\n");
          controller.enqueue(encoder.encode(`${chunk}\r\n`));
        } catch (error) {
          logger.error("audit.export_stream_failed", { err: error });
          controller.error(error);
        }
      },
      async cancel() {
        await batches.return(undefined);
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="brickflow-audit-log-${toDateInputValue(new Date())}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("audit.export_failed", { err: error });
    return NextResponse.json({ error: "Export unavailable" }, { status: 500 });
  }
}
