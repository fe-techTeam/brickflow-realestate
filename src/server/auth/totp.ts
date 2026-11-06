import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Time-based one-time passwords (RFC 6238 over RFC 4226 HOTP), HMAC-SHA1, 30-second steps, 6 digits. */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous and next step as well, to tolerate clock drift between phone and server. */
export const TOTP_DRIFT_STEPS = 1;
const SECRET_BYTES = 20;
const ISSUER = "BrickFlow";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS, algorithm: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secret).update(message).digest();
  // RFC 4226 section 5.3 dynamic truncation.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpStep(at: Date | number = Date.now()): number {
  const ms = typeof at === "number" ? at : at.getTime();
  return Math.floor(ms / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCode(secretBase32: string, at: Date | number = Date.now()): string {
  return hotp(base32Decode(secretBase32), totpStep(at));
}

export function normaliseOtp(input: string): string {
  return input.replace(/[\s-]/g, "");
}

/**
 * Returns the matched time step, or null. A step at or below `lastUsedStep` never matches, so a code
 * cannot be used twice (RFC 6238 section 5.2). The caller must persist the returned step atomically.
 */
export function verifyTotp(secretBase32: string, input: string, options: { at?: Date | number; lastUsedStep?: number | null } = {}): number | null {
  const code = normaliseOtp(input);
  if (!/^\d+$/.test(code) || code.length !== TOTP_DIGITS) return null;
  const secret = base32Decode(secretBase32);
  const current = totpStep(options.at ?? Date.now());
  const supplied = Buffer.from(code);
  let matched: number | null = null;
  // Every candidate is computed and compared so timing does not reveal which step matched.
  for (let step = current - TOTP_DRIFT_STEPS; step <= current + TOTP_DRIFT_STEPS; step += 1) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, supplied) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (options.lastUsedStep !== undefined && options.lastUsedStep !== null && matched <= options.lastUsedStep) return null;
  return matched;
}

export function otpauthUri(secretBase32: string, accountName: string): string {
  const label = `${encodeURIComponent(ISSUER)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Groups the manual-entry key in blocks of four for readability. */
export function formatSecretForDisplay(secretBase32: string): string {
  return secretBase32.replace(/(.{4})(?=.)/g, "$1 ");
}
