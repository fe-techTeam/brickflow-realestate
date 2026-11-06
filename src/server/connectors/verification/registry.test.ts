import { afterEach, describe, expect, it, vi } from "vitest";
import { SandboxVerificationProvider, UNRELATED_NAME } from "./providers/sandbox";
import { selectVerificationProviders, setVerificationProvidersForTesting, verification, VerificationConfigError } from "./registry";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setVerificationProvidersForTesting({});
});

const CASHFREE = { CASHFREE_VERIFICATION_CLIENT_ID: "id", CASHFREE_VERIFICATION_CLIENT_SECRET: "secret" };
const QUICKO = { QUICKO_API_KEY: "k", QUICKO_API_SECRET: "s", QUICKO_EINVOICE_GSTIN: "27AAHCC7314K1Z9", QUICKO_EINVOICE_USERNAME: "u", QUICKO_EINVOICE_PASSWORD: "p" };

describe("provider selection", () => {
  it("defaults to the sandbox outside production", () => {
    expect(selectVerificationProviders({ NODE_ENV: "development" })).toEqual({ primary: "sandbox", eInvoice: "sandbox", sandboxInProduction: false });
  });

  it("requires an explicit provider in production", () => {
    expect(() => selectVerificationProviders({ NODE_ENV: "production" })).toThrow(/VERIFICATION_PROVIDER is not set/);
  });

  it("refuses the sandbox in production unless explicitly allowed", () => {
    expect(() => selectVerificationProviders({ NODE_ENV: "production", VERIFICATION_PROVIDER: "sandbox" })).toThrow(VerificationConfigError);
    expect(() => selectVerificationProviders({ NODE_ENV: "production", VERIFICATION_PROVIDER: "sandbox", ALLOW_SANDBOX_VERIFICATION: "yes" })).toThrow(/refused in production/);
    expect(selectVerificationProviders({ NODE_ENV: "production", VERIFICATION_PROVIDER: "sandbox", ALLOW_SANDBOX_VERIFICATION: "true" })).toMatchObject({ sandboxInProduction: true });
  });

  it("refuses a sandbox e-invoice provider next to a live primary provider in production", () => {
    expect(() => selectVerificationProviders({ NODE_ENV: "production", VERIFICATION_PROVIDER: "cashfree", VERIFICATION_EINVOICE_PROVIDER: "sandbox", ...CASHFREE })).toThrow(/refused/);
  });

  it("requires credentials for live providers", () => {
    expect(() => selectVerificationProviders({ VERIFICATION_PROVIDER: "cashfree" })).toThrow(/CASHFREE_VERIFICATION_CLIENT_ID/);
    expect(() => selectVerificationProviders({ VERIFICATION_PROVIDER: "cashfree", ...CASHFREE, VERIFICATION_EINVOICE_PROVIDER: "quicko" })).toThrow(/QUICKO_API_KEY/);
    expect(selectVerificationProviders({ NODE_ENV: "production", VERIFICATION_PROVIDER: "cashfree", ...CASHFREE })).toEqual({ primary: "cashfree", eInvoice: null, sandboxInProduction: false });
    expect(selectVerificationProviders({ NODE_ENV: "production", VERIFICATION_PROVIDER: "cashfree", VERIFICATION_EINVOICE_PROVIDER: "quicko", ...CASHFREE, ...QUICKO }).eInvoice).toBe("quicko");
  });

  it("rejects unknown provider names", () => {
    expect(() => selectVerificationProviders({ VERIFICATION_PROVIDER: "acme" })).toThrow(/must be one of/);
    expect(() => selectVerificationProviders({ VERIFICATION_PROVIDER: "cashfree", ...CASHFREE, CASHFREE_VERIFICATION_ENV: "staging" })).toThrow(/CASHFREE_VERIFICATION_ENV/);
  });
});

describe("registry", () => {
  it("resolves adapters per check type from the environment", () => {
    vi.stubEnv("VERIFICATION_PROVIDER", "cashfree");
    vi.stubEnv("CASHFREE_VERIFICATION_CLIENT_ID", "id");
    vi.stubEnv("CASHFREE_VERIFICATION_CLIENT_SECRET", "secret");
    expect(verification.gstin().provider).toBe("cashfree");
    expect(verification.bankAccount().provider).toBe("cashfree");
    expect(() => verification.eInvoice()).toThrow(/No e-invoice verification provider/);
    vi.stubEnv("VERIFICATION_EINVOICE_PROVIDER", "quicko");
    for (const [key, value] of Object.entries(QUICKO)) vi.stubEnv(key, value);
    expect(verification.eInvoice().provider).toBe("quicko");
  });

  it("logs a loud warning whenever the sandbox is used in production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERIFICATION_PROVIDER", "sandbox");
    vi.stubEnv("ALLOW_SANDBOX_VERIFICATION", "true");
    expect(verification.pan().provider).toBe("sandbox");
    expect(warn.mock.calls.flat().join(" ")).toMatch(/SANDBOX VERIFICATION PROVIDER ACTIVE IN PRODUCTION/);
  });

  it("accepts test overrides", () => {
    const fake = new SandboxVerificationProvider();
    setVerificationProvidersForTesting({ gstin: fake });
    expect(verification.gstin()).toBe(fake);
  });
});

describe("sandbox provider", () => {
  const sandbox = new SandboxVerificationProvider();

  it("is deterministic and echoes the organisation name", async () => {
    const first = await sandbox.verifyGstin({ gstin: "29AAICP2912R1ZR", name: "Ujjivan Small Finance Bank" });
    const second = await sandbox.verifyGstin({ gstin: "29AAICP2912R1ZR", name: "Ujjivan Small Finance Bank" });
    expect(first).toEqual(second);
    expect(first.result).toMatchObject({ status: "ACTIVE", legalName: "UJJIVAN SMALL FINANCE BANK", stateName: "Karnataka", constitution: "Company" });
    expect(first.providerReference).toMatch(/^SBX-[0-9A-F]{12}$/);
  });

  it("supports trigger values for every outcome", async () => {
    const gstin = (digits: string) => {
      const first14 = `27AAPFP${digits}H1Z`;
      return `${first14}${checkCharacter(first14)}`;
    };
    await expect(sandbox.verifyGstin({ gstin: gstin("0000") })).rejects.toMatchObject({ kind: "NOT_FOUND" });
    await expect(sandbox.verifyGstin({ gstin: gstin("5555") })).rejects.toMatchObject({ kind: "PROVIDER_DOWN" });
    expect((await sandbox.verifyGstin({ gstin: gstin("9999") })).result.status).toBe("CANCELLED");
    expect((await sandbox.verifyGstin({ gstin: gstin("1111"), name: "Prestige" })).result.legalName).toBe(UNRELATED_NAME);

    expect((await sandbox.verifyPan({ pan: "AAPFP0000H" })).result.status).toBe("INVALID");
    expect((await sandbox.verifyPan({ pan: "AAPFP9999H" })).result.status).toBe("DEACTIVATED");
    expect((await sandbox.verifyPan({ pan: "AAPFP1111H", name: "Prestige Realty" })).result.nameMatch!.score).toBeLessThan(40);
    expect((await sandbox.verifyPan({ pan: "AAPFP9005H", name: "Prestige Realty" })).result.nameMatch).toMatchObject({ score: 100, source: "provider" });

    expect((await sandbox.verifyBankAccount({ accountNumber: "500100090000", ifsc: "HDFC0000001" })).result).toMatchObject({ status: "INVALID", statusCode: "INVALID_ACCOUNT" });
    expect((await sandbox.verifyBankAccount({ accountNumber: "500100099999", ifsc: "HDFC0000001" })).result.statusCode).toBe("ACCOUNT_BLOCKED");
    await expect(sandbox.verifyBankAccount({ accountNumber: "500100095555", ifsc: "HDFC0000001" })).rejects.toMatchObject({ kind: "PROVIDER_DOWN" });

    await expect(sandbox.verifyUdyam({ udyamNumber: "UDYAM-MH-12-1230000" })).rejects.toMatchObject({ kind: "NOT_FOUND" });
    expect((await sandbox.verifyUdyam({ udyamNumber: "UDYAM-MH-12-1239999" })).result.status).toBe("CANCELLED");
    expect((await sandbox.verifyUdyam({ udyamNumber: "UDYAM-MH-12-1234567" })).result.enterpriseType).toBe("SMALL");

    await expect(sandbox.verifyEInvoice({ irn: `0000${"a".repeat(60)}` })).rejects.toMatchObject({ kind: "NOT_FOUND" });
    expect((await sandbox.verifyEInvoice({ irn: `ffff${"a".repeat(60)}` })).result.status).toBe("CANCELLED");
    expect((await sandbox.verifyEInvoice({ irn: "a".repeat(64) })).result.status).toBe("ACTIVE");
  });
});

function checkCharacter(first14: string): string {
  const charset = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = charset.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return charset[(36 - (sum % 36)) % 36]!;
}
