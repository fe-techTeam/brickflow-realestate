import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Stable Message-ID (without angle brackets) so a resend after a crash is recognisable downstream. */
  messageId: string;
  headers?: Record<string, string>;
}

export interface EmailSendResult {
  providerMessageId: string;
}

export interface EmailProvider {
  readonly name: "smtp" | "log";
  send(message: EmailMessage): Promise<EmailSendResult>;
  close(): void;
}

/** Delivery failure; `permanent` failures (bad recipient, rejected message) are not retried. */
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

export interface EmailConfig {
  provider: "smtp" | "log";
  from: string;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    requireTLS: boolean;
    user?: string;
    password?: string;
    maxConnections: number;
    rateLimitPerSecond?: number;
  };
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (/^(1|true|yes)$/i.test(value)) return true;
  if (/^(0|false|no)$/i.test(value)) return false;
  throw new Error(`Expected true or false, got "${value}"`);
}

/**
 * Reads and validates email settings. Production must name a provider explicitly, and the log
 * provider (which sends nothing) is refused there unless EMAIL_ALLOW_LOG_IN_PRODUCTION=true.
 */
export function readEmailConfig(env: Readonly<Record<string, string | undefined>> = process.env): EmailConfig {
  const production = env.NODE_ENV === "production";
  const raw = env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (!raw && production) throw new Error("EMAIL_PROVIDER is not set. Use EMAIL_PROVIDER=smtp (or log with EMAIL_ALLOW_LOG_IN_PRODUCTION=true).");
  const provider = raw || "log";
  if (provider !== "smtp" && provider !== "log") throw new Error(`EMAIL_PROVIDER must be "smtp" or "log", got "${provider}"`);

  const from = env.SMTP_FROM?.trim() || (provider === "log" ? "BrickFlow <no-reply@localhost>" : "");
  if (!from) throw new Error("SMTP_FROM is required, e.g. SMTP_FROM=\"BrickFlow <no-reply@example.com>\"");
  if (/[\r\n]/.test(from)) throw new Error("SMTP_FROM must be a single line");

  if (provider === "log") {
    if (production && !flag(env.EMAIL_ALLOW_LOG_IN_PRODUCTION, false)) {
      throw new Error("EMAIL_PROVIDER=log sends no email and is refused in production. Configure SMTP, or set EMAIL_ALLOW_LOG_IN_PRODUCTION=true for a demo environment.");
    }
    return { provider, from };
  }

  const host = env.SMTP_HOST?.trim();
  if (!host) throw new Error("SMTP_HOST is required when EMAIL_PROVIDER=smtp");
  const port = Number(env.SMTP_PORT?.trim() || "587");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT must be a valid port number");
  const user = env.SMTP_USER?.trim() || undefined;
  const password = env.SMTP_PASSWORD || undefined;
  if (Boolean(user) !== Boolean(password)) throw new Error("Set both SMTP_USER and SMTP_PASSWORD, or neither");
  const secure = flag(env.SMTP_SECURE, port === 465);
  const rate = env.SMTP_RATE_LIMIT_PER_SECOND?.trim();
  const rateLimitPerSecond = rate ? Number(rate) : undefined;
  if (rateLimitPerSecond !== undefined && (!Number.isInteger(rateLimitPerSecond) || rateLimitPerSecond < 1)) {
    throw new Error("SMTP_RATE_LIMIT_PER_SECOND must be a positive integer");
  }
  return {
    provider,
    from,
    smtp: {
      host,
      port,
      secure,
      // Without implicit TLS, STARTTLS is mandatory unless explicitly disabled for a local relay.
      requireTLS: secure ? false : flag(env.SMTP_REQUIRE_TLS, true),
      user,
      password,
      maxConnections: 2,
      rateLimitPerSecond,
    },
  };
}

interface SmtpErrorShape {
  message?: string;
  code?: string;
  responseCode?: number;
  permanent?: boolean;
}

/** SMTP adapter. Works with Amazon SES SMTP endpoints and any authenticated relay. */
export function createSmtpProvider(config: EmailConfig): EmailProvider {
  const smtp = config.smtp;
  if (!smtp) throw new Error("SMTP settings are missing");
  const transport = nodemailer.createTransport({
    pool: true,
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: smtp.requireTLS,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password! } : undefined,
    maxConnections: smtp.maxConnections,
    ...(smtp.rateLimitPerSecond ? { rateLimit: smtp.rateLimitPerSecond, rateDelta: 1000 } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    name: "smtp",
    async send(message) {
      try {
        const info = await transport.sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          messageId: `<${message.messageId}>`,
          headers: message.headers,
        });
        const serverId = (info as { serverMessageId?: string }).serverMessageId;
        return { providerMessageId: serverId || info.messageId || message.messageId };
      } catch (error) {
        const e = (error ?? {}) as SmtpErrorShape;
        const permanent = e.permanent === true || (typeof e.responseCode === "number" && e.responseCode >= 500 && e.responseCode < 600) || e.code === "EENVELOPE";
        throw new EmailDeliveryError(`SMTP ${e.code ?? "error"}${e.responseCode ? ` ${e.responseCode}` : ""}: ${e.message ?? String(error)}`, permanent);
      }
    },
    close() {
      transport.close();
    },
  };
}

/** Development adapter: writes the email to the log instead of sending it. */
export function createLogProvider(env: Readonly<Record<string, string | undefined>> = process.env): EmailProvider {
  const production = env.NODE_ENV === "production";
  return {
    name: "log",
    async send(message) {
      const id = `log-${randomUUID()}`;
      // Bodies can carry one-time links, so production logs record only the envelope.
      const entry = production
        ? { component: "email", provider: "log", id, to: message.to, subject: message.subject }
        : { component: "email", provider: "log", id, to: message.to, subject: message.subject, text: message.text };
      console.log(JSON.stringify(entry));
      return { providerMessageId: id };
    },
    close() {},
  };
}

let cached: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  const config = readEmailConfig();
  if (config.provider === "log" && process.env.NODE_ENV === "production") {
    console.warn(JSON.stringify({ level: "warn", component: "email", message: "EMAIL_PROVIDER=log in production: emails are written to the log and NOT delivered" }));
  }
  cached = config.provider === "smtp" ? createSmtpProvider(config) : createLogProvider();
  return cached;
}

export function getEmailFrom(): string {
  return readEmailConfig().from;
}

/** Test hook: replaces the provider (pass null to rebuild from the environment). */
export function setEmailProvider(provider: EmailProvider | null): void {
  cached?.close();
  cached = provider;
}
