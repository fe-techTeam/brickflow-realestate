import type { EmailContent } from "../templates";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailFooter {
  /** Why the recipient is receiving this email. */
  reason: string;
  /** Signed-in page where all preferences can be changed. */
  manageUrl?: string;
  /** Signed, one-click link that switches off email for this category only. */
  unsubscribeUrl?: string;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/** Header values must never carry line breaks (header injection). */
export function singleLine(value: string, max = 250): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);
}

export function absoluteUrl(appUrl: string, path: string): string {
  return new URL(path, appUrl.endsWith("/") ? appUrl : `${appUrl}/`).toString();
}

// Email clients ignore stylesheets, so the palette is inlined. It mirrors the product: slate ink on a
// cool paper ground, one signal-amber rule as the accent, and a night-slate primary button.
const C = {
  ground: "#EEF1F4",
  card: "#FFFFFF",
  ink: "#1C2633",
  soft: "#3C4A5B",
  muted: "#66758A",
  rule: "#DDE3EA",
  signal: "#FFC247",
  button: "#263345",
};

const FONT = "Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Renders structured email content into matching HTML and plain-text bodies. */
export function renderEmail(content: EmailContent, options: { appUrl: string; recipientName?: string | null; footer: EmailFooter; ctaUrl?: string }): RenderedEmail {
  const greeting = options.recipientName ? `Hello ${options.recipientName.split(/\s+/)[0]},` : "Hello,";
  const ctaHref = options.ctaUrl ?? (content.cta ? absoluteUrl(options.appUrl, content.cta.path) : undefined);

  const facts = content.facts
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:9px 0;border-top:1px solid ${C.rule};font:500 12px/1.4 ${FONT};color:${C.muted};text-transform:uppercase;letter-spacing:.06em;width:42%;vertical-align:top">${escapeHtml(label)}</td>
          <td style="padding:9px 0;border-top:1px solid ${C.rule};font:500 14px/1.45 ${FONT};color:${C.ink};vertical-align:top">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");

  const note = content.note
    ? `<div style="margin:22px 0 0;padding:14px 16px;border-left:3px solid ${C.rule};background:${C.ground};border-radius:4px">
         <p style="margin:0 0 4px;font:600 12px/1.4 ${FONT};color:${C.muted};text-transform:uppercase;letter-spacing:.06em">${escapeHtml(content.note.label)}</p>
         <p style="margin:0;font:400 14px/1.55 ${FONT};color:${C.soft};white-space:pre-line">${escapeHtml(content.note.text)}</p>
       </div>`
    : "";

  const cta =
    content.cta && ctaHref
      ? `<p style="margin:28px 0 0"><a href="${escapeHtml(ctaHref)}" style="display:inline-block;padding:12px 22px;border-radius:8px;background:${C.button};color:#FFFFFF;font:600 14px/1 ${FONT};text-decoration:none">${escapeHtml(content.cta.label)}</a></p>`
      : "";

  const footerLinks = [
    options.footer.manageUrl ? `<a href="${escapeHtml(options.footer.manageUrl)}" style="color:${C.muted}">Manage notification preferences</a>` : "",
    options.footer.unsubscribeUrl ? `<a href="${escapeHtml(options.footer.unsubscribeUrl)}" style="color:${C.muted}">Unsubscribe from these emails</a>` : "",
  ]
    .filter(Boolean)
    .join(" &nbsp;·&nbsp; ");

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.ground}">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.intro)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.ground}">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td style="padding:0 4px 14px;font:600 15px/1 ${FONT};color:${C.ink};letter-spacing:.01em">BrickFlow</td></tr>
        <tr><td style="background:${C.card};border:1px solid ${C.rule};border-top:3px solid ${C.signal};border-radius:10px;padding:30px 28px">
          <p style="margin:0 0 6px;font:400 14px/1.5 ${FONT};color:${C.muted}">${escapeHtml(greeting)}</p>
          <h1 style="margin:0 0 12px;font:600 21px/1.3 ${FONT};color:${C.ink}">${escapeHtml(content.heading)}</h1>
          <p style="margin:0 0 20px;font:400 15px/1.6 ${FONT};color:${C.soft}">${escapeHtml(content.intro)}</p>
          ${facts ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${C.rule}">${facts}</table>` : ""}
          ${note}
          ${cta}
        </td></tr>
        <tr><td style="padding:18px 4px 0;font:400 12px/1.6 ${FONT};color:${C.muted}">
          <p style="margin:0">${escapeHtml(options.footer.reason)}</p>
          ${footerLinks ? `<p style="margin:6px 0 0">${footerLinks}</p>` : ""}
          <p style="margin:6px 0 0">BrickFlow · Real Estate Receivables, Made Liquid</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    greeting,
    "",
    content.heading,
    "",
    content.intro,
    "",
    ...content.facts.map(([label, value]) => `${label}: ${value}`),
    ...(content.note ? ["", `${content.note.label}:`, content.note.text] : []),
    ...(content.cta && ctaHref ? ["", `${content.cta.label}: ${ctaHref}`] : []),
    "",
    "--",
    options.footer.reason,
    ...(options.footer.manageUrl ? [`Manage notification preferences: ${options.footer.manageUrl}`] : []),
    ...(options.footer.unsubscribeUrl ? [`Unsubscribe from these emails: ${options.footer.unsubscribeUrl}`] : []),
    "BrickFlow · Real Estate Receivables, Made Liquid",
  ].join("\n");

  return { subject: singleLine(content.subject), html, text };
}
