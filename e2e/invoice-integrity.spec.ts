import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "BrickFlow@2026";

async function signIn(page: Page, email: string, landing: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(landing);
}

test.describe("invoice integrity", () => {
  test("the builder must complete the three-way match before approving", async ({ page }) => {
    await signIn(page, "accounts@godrej-demo.test", /\/builder$/);
    await page.goto("/builder/approvals");
    await page.getByRole("link", { name: "UNA/GFH/2026/031" }).first().click();
    await expect(page.getByRole("heading", { name: "Brokerage particulars" })).toBeVisible();

    await page.getByRole("button", { name: "Approve invoice" }).click();
    await expect(page.locator("#match-checklist-error")).toHaveText("Tick every three-way match item to approve.");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    for (const item of ["amount", "unit", "agreement_number", "brokerage"]) await page.locator(`#match-${item}`).click();
    await page.getByRole("button", { name: "Approve invoice" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^Approve/ }).click();

    await expect(page.getByText("Three-way match attested")).toBeVisible();
  });

  test("the platform sees the integrity register and match policies", async ({ page }) => {
    await signIn(page, "admin@brickflow.demo", /\/admin$/);
    await page.goto("/admin/integrity");
    await expect(page.getByRole("heading", { name: "Invoice integrity" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Three-way match policy" })).toBeVisible();
    await expect(page.getByRole("radiogroup").first()).toBeVisible();
  });
});
