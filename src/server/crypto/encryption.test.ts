import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { decryptField, encryptField, parseEncryptionKey } from "./encryption";

const ORIGINAL_KEY = process.env.DATA_ENCRYPTION_KEY;

afterEach(() => {
  process.env.DATA_ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("field encryption (AES-256-GCM)", () => {
  it("round-trips and never stores the plaintext", () => {
    const sealed = encryptField("JBSWY3DPEHPK3PXP", "user:1:totp");
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptField(sealed, "user:1:totp")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("uses a fresh IV for every encryption", () => {
    const a = encryptField("same", "ctx");
    const b = encryptField("same", "ctx");
    expect(a).not.toBe(b);
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
  });

  it("rejects a ciphertext bound to another context (row or column swap)", () => {
    const sealed = encryptField("secret", "user:1:totp");
    expect(() => decryptField(sealed, "user:2:totp")).toThrow();
  });

  it("detects tampering with the ciphertext or the tag", () => {
    const [v, iv, ct, tag] = encryptField("secret value", "ctx").split(".");
    const flip = (part: string) => {
      const bytes = Buffer.from(part, "base64url");
      bytes[0] = bytes[0]! ^ 1;
      return bytes.toString("base64url");
    };
    expect(() => decryptField([v, iv, flip(ct!), tag].join("."), "ctx")).toThrow();
    expect(() => decryptField([v, iv, ct, flip(tag!)].join("."), "ctx")).toThrow();
    expect(() => decryptField([v, flip(iv!), ct, tag].join("."), "ctx")).toThrow();
    expect(() => decryptField(["v2", iv, ct, tag].join("."), "ctx")).toThrow(/format/);
    expect(() => decryptField("garbage", "ctx")).toThrow(/format/);
  });

  it("fails to decrypt under a different key", () => {
    const sealed = encryptField("secret", "ctx");
    process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decryptField(sealed, "ctx")).toThrow();
  });

  it("requires a 32-byte base64 key with a clear message", () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(/DATA_ENCRYPTION_KEY is not set/);
    expect(() => parseEncryptionKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(() => parseEncryptionKey("not base64 at all")).toThrow(/32 bytes/);
    expect(parseEncryptionKey(randomBytes(32).toString("base64"))).toHaveLength(32);

    delete process.env.DATA_ENCRYPTION_KEY;
    expect(() => encryptField("x", "ctx")).toThrow(/DATA_ENCRYPTION_KEY/);
  });
});
