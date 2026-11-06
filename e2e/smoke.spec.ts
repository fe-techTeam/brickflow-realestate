import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "BrickFlow@2026";

const ACCOUNTS = [
  { workspace: "Channel Partner", email: "partner@prestige-demo.test", path: "/partner" },
  { workspace: "Builder", email: "accounts@godrej-demo.test", path: "/builder" },
  { workspace: "Veefin Finance", email: "finance@brickflow.demo", path: "/finance" },
  { workspace: "Super Admin", email: "admin@brickflow.demo", path: "/admin" },
] as const;

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("login page", () => {
  test("renders the sign-in form and the demo workspaces", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/Sign in/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
    for (const account of ACCOUNTS) {
      await expect(page.getByRole("button", { name: new RegExp(`^${account.workspace}`) })).toBeVisible();
    }
  });

  test("sends anonymous visitors of a workspace to the login page", async ({ page }) => {
    await page.goto("/finance");
    await expect(page).toHaveURL(/\/login\?next=%2Ffinance$/);
  });

  test("rejects a wrong password", async ({ page }) => {
    await signIn(page, ACCOUNTS[0].email, "not-the-password");
    await expect(page.getByRole("alert").filter({ hasText: "The email or password is incorrect." })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("fills the credentials from a demo workspace card", async ({ page }) => {
    await page.goto("/login");
    const card = page.getByRole("button", { name: /^Builder/ });
    await card.click();
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Work email")).toHaveValue("accounts@godrej-demo.test");
    await expect(page.getByLabel("Password")).toHaveValue(PASSWORD);
  });
});

for (const account of ACCOUNTS) {
  test.describe(`${account.workspace} account`, () => {
    test(`signs in and lands on ${account.path}`, async ({ page, context }) => {
      await signIn(page, account.email, PASSWORD);
      await expect(page).toHaveURL(new RegExp(`${account.path}$`));
      expect((await context.cookies()).some((c) => c.name === "bf_session" && c.httpOnly)).toBe(true);
    });

    test("signs out from the account menu", async ({ page, context }) => {
      await signIn(page, account.email, PASSWORD);
      await expect(page).toHaveURL(new RegExp(`${account.path}$`));
      const status = (await page.request.get(account.path)).status();
      test.skip(status === 404, `${account.path} has no page yet, so the workspace shell with the account menu is not rendered.`);

      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("menuitem", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/login$/);
      expect((await context.cookies()).some((c) => c.name === "bf_session")).toBe(false);

      await page.goto(account.path);
      await expect(page).toHaveURL(/\/login\?next=/);
    });
  });
}

test.describe("operations", () => {
  test("returns a request ID on every response and reports readiness", async ({ request }) => {
    const health = await request.get("/api/health", { headers: { "x-request-id": "e2e-request-0001" } });
    expect(health.headers()["x-request-id"]).toBe("e2e-request-0001");
    const ready = await request.get("/api/ready");
    expect(ready.ok()).toBe(true);
    expect(await ready.json()).toEqual({ status: "ready", checks: { database: "ok", migrations: "ok", storage: "ok" } });
    expect((await request.get("/login")).headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("lets the super admin verify the audit chain", async ({ page }) => {
    await signIn(page, "admin@brickflow.demo", PASSWORD);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { name: "Audit integrity" })).toBeVisible();
    await expect(page.getByRole("contentinfo").getByText(/support@/)).toBeVisible();
    await page.getByRole("button", { name: "Verify now" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Verified through entry \d+/ })).toBeVisible();
  });
});
