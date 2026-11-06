import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "BrickFlow@2026";

async function signIn(page: Page, email: string, path: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Sign-in hashes the password; allow for a busy CI runner.
  await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 30_000 });
}

test.describe("notifications", () => {
  test("the bell shows unread notifications and links to the full list", async ({ page }) => {
    await signIn(page, "finance@brickflow.demo", "/finance");
    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toBeVisible();
    await expect(bell).toHaveAccessibleName(/unread/);
    await bell.click();
    await expect(page.getByRole("menu").getByText(/New financing request/).first()).toBeVisible();
    await page.getByRole("link", { name: "View all notifications" }).click();
    await expect(page).toHaveURL(/\/finance\/notifications$/);
    await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
  });

  test("mark all as read clears the unread count", async ({ page }) => {
    await signIn(page, "partner@urbannest-demo.test", "/partner");
    await page.goto("/partner/notifications");
    const markAll = page.getByRole("button", { name: "Mark all as read" });
    await expect(markAll).toBeEnabled();
    await markAll.click();
    await expect(page.getByText(/notifications? marked as read/)).toBeVisible();
    await expect(markAll).toBeDisabled();
    await page.goto("/partner");
    await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  });

  test("preferences can be saved", async ({ page }) => {
    await signIn(page, "accounts@godrej-demo.test", "/builder");
    await page.goto("/builder/notifications#preferences");
    const email = page.getByRole("checkbox", { name: "Email notifications for Settlements" });
    const wasChecked = (await email.getAttribute("aria-checked")) === "true";
    await email.click();
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText("Notification preferences saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Email notifications for Settlements" })).toHaveAttribute("aria-checked", wasChecked ? "false" : "true");
  });
});

test.describe("admin jobs", () => {
  test("shows queue health, schedules and the delivery log", async ({ page }) => {
    await signIn(page, "admin@brickflow.demo", "/admin");
    await page.getByRole("link", { name: "Jobs" }).first().click();
    await expect(page).toHaveURL(/\/admin\/jobs$/);
    await expect(page.getByRole("heading", { name: "Jobs", level: 1 })).toBeVisible();
    await expect(page.getByText("Ready to run")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Schedules" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Email and WhatsApp deliveries" })).toBeVisible();
  });
});
