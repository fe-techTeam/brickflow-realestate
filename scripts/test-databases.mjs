/** Database URLs for the automated suites; override with TEST_DATABASE_URL / E2E_DATABASE_URL. */
export const TEST_DATABASE_URLS = {
  test: process.env.TEST_DATABASE_URL ?? "postgresql://brickflow:brickflow@localhost:5432/brickflow_test",
  e2e: process.env.E2E_DATABASE_URL ?? "postgresql://brickflow:brickflow@localhost:5432/brickflow_e2e",
};
