import { NextResponse, type NextRequest } from "next/server";
import { getActor } from "@/server/auth/session";
import { DomainError } from "@/server/errors";
import { getDocumentForActor } from "@/server/services/invoices";
import { storage } from "@/server/storage";
import { contentDisposition } from "@/server/uploads/content-disposition";

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const { documentId } = await params;
  try {
    const document = await getDocumentForActor(actor, documentId);
    const { body, contentLength } = await storage().getStream(document.storageKey);
    const disposition = request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(disposition, document.fileName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // A `sandbox` directive would stop browsers' built-in PDF viewers; framing is limited to this origin instead.
      "Content-Security-Policy": "frame-ancestors 'self'",
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    if (contentLength !== null) headers["Content-Length"] = String(contentLength);
    return new NextResponse(body, { headers });
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: 404 });
    console.error("[documents] failed to serve invoice document", error);
    return NextResponse.json({ error: "Document unavailable" }, { status: 500 });
  }
}
