import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "BrickFlow@2026";
// A partner account the smoke tests do not use, so enrolling it does not affect them.
const PARTNER = "partner@urbannest-demo.test";

function totp(base32: string, offsetSteps = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of base32.replace(/\s/g, "")) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offsetSteps));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[19]! & 15;
  const code = ((digest[offset]! & 127) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

/** Records Content Security Policy violations reported by the page. */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
  const fromConsole: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) fromConsole.push(m.text());
  });
  return async () => [...fromConsole, ...(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []))];
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("content security policy", () => {
  test("sends a nonce-based policy and the pages load without violations", async ({ page }) => {
    const violations = await watchCsp(page);
    const response = await page.goto("/login");
    const policy = response?.headers()["content-security-policy"] ?? response?.headers()["content-security-policy-report-only"];
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).not.toContain("'unsafe-eval'");

    await signIn(page, "partner@prestige-demo.test");
    await expect(page).toHaveURL(/\/partner$/);
    for (const path of ["/partner", "/partner/invoices", "/partner/invoices/new", "/partner/security"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    expect(await violations()).toEqual([]);
  });
});

test.describe("sign-in protection", () => {
  test("gives the same generic message for unknown accounts and then throttles", async ({ page }) => {
    const ghost = `nobody.${randomUUID().slice(0, 8)}@example.com`;
    await signIn(page, ghost, "wrong-password");
    await expect(page.getByRole("alert").filter({ hasText: "The email or password is incorrect." })).toBeVisible();

    // Keep submitting: the progressive delays and then the lockout must stop the guesses.
    const throttled = page.getByRole("alert").filter({ hasText: "Too many attempts" });
    for (let attempt = 0; attempt < 8 && !(await throttled.isVisible()); attempt += 1) {
      await page.getByLabel("Password").fill(`wrong-password-${attempt}`);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
    }
    await expect(throttled).toBeVisible();
  });
});

test.describe("security page", () => {
  test.describe.configure({ mode: "serial" });

  test("is in the account menu of every workspace", async ({ page }) => {
    await signIn(page, "accounts@godrej-demo.test");
    await expect(page).toHaveURL(/\/builder$/);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Security" }).click();
    await expect(page).toHaveURL(/\/builder\/security$/);
    await expect(page.getByRole("heading", { name: "Security", level: 1 })).toBeVisible();
    await expect(page.getByText("This device")).toBeVisible();
  });

  test("sets up two-step verification, then requires a code at sign-in", async ({ page, context }) => {
    await signIn(page, PARTNER);
    await expect(page).toHaveURL(/\/partner$/);
    await page.goto("/partner/security");
    await page.getByRole("button", { name: "Set up" }).click();
    const key = (await page.locator("code").first().innerText()).replace(/\s/g, "");
    expect(key).toMatch(/^[A-Z2-7]{32}$/);
    await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();

    await page.getByLabel("Enter the 6-digit code shown in the app").fill("000000");
    await page.getByRole("button", { name: "Verify and turn on" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "not valid" })).toBeVisible();

    await page.getByLabel("Enter the 6-digit code shown in the app").fill(totp(key));
    await page.getByRole("button", { name: "Verify and turn on" }).click();
    await expect(page.getByText("Save your recovery codes")).toBeVisible();
    const recoveryCodes = await page.getByRole("list", { name: "Recovery codes" }).locator("li span.select-all").allInnerTexts();
    expect(recoveryCodes).toHaveLength(10);
    await page.getByRole("button", { name: "I have saved my codes" }).click();
    await expect(page.getByText("Active since")).toBeVisible();

    // Generating new recovery codes asks for a fresh code first (step-up). The enrolment code's
    // time step is already used, so wait for the next one.
    await page.getByRole("button", { name: "New codes" }).click();
    await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeVisible();
    await page.waitForTimeout(31_000);
    await page.getByLabel("Authenticator code").fill(totp(key));
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("heading", { name: "Your new recovery codes" })).toBeVisible();
    const newCodes = await page.getByRole("list", { name: "Recovery codes" }).locator("li span.select-all").allInnerTexts();
    expect(newCodes).toHaveLength(10);
    await page.getByRole("button", { name: "Done" }).click();

    // Sign out and back in: the password alone is no longer enough.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, PARTNER);
    await expect(page).toHaveURL(/\/login\/verify$/);
    expect((await context.cookies()).some((c) => c.name === "bf_session")).toBe(false);
    await page.goto("/partner");
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/login/verify");
    await page.getByRole("button", { name: /Use a recovery code/ }).click();
    await page.getByLabel("Recovery code").fill(recoveryCodes[0]!);
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "not valid" })).toBeVisible();

    await page.getByLabel("Recovery code").fill(newCodes[0]!);
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(page).toHaveURL(/\/partner$/);
    expect((await context.cookies()).some((c) => c.name === "bf_session" && c.httpOnly)).toBe(true);
  });
});
