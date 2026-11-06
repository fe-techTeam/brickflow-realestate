import "server-only";
import { createHash, randomInt } from "node:crypto";

export const RECOVERY_CODE_COUNT = 10;
// No 0/O, 1/I/L: codes are often written down and typed back by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUPS = 4;
const GROUP_LENGTH = 4;

/** 16 symbols from a 31-letter alphabet (~79 bits), so a fast hash is safe for storage. */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    let group = "";
    for (let i = 0; i < GROUP_LENGTH; i += 1) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

export function normaliseRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function looksLikeRecoveryCode(input: string): boolean {
  const code = normaliseRecoveryCode(input);
  return code.length === GROUPS * GROUP_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}

export function hashRecoveryCode(input: string): string {
  return createHash("sha256").update(`brickflow-recovery:${normaliseRecoveryCode(input)}`).digest("hex");
}
