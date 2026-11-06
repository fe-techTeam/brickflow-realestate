import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptField, encryptField, fingerprintField, FieldEncryptionError, isEncryptedValue, needsReencryption } from "./field-encryption";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("hex");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("field encryption", () => {
  it("round-trips with a random IV per value", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", KEY_A);
    const one = encryptField("500100099005", "BankAccount.accountNumber:org1");
    const two = encryptField("500100099005", "BankAccount.accountNumber:org1");
    expect(isEncryptedValue(one)).toBe(true);
    expect(one).not.toBe(two);
    expect(one).not.toContain("500100099005");
    expect(decryptField(one, "BankAccount.accountNumber:org1")).toBe("500100099005");
  });

  it("binds the ciphertext to its context", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", KEY_A);
    const value = encryptField("ABCPV1234D", "Organisation.pan:org1");
    expect(() => decryptField(value, "Organisation.pan:org2")).toThrow(FieldEncryptionError);
  });

  it("detects tampering", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", KEY_A);
    const value = encryptField("ABCPV1234D", "ctx");
    const parts = value.split(":");
    const cipher = Buffer.from(parts[4]!, "base64url");
    cipher[0] = cipher[0]! ^ 1;
    parts[4] = cipher.toString("base64url");
    expect(() => decryptField(parts.join(":"), "ctx")).toThrow(/failed authentication/);
  });

  it("decrypts with the previous key during rotation and flags values for re-encryption", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", KEY_A);
    const old = encryptField("secret", "ctx");
    vi.stubEnv("DATA_ENCRYPTION_KEY", KEY_B);
    expect(() => decryptField(old, "ctx")).toThrow(/unknown key/);
    vi.stubEnv("DATA_ENCRYPTION_KEY_PREVIOUS", KEY_A);
    expect(decryptField(old, "ctx")).toBe("secret");
    expect(needsReencryption(old)).toBe(true);
    expect(needsReencryption(encryptField("secret", "ctx"))).toBe(false);
  });

  it("refuses to run in production without a key, and rejects malformed keys", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => encryptField("x", "ctx")).toThrow(/DATA_ENCRYPTION_KEY is not set/);
    vi.stubEnv("DATA_ENCRYPTION_KEY", "too-short");
    expect(() => encryptField("x", "ctx")).toThrow(/32 random bytes/);
  });

  it("produces stable, purpose-separated fingerprints", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", KEY_A);
    expect(fingerprintField("YESB0000262:026291800001191", "bank-account")).toBe(fingerprintField("YESB0000262:026291800001191", "bank-account"));
    expect(fingerprintField("x", "a")).not.toBe(fingerprintField("x", "b"));
    vi.stubEnv("DATA_ENCRYPTION_KEY", KEY_B);
    expect(fingerprintField("x", "a")).toHaveLength(64);
  });
});
