import { defineConfig, devices } from "@playwright/test";
import { TEST_DATABASE_URLS } from "./scripts/test-databases.mjs";

const PORT = 3300;
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL ?? `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

const demoPassword = process.env.E2E_DEMO_PASSWORD ?? "BrickFlow@2026";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI ? [["list"], ["html", { open: "never" }], ["github"]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Against an external deployment (PLAYWRIGHT_BASE_URL) no local server is started.
  webServer: externalBaseURL
    ? undefined
    : {
        command: `npm run test:e2e:prepare && npm run build && npm run start -- --port ${PORT}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !isCI,
        timeout: 600_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          DATABASE_URL: TEST_DATABASE_URLS.e2e,
          STORAGE_DRIVER: "local",
          STORAGE_DIR: "./storage/e2e",
          DEMO_PASSWORD: demoPassword,
          DEMO_DATASET: "standard",
          AUTH_SECRET: "playwright-e2e-only-secret-value-of-at-least-32-chars",
          // Seed and server must share the audit key; this one exists only for the disposable e2e database.
          AUDIT_HMAC_KEY: process.env.AUDIT_HMAC_KEY ?? Buffer.from("playwright-e2e-only-audit-hmac-key-0123456789").toString("base64"),
          AUDIT_HMAC_KEY_ID: "e2e",
          APP_URL: baseURL,
          NEXT_TELEMETRY_DISABLED: "1",
        },
      },
});
