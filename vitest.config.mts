import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "src"),
      "server-only": path.join(root, "test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "file:./prisma/test.db",
      STORAGE_DRIVER: "local",
      STORAGE_DIR: path.join(root, "storage", "vitest"),
      DEMO_DATASET: "standard",
      DEMO_PASSWORD: "BrickFlow@2026",
      AUTH_SECRET: "vitest-only-secret-value-that-is-at-least-32-characters",
      APP_URL: "http://localhost:3000",
    },
    // Integration tests share one seeded SQLite database, so test files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
