/**
 * Data migration for the Verification & KYC schema. Idempotent; safe to run on every start.
 *
 *   - Encrypts Organisation.pan into panEncrypted (+ panMasked).
 *   - Copies Organisation.bankAccountNumber/bankIfsc into an encrypted BankAccount row. The copy is
 *     UNVERIFIED: it becomes the payout account but must pass a penny-drop check before payouts.
 *   - --reencrypt     re-encrypts values written under DATA_ENCRYPTION_KEY_PREVIOUS with the current key
 *   - --scrub-legacy  clears the legacy plaintext columns once the encrypted copies exist
 *                     (run only after the migration has been verified; the columns are dropped later)
 *   - --dry-run       reports what would change
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/migrate-kyc-data.ts [--dry-run] [--reencrypt] [--scrub-legacy]
 */
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { maskPan } from "../src/lib/verification/masking";
import { validateAccountNumber, validateIfsc } from "../src/lib/verification/validation";
import { assertFieldEncryptionConfigured, decryptField, encryptField, ENCRYPTION_CONTEXT, fingerprintField, needsReencryption } from "../src/server/crypto/field-encryption";

try {
  process.loadEnvFile();
} catch {
  // Environment supplied externally.
}

const { values: flags } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false }, reencrypt: { type: "boolean", default: false }, "scrub-legacy": { type: "boolean", default: false } },
});

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not configured");
assertFieldEncryptionConfigured();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const dryRun = flags["dry-run"] === true;

async function main() {
  const counts = { panEncrypted: 0, bankAccountsCreated: 0, reencrypted: 0, legacyScrubbed: 0, skippedInvalidAccounts: 0 };
  const organisations = await db.organisation.findMany();

  for (const org of organisations) {
    await db.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};
      if (org.pan && !org.panEncrypted) {
        data.panEncrypted = encryptField(org.pan.trim().toUpperCase(), ENCRYPTION_CONTEXT.organisationPan(org.id));
        data.panMasked = maskPan(org.pan.trim().toUpperCase());
        counts.panEncrypted += 1;
      } else if (flags.reencrypt && org.panEncrypted && needsReencryption(org.panEncrypted)) {
        data.panEncrypted = encryptField(decryptField(org.panEncrypted, ENCRYPTION_CONTEXT.organisationPan(org.id)), ENCRYPTION_CONTEXT.organisationPan(org.id));
        counts.reencrypted += 1;
      }

      const account = org.bankAccountNumber ? validateAccountNumber(org.bankAccountNumber) : null;
      const ifsc = org.bankIfsc ? validateIfsc(org.bankIfsc) : null;
      if (account?.ok && ifsc?.ok) {
        const fingerprint = fingerprintField(`${ifsc.value}:${account.value}`, "bank-account");
        const existing = await tx.bankAccount.findUnique({ where: { organisationId_accountFingerprint: { organisationId: org.id, accountFingerprint: fingerprint } } });
        if (!existing) {
          const hasPrimary = (await tx.bankAccount.count({ where: { organisationId: org.id, isPrimary: true, archivedAt: null } })) > 0;
          if (!dryRun) {
            await tx.bankAccount.create({
              data: {
                organisationId: org.id,
                accountNumberEncrypted: encryptField(account.value, ENCRYPTION_CONTEXT.bankAccountNumber(org.id)),
                accountNumberLast4: account.value.slice(-4),
                accountFingerprint: fingerprint,
                ifsc: ifsc.value,
                bankName: org.bankName,
                accountHolderName: org.legalName,
                verificationStatus: "UNVERIFIED",
                isPrimary: !hasPrimary,
                primarySince: hasPrimary ? null : new Date(),
              },
            });
          }
          counts.bankAccountsCreated += 1;
        }
        if (flags["scrub-legacy"]) {
          data.bankAccountNumber = `XXXXXXXX${account.value.slice(-4)}`;
          counts.legacyScrubbed += 1;
        }
      } else if (org.bankAccountNumber && !org.bankAccountNumber.startsWith("XXXX")) {
        counts.skippedInvalidAccounts += 1;
      }

      if (flags.reencrypt && !dryRun) {
        const accounts = await tx.bankAccount.findMany({ where: { organisationId: org.id } });
        for (const row of accounts) {
          if (!needsReencryption(row.accountNumberEncrypted)) continue;
          const context = ENCRYPTION_CONTEXT.bankAccountNumber(org.id);
          await tx.bankAccount.update({ where: { id: row.id }, data: { accountNumberEncrypted: encryptField(decryptField(row.accountNumberEncrypted, context), context) } });
          counts.reencrypted += 1;
        }
      }

      if (flags["scrub-legacy"] && (org.panEncrypted || data.panEncrypted) && org.pan) {
        data.pan = null;
        counts.legacyScrubbed += 1;
      }
      if (!dryRun && Object.keys(data).length > 0) await tx.organisation.update({ where: { id: org.id }, data });
    });
  }
  console.log(`[kyc-data] ${dryRun ? "dry run: " : ""}${JSON.stringify(counts)}`);
}

main()
  .catch((error) => {
    console.error("[kyc-data] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
