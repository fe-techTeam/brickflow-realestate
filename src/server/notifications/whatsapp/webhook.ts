import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NotificationDeliveryStatus } from "@/generated/prisma/client";
import { db } from "../../db";

/** Constant-time check of `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>`. */
export function verifyWebhookSignature(rawBody: string | Uint8Array, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(match[1]!, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function verifySubscription(params: URLSearchParams, verifyToken: string): string | null {
  if (!verifyToken) return null;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge");
  if (mode !== "subscribe" || !challenge || !/^[A-Za-z0-9_-]{1,200}$/.test(challenge)) return null;
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  return a.length === b.length && timingSafeEqual(a, b) ? challenge : null;
}

export interface WhatsappStatusUpdate {
  id: string;
  status: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}

interface WebhookPayload {
  object?: string;
  entry?: { id?: string; changes?: { field?: string; value?: { statuses?: WhatsappStatusUpdate[] } }[] }[];
}

export function extractStatusUpdates(payload: unknown): WhatsappStatusUpdate[] {
  const body = payload as WebhookPayload;
  if (body?.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) return [];
  const updates: WhatsappStatusUpdate[] = [];
  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      for (const status of change.value?.statuses ?? []) {
        if (typeof status?.id === "string" && typeof status.status === "string") updates.push(status);
      }
    }
  }
  return updates;
}

// Callbacks can arrive out of order, so a status only ever moves forward.
const FORWARD_FROM: Record<"SENT" | "DELIVERED" | "READ" | "FAILED", NotificationDeliveryStatus[]> = {
  SENT: ["QUEUED"],
  DELIVERED: ["QUEUED", "SENT"],
  READ: ["QUEUED", "SENT", "DELIVERED"],
  FAILED: ["QUEUED", "SENT"],
};

function mapStatus(status: string): keyof typeof FORWARD_FROM | null {
  switch (status) {
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "read":
    case "played":
      return "READ";
    case "failed":
      return "FAILED";
    default:
      return null;
  }
}

/** Applies delivery status callbacks to the delivery log. Returns the number of rows changed. */
export async function applyStatusUpdates(updates: WhatsappStatusUpdate[]): Promise<number> {
  let changed = 0;
  for (const update of updates) {
    const next = mapStatus(update.status);
    if (!next) continue;
    const seconds = Number(update.timestamp);
    const at = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
    const error = update.errors?.[0];
    const result = await db.notificationDelivery.updateMany({
      where: { channel: "WHATSAPP", providerMessageId: update.id, status: { in: FORWARD_FROM[next] } },
      data: {
        status: next,
        ...(next === "DELIVERED" ? { deliveredAt: at } : {}),
        ...(next === "READ" ? { readAt: at } : {}),
        ...(next === "FAILED"
          ? { error: `WhatsApp ${error?.code ?? ""} ${error?.error_data?.details ?? error?.message ?? error?.title ?? "delivery failed"}`.trim().slice(0, 1000) }
          : {}),
      },
    });
    changed += result.count;
  }
  return changed;
}
