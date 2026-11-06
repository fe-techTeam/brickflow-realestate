import { NextResponse, type NextRequest } from "next/server";
import { NOTIFICATION_CATEGORIES } from "@/lib/notifications";
import { escapeHtml } from "@/server/notifications/email/render";
import { unsubscribeEmail } from "@/server/notifications/inbox";
import { verifyUnsubscribeToken } from "@/server/notifications/unsubscribe";

export const dynamic = "force-dynamic";

const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · BrickFlow</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: #1b2532; color: #dbe3eb; font: 15px/1.6 Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 440px; width: 100%; padding: 28px; border: 1px solid rgba(255,255,255,.12); border-top: 3px solid #ffc247; border-radius: 10px; background: #263345; }
  h1 { margin: 0 0 10px; font-size: 20px; font-weight: 600; color: #f5f8fb; }
  p { margin: 0 0 14px; }
  button { padding: 10px 18px; border: 1px solid rgba(255,255,255,.18); border-radius: 8px; background: #f5f8fb; color: #1b2532; font: 600 14px/1 inherit; cursor: pointer; }
  small { color: #aebbc9; }
</style></head><body><main>${body}</main></body></html>`;
  return new NextResponse(html, { status, headers: HEADERS });
}

function params(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  return { userId: sp.get("u") ?? "", category: sp.get("c") ?? "", token: sp.get("t") ?? "" };
}

const invalidLink = () => page("Link not valid", "<h1>This link is not valid</h1><p>Sign in to BrickFlow to manage your notification preferences.</p>", 400);

/** Shows a confirmation; a GET never changes anything, so mail scanners that prefetch links are harmless. */
export async function GET(request: NextRequest) {
  const { userId, category, token } = params(request);
  if (!verifyUnsubscribeToken(userId, category, token)) return invalidLink();
  const label = NOTIFICATION_CATEGORIES[category].label.toLowerCase();
  const action = `/api/notifications/unsubscribe?${request.nextUrl.searchParams.toString()}`;
  return page(
    "Unsubscribe",
    `<h1>Stop ${escapeHtml(label)} emails?</h1>
     <p>You will no longer receive ${escapeHtml(label)} notifications by email. In-app notifications and other categories are not affected.</p>
     <form method="post" action="${escapeHtml(action)}"><button type="submit">Unsubscribe</button></form>
     <p style="margin-top:16px"><small>You can switch them back on at any time from the Notifications page after signing in.</small></p>`,
  );
}

/** Performs the unsubscribe: the confirmation form, or an RFC 8058 one-click POST from the mail client. */
export async function POST(request: NextRequest) {
  const { userId, category, token } = params(request);
  if (!verifyUnsubscribeToken(userId, category, token)) return invalidLink();
  await unsubscribeEmail(userId, category);
  const label = NOTIFICATION_CATEGORIES[category].label.toLowerCase();
  return page("Unsubscribed", `<h1>You are unsubscribed</h1><p>You will no longer receive ${escapeHtml(label)} emails from BrickFlow.</p>`);
}
