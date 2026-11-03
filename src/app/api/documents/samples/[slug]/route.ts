import { NextResponse, type NextRequest } from "next/server";
import { buildInvoiceDocument, demoClock, resolveDemoDataset } from "@/lib/demo/catalogue";
import { renderBrokerageInvoicePdf } from "@/lib/pdf/brokerage-invoice";
import { getActor } from "@/server/auth/session";

/** Renders one of the fictional sample brokerage invoices on demand for any signed-in user. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const { slug } = await params;
  const dataset = resolveDemoDataset();
  const sample = dataset.samples(demoClock()).find((s) => s.slug === slug);
  if (!sample) return NextResponse.json({ error: "Sample document not found" }, { status: 404 });

  try {
    const bytes = await renderBrokerageInvoicePdf(buildInvoiceDocument(sample, dataset));
    const disposition = request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    const fileName = `${sample.invoiceNumber.replace(/[^A-Za-z0-9.-]+/g, "-")}-sample.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `${disposition}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[documents] failed to render sample invoice", error);
    return NextResponse.json({ error: "Document unavailable" }, { status: 500 });
  }
}
