import type { TestProject } from "vitest/node";
import { prepareDatabase } from "../scripts/prepare-db.mjs";

/** Builds a fresh, migrated and seeded PostgreSQL test database once per test run, using the workers' environment. */
export default async function setup(project: TestProject) {
  const env = project.config.env;
  const databaseUrl = env.DATABASE_URL;
  const storageDir = env.STORAGE_DIR;
  if (typeof databaseUrl !== "string" || typeof storageDir !== "string") {
    throw new Error("DATABASE_URL and STORAGE_DIR must be set in the Vitest config");
  }
  await prepareDatabase({ databaseUrl, storageDir, demoPassword: String(env.DEMO_PASSWORD), quiet: true });
}
