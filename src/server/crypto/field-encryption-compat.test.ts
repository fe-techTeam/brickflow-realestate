import { createCipheriv, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptField, ENCRYPTION_CONTEXT, encryptField, FieldEncryptionError, needsReencryption } from "./field-encryption";

/**
 * Both payload formats that were written before the two areas shared one helper must keep decrypting:
 * `enc:v1:<keyId>:…` (HKDF subkey, key id) and the earlier `v1.<iv>.<ct>.<tag>` (raw master key).
 */
const KEY = randomBytes(32);
const OTHER = randomBytes(32);

/** Reproduces the earlier authenticator-secret format byte for byte. */
function legacyEncrypt(plaintext: string, context: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), ct.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("field encryption compatibility", () => {
  const userId = "user_123";
  const context = ENCRYPTION_CONTEXT.totpSecret(userId);

  it("keeps the authenticator contexts used by stored secrets", () => {
    expect(context).toBe("user:user_123:totp");
    expect(ENCRYPTION_CONTEXT.totpPendingSecret(userId)).toBe("user:user_123:totp-pending");
  });

  it("decrypts the earlier v1. format under the current key and flags it for re-encryption", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", KEY.toString("base64"));
    const legacy = legacyEncrypt("JBSWY3DPEHPK3PXP", context, KEY);
    expect(decryptField(legacy, context)).toBe("JBSWY3DPEHPK3PXP");
    expect(needsReencryption(legacy)).toBe(true);
  });

  it("decrypts the earlier format under DATA_ENCRYPTION_KEY_PREVIOUS during a rotation", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", OTHER.toString("base64"));
    vi.stubEnv("DATA_ENCRYPTION_KEY_PREVIOUS", KEY.toString("hex"));
    expect(decryptField(legacyEncrypt("SECRET", context, KEY), context)).toBe("SECRET");
  });

  it("still enforces the context binding and the key for the earlier format", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", KEY.toString("base64"));
    const legacy = legacyEncrypt("SECRET", context, KEY);
    expect(() => decryptField(legacy, ENCRYPTION_CONTEXT.totpSecret("someone_else"))).toThrow(FieldEncryptionError);
    expect(() => decryptField(legacyEncrypt("SECRET", context, OTHER), context)).toThrow(/failed authentication/);
    const [v, iv, ct, tag] = legacy.split(".");
    const flipped = Buffer.from(ct!, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptField([v, iv, flipped.toString("base64url"), tag].join("."), context)).toThrow(FieldEncryptionError);
    expect(() => decryptField("v1.short.x.y", context)).toThrow(/malformed/);
  });

  it("reads both formats side by side and writes only the current one", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", KEY.toString("base64"));
    const current = encryptField("NEW", context);
    expect(current).toMatch(/^enc:v1:[0-9a-f]{8}:/);
    expect(needsReencryption(current)).toBe(false);
    expect(decryptField(current, context)).toBe("NEW");
    expect(decryptField(legacyEncrypt("OLD", context, KEY), context)).toBe("OLD");
  });

  it("refuses values that are neither format", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", KEY.toString("base64"));
    expect(() => decryptField("plaintext", context)).toThrow(/not an encrypted field/);
    expect(() => decryptField("v2.a.b.c", context)).toThrow(/not an encrypted field/);
  });
});
