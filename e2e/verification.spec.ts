import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "BrickFlow@2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("verification and KYC review", () => {
  test("a seeded channel partner sees a complete verification", async ({ page }) => {
    await signIn(page, "partner@prestige-demo.test");
    await page.goto("/partner/verification");
    await expect(page.getByRole("heading", { name: "Verification", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ready to receive payouts" })).toBeVisible();
    const checklist = page.getByRole("list").filter({ hasText: "GST registration" }).first();
    await expect(checklist.getByText("Verified").first()).toBeVisible();
    await expect(page.getByText("••••9005")).toBeVisible();
    await expect(page.getByText("500100099005")).toHaveCount(0);
  });

  test("an Udyam name mismatch goes to admin review and is approved", async ({ browser }) => {
    const partner = await browser.newPage();
    await signIn(partner, "partner@urbannest-demo.test");
    await partner.goto("/partner/verification");
    const udyamRow = partner.getByRole("listitem").filter({ hasText: "Udyam (MSME) registration" });
    await udyamRow.getByRole("button", { name: "Verify" }).click();
    const dialog = partner.getByRole("dialog");
    await dialog.getByLabel("Udyam registration number").fill("UDYAM-MH-26-0011111");
    await dialog.getByRole("button", { name: "Verify Udyam" }).click();
    await expect(dialog).toBeHidden();
    await expect(udyamRow.getByText("Under review")).toBeVisible();
    await expect(udyamRow.getByText(/below the 80% threshold/)).toBeVisible();

    const admin = await browser.newPage();
    await signIn(admin, "admin@brickflow.demo");
    await admin.goto("/admin/kyc");
    await expect(admin.getByRole("heading", { name: "KYC Review", level: 1 })).toBeVisible();
    const item = admin.getByRole("listitem").filter({ hasText: "UrbanNest Property Advisors" }).filter({ hasText: "Udyam (MSME) registration" });
    await item.getByRole("button", { name: "Approve" }).click();
    const confirm = admin.getByRole("dialog");
    await confirm.getByLabel("Note for the audit log").fill("Trade name matches the Udyam certificate.");
    await confirm.getByRole("button", { name: "Approve" }).click();
    await expect(confirm).toBeHidden();
    await expect(item).toHaveCount(0);

    await partner.reload();
    await expect(partner.getByRole("listitem").filter({ hasText: "Udyam (MSME) registration" }).getByText("Verified").first()).toBeVisible();
  });

  test("validates identifiers in the browser before submitting", async ({ page }) => {
    await signIn(page, "accounts@godrej-demo.test");
    await page.goto("/builder/verification");
    const panRow = page.getByRole("listitem").filter({ hasText: "Confirms the organisation PAN" });
    await panRow.getByRole("button", { name: "Update" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Organisation PAN").fill("12345");
    await dialog.getByRole("button", { name: "Verify PAN" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/10 characters/);
  });
});
