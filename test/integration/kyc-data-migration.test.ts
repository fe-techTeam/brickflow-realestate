import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decryptField, ENCRYPTION_CONTEXT } from "@/server/crypto/field-encryption";
import { db } from "@/server/db";

const ROOT = path.resolve(__dirname, "../..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

function migrate(...args: string[]): string {
  return execFileSync(process.execPath, [TSX, "scripts/migrate-kyc-data.ts", ...args], { cwd: ROOT, env: { ...process.env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

describe("KYC data migration script", () => {
  it("encrypts legacy PAN and bank details idempotently, and scrubs plaintext on request", async () => {
    const org = await db.organisation.create({
      data: {
        type: "CHANNEL_PARTNER",
        name: "Legacy Brokers",
        legalName: "Legacy Brokers LLP",
        pan: "AAJFL2468M",
        bankName: "Legacy Bank",
        bankAccountNumber: "123456789012",
        bankIfsc: "UTIB0000123",
      },
    });

    expect(migrate("--dry-run")).toMatch(/dry run/);
    expect(await db.bankAccount.count({ where: { organisationId: org.id } })).toBe(0);
    expect((await db.organisation.findUniqueOrThrow({ where: { id: org.id } })).panEncrypted).toBeNull();

    migrate();
    const migrated = await db.organisation.findUniqueOrThrow({ where: { id: org.id }, include: { bankAccounts: true } });
    expect(migrated.panMasked).toBe("AA•••••68M");
    expect(decryptField(migrated.panEncrypted!, ENCRYPTION_CONTEXT.organisationPan(org.id))).toBe("AAJFL2468M");
    expect(migrated.bankAccounts).toHaveLength(1);
    expect(migrated.bankAccounts[0]).toMatchObject({ accountNumberLast4: "9012", ifsc: "UTIB0000123", verificationStatus: "UNVERIFIED", isPrimary: true, bankName: "Legacy Bank" });
    expect(decryptField(migrated.bankAccounts[0]!.accountNumberEncrypted, ENCRYPTION_CONTEXT.bankAccountNumber(org.id))).toBe("123456789012");
    expect(migrated.pan).toBe("AAJFL2468M");
    expect(migrated.kycStatus).toBe("NOT_STARTED");

    migrate();
    expect(await db.bankAccount.count({ where: { organisationId: org.id } })).toBe(1);
    expect((await db.organisation.findUniqueOrThrow({ where: { id: org.id } })).panEncrypted).toBe(migrated.panEncrypted);

    migrate("--scrub-legacy", "--organisation", org.id);
    const scrubbed = await db.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(scrubbed).toMatchObject({ pan: null, bankAccountNumber: "XXXXXXXX9012", panMasked: "AA•••••68M" });
  });
});
