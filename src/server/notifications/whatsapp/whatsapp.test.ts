import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createCloudProvider, readWhatsappConfig, WhatsappDeliveryError } from "./providers";
import { extractStatusUpdates, verifySubscription, verifyWebhookSignature } from "./webhook";

const CONFIG = { provider: "cloud" as const, token: "EAAG-test", phoneNumberId: "106540352242922", apiVersion: "v27.0", language: "en", baseUrl: "https://graph.facebook.com" };
const MESSAGE = { to: "+919876543210", template: "brickflow_invoice_approved", language: "en", bodyParams: ["INV-1", "Prestige", "Godrej", "₹5,00,000.00"] };

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("readWhatsappConfig", () => {
  it("defaults to the no-op adapter", () => {
    expect(readWhatsappConfig({})).toMatchObject({ provider: "none", apiVersion: "v27.0", language: "en" });
  });

  it("requires credentials and the app secret for the Cloud API", () => {
    expect(() => readWhatsappConfig({ WHATSAPP_PROVIDER: "cloud" })).toThrow(/WHATSAPP_TOKEN/);
    expect(() => readWhatsappConfig({ WHATSAPP_PROVIDER: "cloud", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "abc" })).toThrow(/PHONE_NUMBER_ID/);
    expect(() => readWhatsappConfig({ WHATSAPP_PROVIDER: "cloud", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1" })).toThrow(/APP_SECRET/);
    expect(readWhatsappConfig({ WHATSAPP_PROVIDER: "cloud", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_APP_SECRET: "s" })).toMatchObject({ provider: "cloud" });
    expect(() => readWhatsappConfig({ WHATSAPP_PROVIDER: "twilio" })).toThrow();
  });
});

describe("Cloud API adapter", () => {
  it("posts a template message and returns the wamid", async () => {
    const fetchMock = respond(200, { messaging_product: "whatsapp", contacts: [{ input: "+919876543210", wa_id: "919876543210" }], messages: [{ id: "wamid.HBgM" }] });
    const result = await createCloudProvider(CONFIG, fetchMock as unknown as typeof fetch).send(MESSAGE);
    expect(result.providerMessageId).toBe("wamid.HBgM");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v27.0/106540352242922/messages");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer EAAG-test");
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+919876543210",
      type: "template",
      template: {
        name: "brickflow_invoice_approved",
        language: { code: "en" },
        components: [{ type: "body", parameters: MESSAGE.bodyParams.map((text) => ({ type: "text", text })) }],
      },
    });
  });

  it("classifies errors as permanent or retryable", async () => {
    const send = (status: number, body: unknown) => createCloudProvider(CONFIG, respond(status, body) as unknown as typeof fetch).send(MESSAGE).catch((e: unknown) => e);

    const invalid = await send(400, { error: { message: "Template name does not exist", code: 132001, error_data: { details: "template not found" } } });
    expect(invalid).toBeInstanceOf(WhatsappDeliveryError);
    expect(invalid).toMatchObject({ permanent: true, code: 132001 });

    expect(await send(400, { error: { message: "Rate limit hit", code: 130429 } })).toMatchObject({ permanent: false });
    expect(await send(500, { error: { message: "Internal" } })).toMatchObject({ permanent: false });
    expect(await send(401, { error: { message: "Session expired", code: 190 } })).toMatchObject({ permanent: false });
    expect(await send(200, { messaging_product: "whatsapp", messages: [] })).toMatchObject({ permanent: false });
  });

  it("treats network failures as retryable", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(createCloudProvider(CONFIG, failing as unknown as typeof fetch).send(MESSAGE)).rejects.toMatchObject({ permanent: false });
  });
});

describe("webhook verification", () => {
  const secret = "app-secret-value";
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const sign = (payload: string, key = secret) => `sha256=${createHmac("sha256", key).update(payload).digest("hex")}`;

  it("accepts only an exact HMAC-SHA256 of the raw body", () => {
    expect(verifyWebhookSignature(body, sign(body), secret)).toBe(true);
    expect(verifyWebhookSignature(new TextEncoder().encode(body), sign(body), secret)).toBe(true);
    expect(verifyWebhookSignature(`${body} `, sign(body), secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, "other"), secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body).replace("sha256=", "sha1="), secret)).toBe(false);
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body), "")).toBe(false);
  });

  it("echoes the challenge only for the configured verify token", () => {
    const params = (token: string) => new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "1158201444" });
    expect(verifySubscription(params("tok"), "tok")).toBe("1158201444");
    expect(verifySubscription(params("nope"), "tok")).toBeNull();
    expect(verifySubscription(params("tok"), "")).toBeNull();
    expect(verifySubscription(new URLSearchParams({ "hub.mode": "unsubscribe", "hub.verify_token": "tok", "hub.challenge": "1" }), "tok")).toBeNull();
  });

  it("extracts status updates from message webhooks only", () => {
    const updates = extractStatusUpdates({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            { field: "messages", value: { statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1762400000", recipient_id: "919876543210" }] } },
            { field: "message_template_status_update", value: { statuses: [{ id: "x", status: "sent" }] } },
          ],
        },
      ],
    });
    expect(updates).toEqual([{ id: "wamid.1", status: "delivered", timestamp: "1762400000", recipient_id: "919876543210" }]);
    expect(extractStatusUpdates({ object: "page", entry: [] })).toEqual([]);
    expect(extractStatusUpdates(null)).toEqual([]);
  });
});
