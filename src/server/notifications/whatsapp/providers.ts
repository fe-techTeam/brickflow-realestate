export interface WhatsappTemplateMessage {
  /** E.164 number including the leading "+". */
  to: string;
  template: string;
  language: string;
  bodyParams: string[];
}

export interface WhatsappSendResult {
  providerMessageId: string;
}

export interface WhatsappProvider {
  readonly name: "cloud" | "none";
  /** False for the no-op adapter: deliveries are recorded as skipped instead of sent. */
  readonly enabled: boolean;
  send(message: WhatsappTemplateMessage): Promise<WhatsappSendResult>;
}

export class WhatsappDeliveryError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
    readonly code?: number,
  ) {
    super(message);
    this.name = "WhatsappDeliveryError";
  }
}

export interface WhatsappConfig {
  provider: "cloud" | "none";
  token?: string;
  phoneNumberId?: string;
  apiVersion: string;
  language: string;
  baseUrl: string;
}

export function readWhatsappConfig(env: Readonly<Record<string, string | undefined>> = process.env): WhatsappConfig {
  const provider = (env.WHATSAPP_PROVIDER?.trim().toLowerCase() || "none") as WhatsappConfig["provider"];
  if (provider !== "cloud" && provider !== "none") throw new Error(`WHATSAPP_PROVIDER must be "cloud" or "none", got "${provider}"`);
  const apiVersion = env.WHATSAPP_API_VERSION?.trim() || "v27.0";
  if (!/^v\d+\.\d+$/.test(apiVersion)) throw new Error("WHATSAPP_API_VERSION must look like v27.0");
  const language = env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en";
  const config: WhatsappConfig = { provider, apiVersion, language, baseUrl: "https://graph.facebook.com" };
  if (provider === "cloud") {
    const token = env.WHATSAPP_TOKEN?.trim();
    const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    if (!token) throw new Error("WHATSAPP_TOKEN is required when WHATSAPP_PROVIDER=cloud");
    if (!phoneNumberId || !/^\d+$/.test(phoneNumberId)) throw new Error("WHATSAPP_PHONE_NUMBER_ID (numeric) is required when WHATSAPP_PROVIDER=cloud");
    if (!env.WHATSAPP_APP_SECRET?.trim()) throw new Error("WHATSAPP_APP_SECRET is required when WHATSAPP_PROVIDER=cloud (delivery status webhooks are verified with it)");
    config.token = token;
    config.phoneNumberId = phoneNumberId;
  }
  return config;
}

interface GraphError {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; error_data?: { details?: string }; fbtrace_id?: string };
}

interface GraphSendResponse {
  messaging_product?: string;
  contacts?: { input?: string; wa_id?: string }[];
  messages?: { id?: string; message_status?: string }[];
}

// Throttling, temporary unavailability and expired or rotated credentials are worth retrying;
// other client errors (bad number, unknown template, policy) will fail the same way again.
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 190, 613, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);

/** Meta WhatsApp Cloud API: approved template messages via POST /{phone-number-id}/messages. */
export function createCloudProvider(config: WhatsappConfig, fetchImpl: typeof fetch = fetch): WhatsappProvider {
  const url = `${config.baseUrl}/${config.apiVersion}/${config.phoneNumberId}/messages`;
  return {
    name: "cloud",
    enabled: true,
    async send(message) {
      const body = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: message.to,
        type: "template",
        template: {
          name: message.template,
          language: { code: message.language },
          components: [{ type: "body", parameters: message.bodyParams.map((text) => ({ type: "text", text: text.slice(0, 1024) })) }],
        },
      };
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        throw new WhatsappDeliveryError(`WhatsApp request failed: ${error instanceof Error ? error.message : String(error)}`, false);
      }
      const json = (await response.json().catch(() => ({}))) as GraphSendResponse & GraphError;
      if (!response.ok || json.error) {
        const code = json.error?.code;
        const retryable = response.status >= 500 || response.status === 429 || response.status === 401 || (code !== undefined && RETRYABLE_CODES.has(code));
        const detail = json.error?.error_data?.details ?? json.error?.message ?? `HTTP ${response.status}`;
        throw new WhatsappDeliveryError(`WhatsApp error${code !== undefined ? ` ${code}` : ""}: ${detail}`, !retryable, code);
      }
      const id = json.messages?.[0]?.id;
      if (!id) throw new WhatsappDeliveryError("WhatsApp response did not include a message id", false);
      return { providerMessageId: id };
    },
  };
}

export const noopWhatsappProvider: WhatsappProvider = {
  name: "none",
  enabled: false,
  async send() {
    throw new WhatsappDeliveryError("WhatsApp delivery is not configured", true);
  },
};

let cached: WhatsappProvider | null = null;

export function getWhatsappProvider(): WhatsappProvider {
  if (cached) return cached;
  const config = readWhatsappConfig();
  cached = config.provider === "cloud" ? createCloudProvider(config) : noopWhatsappProvider;
  return cached;
}

export function getWhatsappLanguage(): string {
  return readWhatsappConfig().language;
}

/** Test hook: replaces the provider (pass null to rebuild from the environment). */
export function setWhatsappProvider(provider: WhatsappProvider | null): void {
  cached = provider;
}
