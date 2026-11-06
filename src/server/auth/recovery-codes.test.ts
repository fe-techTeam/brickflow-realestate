import { describe, expect, it } from "vitest";
import { generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode, normaliseRecoveryCode, RECOVERY_CODE_COUNT } from "./recovery-codes";

describe("recovery codes", () => {
  it("generates ten unique, unambiguous codes", () => {
    const codes = generateRecoveryCodes();
    expect(RECOVERY_CODE_COUNT).toBe(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-KMNP-Z2-9]{4}(-[A-HJ-KMNP-Z2-9]{4}){3}$/);
      expect(code).not.toMatch(/[01ILO]/);
    }
  });

  it("hashes deterministically and independently of formatting", () => {
    const [code] = generateRecoveryCodes(1);
    const hash = hashRecoveryCode(code!);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(normaliseRecoveryCode(code!));
    expect(hashRecoveryCode(code!.toLowerCase().replace(/-/g, " "))).toBe(hash);
    expect(hashRecoveryCode("AAAA-BBBB-CCCC-DDDD")).not.toBe(hash);
  });

  it("recognises the recovery-code shape and not authenticator codes", () => {
    expect(looksLikeRecoveryCode("ABCD-EFGH-JKMN-PQRS")).toBe(true);
    expect(looksLikeRecoveryCode("abcd efgh jkmn pqrs")).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
    expect(looksLikeRecoveryCode("ABCD-EFGH-JKMN")).toBe(false);
    expect(looksLikeRecoveryCode("ABCD-EFGH-JKMN-PQR0")).toBe(false);
  });
});
