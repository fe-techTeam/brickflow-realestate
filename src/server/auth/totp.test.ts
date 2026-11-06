import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, formatSecretForDisplay, generateTotpSecret, hotp, otpauthUri, totpCode, totpStep, verifyTotp } from "./totp";

// RFC 6238 appendix B: SHA-1 seed "12345678901234567890", 8-digit codes, 30-second steps.
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("HOTP / TOTP", () => {
  it.each(RFC_VECTORS)("matches the RFC 6238 SHA-1 test vector at T=%i", (seconds, expected) => {
    expect(hotp(RFC_SECRET, Math.floor(seconds / 30), 8)).toBe(expected);
  });

  it("matches the RFC 4226 HOTP test vectors", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expect(expected.map((_, counter) => hotp(RFC_SECRET, counter))).toEqual(expected);
  });

  it("round-trips base32 and generates 160-bit secrets", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 17]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("mzxw 6ytb-oi======")).toEqual(Buffer.from("foobar"));
    expect(() => base32Decode("MZXW1")).toThrow(/base32/);

    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  it("formats the manual key in groups of four", () => {
    expect(formatSecretForDisplay("ABCDEFGHIJKLMNOP")).toBe("ABCD EFGH IJKL MNOP");
  });

  it("builds an otpauth:// URI that authenticator apps understand", () => {
    const uri = new URL(otpauthUri("JBSWY3DPEHPK3PXP", "a.user+test@example.com"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/BrickFlow:a.user+test@example.com");
    expect(Object.fromEntries(uri.searchParams)).toEqual({ secret: "JBSWY3DPEHPK3PXP", issuer: "BrickFlow", algorithm: "SHA1", digits: "6", period: "30" });
  });
});

describe("verifyTotp", () => {
  const secret = generateTotpSecret();
  const now = new Date("2026-11-06T10:00:15Z");
  const step = totpStep(now);

  it("accepts the current code and returns its step", () => {
    expect(verifyTotp(secret, totpCode(secret, now), { at: now })).toBe(step);
  });

  it("tolerates one step of clock drift either way, but not two", () => {
    expect(verifyTotp(secret, totpCode(secret, now.getTime() - 30_000), { at: now })).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, now.getTime() + 30_000), { at: now })).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, now.getTime() - 60_000), { at: now })).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, now.getTime() + 60_000), { at: now })).toBeNull();
  });

  it("rejects a code whose step was already used (replay)", () => {
    const code = totpCode(secret, now);
    expect(verifyTotp(secret, code, { at: now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, code, { at: now, lastUsedStep: step + 1 })).toBeNull();
    expect(verifyTotp(secret, code, { at: now, lastUsedStep: step - 1 })).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, now.getTime() - 30_000), { at: now, lastUsedStep: step - 1 })).toBeNull();
  });

  it("accepts spaces and rejects malformed input", () => {
    const code = totpCode(secret, now);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { at: now })).toBe(step);
    expect(verifyTotp(secret, "", { at: now })).toBeNull();
    expect(verifyTotp(secret, "12345", { at: now })).toBeNull();
    expect(verifyTotp(secret, "1234567", { at: now })).toBeNull();
    expect(verifyTotp(secret, "abcdef", { at: now })).toBeNull();
  });

  it("rejects a code generated for another secret", () => {
    expect(verifyTotp(generateTotpSecret(), totpCode(secret, now), { at: now })).toBeNull();
  });
});
