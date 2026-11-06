/**
 * Scans the database for financing invariant violations and exits non-zero when any error is found.
 *
 *   npm run check:invariants             human-readable report
 *   npm run check:invariants -- --json   machine-readable report
 *   npm run check:invariants -- --strict also fail on warnings (e.g. stale settlement statuses)
 */
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { checkFinancingInvariants } from "../src/server/invariants/financing-invariants";

try {
  process.loadEnvFile();
} catch {
  // Environment supplied externally.
}

const { values } = parseArgs({ options: { json: { type: "boolean", default: false }, strict: { type: "boolean", default: false } } });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not configured");
  process.exit(2);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main() {
  const report = await checkFinancingInvariants(db);
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.violations.length === 0) {
    console.log(`Financing invariants hold (checked ${report.checkedAt}).`);
  } else {
    console.log(`Financing invariants: ${report.errors} error(s), ${report.warnings} warning(s) at ${report.checkedAt}`);
    for (const v of report.violations) console.log(`  [${v.severity}] ${v.code} ${v.entityType}:${v.entityId} — ${v.message}`);
  }
  const failed = report.errors > 0 || (values.strict && report.warnings > 0);
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 2;
  })
  .finally(() => db.$disconnect());
