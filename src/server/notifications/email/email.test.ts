import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogProvider, readEmailConfig } from "./providers";
import { escapeHtml, renderEmail, singleLine } from "./render";
import { assertSameOrigin, TRANSACTIONAL_TEMPLATES } from "./transactional";

describe("readEmailConfig", () => {
  it("defaults to the log provider outside production", () => {
    expect(readEmailConfig({ NODE_ENV: "development" })).toMatchObject({ provider: "log" });
  });

  it("requires an explicit provider in production", () => {
    expect(() => readEmailConfig({ NODE_ENV: "production" })).toThrow(/EMAIL_PROVIDER is not set/);
  });

  it("refuses the log provider in production unless explicitly allowed", () => {
    expect(() => readEmailConfig({ NODE_ENV: "production", EMAIL_PROVIDER: "log" })).toThrow(/refused in production/);
    expect(() => readEmailConfig({ NODE_ENV: "production", EMAIL_PROVIDER: "log", EMAIL_ALLOW_LOG_IN_PRODUCTION: "yes-please" })).toThrow(/true or false/);
    expect(readEmailConfig({ NODE_ENV: "production", EMAIL_PROVIDER: "log", EMAIL_ALLOW_LOG_IN_PRODUCTION: "true" })).toMatchObject({ provider: "log" });
  });

  it("validates SMTP settings", () => {
    const base = { NODE_ENV: "production", EMAIL_PROVIDER: "smtp", SMTP_FROM: "BrickFlow <no-reply@example.com>" };
    expect(() => readEmailConfig({ ...base })).toThrow(/SMTP_HOST/);
    expect(() => readEmailConfig({ ...base, SMTP_HOST: "email-smtp.ap-south-1.amazonaws.com", SMTP_USER: "AKIA" })).toThrow(/both SMTP_USER and SMTP_PASSWORD/);
    expect(() => readEmailConfig({ ...base, SMTP_HOST: "h", SMTP_PORT: "99999" })).toThrow(/SMTP_PORT/);
    expect(() => readEmailConfig({ ...base, SMTP_HOST: "h", SMTP_FROM: "a\r\nBcc: x@y" })).toThrow(/single line/);
    expect(() => readEmailConfig({ NODE_ENV: "production", EMAIL_PROVIDER: "sendgrid" })).toThrow(/must be "smtp" or "log"/);
  });

  it("requires STARTTLS on port 587 and implicit TLS on 465 by default", () => {
    const base = { EMAIL_PROVIDER: "smtp", SMTP_FROM: "a@b.c", SMTP_HOST: "smtp.example.com", SMTP_USER: "u", SMTP_PASSWORD: "p" };
    expect(readEmailConfig(base).smtp).toMatchObject({ port: 587, secure: false, requireTLS: true });
    expect(readEmailConfig({ ...base, SMTP_PORT: "465" }).smtp).toMatchObject({ port: 465, secure: true, requireTLS: false });
    expect(readEmailConfig({ ...base, SMTP_PORT: "25", SMTP_REQUIRE_TLS: "false" }).smtp).toMatchObject({ requireTLS: false });
  });
});

describe("log provider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs the body in development but only the envelope in production", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const message = { to: "a@b.c", subject: "S", html: "<p>secret-link</p>", text: "secret-link", messageId: "m@x" };
    await createLogProvider({ NODE_ENV: "development" }).send(message);
    await createLogProvider({ NODE_ENV: "production" }).send(message);
    expect(String(log.mock.calls[0]![0])).toContain("secret-link");
    expect(String(log.mock.calls[1]![0])).not.toContain("secret-link");
  });
});

describe("renderEmail", () => {
  it("escapes every interpolated value and renders a matching text part", () => {
    const email = renderEmail(
      {
        subject: "Invoice <b>1</b>\r\nBcc: evil@example.com",
        heading: "Hi <script>",
        intro: "A & B",
        facts: [["Builder", `"Skyline" <Homes>`]],
        note: { label: "Reason", text: "<img src=x onerror=alert(1)>" },
        cta: { label: "Open", path: "/partner/invoices/abc" },
      },
      { appUrl: "https://app.example.com", recipientName: "Asha Rao", footer: { reason: "Why", unsubscribeUrl: "https://app.example.com/u?a=1&b=2" } },
    );
    expect(email.subject).toBe("Invoice <b>1</b> Bcc: evil@example.com");
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&quot;Skyline&quot; &lt;Homes&gt;");
    expect(email.html).toContain('href="https://app.example.com/partner/invoices/abc"');
    expect(email.html).toContain("https://app.example.com/u?a=1&amp;b=2");
    expect(email.text).toContain("Hello Asha,");
    expect(email.text).toContain("Builder: \"Skyline\" <Homes>");
    expect(email.text).toContain("Open: https://app.example.com/partner/invoices/abc");
    expect(email.text).toContain("Unsubscribe from these emails: https://app.example.com/u?a=1&b=2");
  });

  it("helpers", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    expect(singleLine("a\r\n\tb   c")).toBe("a b c");
  });
});

describe("password-reset template", () => {
  it("validates its data and renders the reset link", () => {
    const t = TRANSACTIONAL_TEMPLATES["password-reset"];
    expect(t.schema.safeParse({ resetUrl: "javascript:alert(1)", expiresInMinutes: 30 }).success).toBe(false);
    const data = t.schema.parse({ name: "Asha", resetUrl: "https://app.example.com/reset?token=abc", expiresInMinutes: 30 });
    const { content, ctaUrl } = t.render(data);
    expect(ctaUrl).toBe("https://app.example.com/reset?token=abc");
    expect(content.intro).toContain("30 minutes");
    expect(t.sensitive).toContain("resetUrl");
  });

  it("only accepts links on the APP_URL origin", () => {
    expect(() => assertSameOrigin("https://app.example.com/reset", "https://app.example.com")).not.toThrow();
    expect(() => assertSameOrigin("https://evil.example.com/reset", "https://app.example.com")).toThrow(/APP_URL origin/);
  });
});
