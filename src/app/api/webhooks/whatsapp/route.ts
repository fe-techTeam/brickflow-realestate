import { NextResponse, type NextRequest } from "next/server";
import { applyStatusUpdates, extractStatusUpdates, verifySubscription, verifyWebhookSignature } from "@/server/notifications/whatsapp/webhook";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;

/** Webhook subscription handshake from Meta: echo `hub.challenge` when the verify token matches. */
export async function GET(request: NextRequest) {
  const challenge = verifySubscription(request.nextUrl.searchParams, process.env.WHATSAPP_VERIFY_TOKEN?.trim() ?? "");
  if (!challenge) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

/** Delivery status callbacks (sent, delivered, read, failed). Rejected unless signed with the app secret. */
export async function POST(request: NextRequest) {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  if (!verifyWebhookSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const updated = await applyStatusUpdates(extractStatusUpdates(payload));
    return NextResponse.json({ received: true, updated });
  } catch (error) {
    // A 5xx makes Meta retry the callback later.
    console.error("[whatsapp-webhook] failed to apply status updates", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Temporarily unavailable" }, { status: 503 });
  }
}
