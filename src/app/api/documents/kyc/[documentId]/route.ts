import { NextResponse, type NextRequest } from "next/server";
import { getActor } from "@/server/auth/session";
import { DomainError } from "@/server/errors";
import { getKycDocumentForActor } from "@/server/services/kyc";
import { storage } from "@/server/storage";

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const { documentId } = await params;
  try {
    const document = await getKycDocumentForActor(actor, documentId);
    const bytes = await storage().get(document.storageKey);
    const disposition = request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": document.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `${disposition}; filename="${document.fileName.replace(/["\\\r\n]/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: 404 });
    console.error("[documents] failed to serve KYC document", error);
    return NextResponse.json({ error: "Document unavailable" }, { status: 500 });
  }
}
