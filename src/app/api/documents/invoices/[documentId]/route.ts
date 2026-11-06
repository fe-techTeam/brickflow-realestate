import { NextResponse, type NextRequest } from "next/server";
import { getActor } from "@/server/auth/session";
import { logger } from "@/server/observability/logger";
import { DomainError } from "@/server/errors";
import { getDocumentForActor } from "@/server/services/invoices";
import { storage } from "@/server/storage";

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const { documentId } = await params;
  try {
    const document = await getDocumentForActor(actor, documentId);
    const bytes = await storage().get(document.storageKey);
    const disposition = request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `${disposition}; filename="${document.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: 404 });
    logger.error("documents.invoice_serve_failed", { err: error });
    return NextResponse.json({ error: "Document unavailable" }, { status: 500 });
  }
}
