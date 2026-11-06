/**
 * Field-level encryption for sensitive columns (bank account numbers, PAN).
 *
 * AES-256-GCM with a random 96-bit IV per value. The caller's `context` (e.g.
 * "BankAccount.accountNumber:<organisationId>") is bound as additional authenticated data, so a
 * ciphertext copied into another row or column fails to decrypt.
 *
 * Keys: DATA_ENCRYPTION_KEY holds 32 random bytes as base64 or hex. DATA_ENCRYPTION_KEY_PREVIOUS
 * (optional) is accepted for decryption only during a key rotation. Encryption and fingerprint
 * subkeys are derived with HKDF so the master key is never used directly.
 *
 * Self-contained (no server-only import) so the seed and data-migration scripts can use it.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";
const PREFIX = `enc:${VERSION}:`;
const IV_BYTES = 12;
const TAG_BYTES = 16;
// Non-production fallback so local development and tests work without configuration.
const DEVELOPMENT_KEY_SEED = "brickflow-development-only-field-encryption-key";

interface KeyMaterial {
  id: string;
  encryptionKey: Buffer;
  fingerprintKey: Buffer;
}

export class FieldEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldEncryptionError";
  }
}

function parseKey(raw: string, name: string): Buffer {
  const value = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new FieldEncryptionError(`${name} must be 32 random bytes encoded as base64 (44 characters) or hex (64 characters). Generate one with: openssl rand -base64 32`);
  }
  return key;
}

function derive(master: Buffer): KeyMaterial {
  return {
    id: createHash("sha256").update("brickflow-key-id:").update(master).digest("hex").slice(0, 8),
    encryptionKey: Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "brickflow-field-encryption-v1", 32)),
    fingerprintKey: Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "brickflow-field-fingerprint-v1", 32)),
  };
}

let cached: { signature: string; current: KeyMaterial; previous: KeyMaterial | null } | null = null;
let warned = false;

function keys() {
  const currentRaw = process.env.DATA_ENCRYPTION_KEY;
  const previousRaw = process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
  const signature = `${currentRaw ?? ""}|${previousRaw ?? ""}|${process.env.NODE_ENV ?? ""}`;
  if (cached?.signature === signature) return cached;

  let master: Buffer;
  if (currentRaw && currentRaw.trim()) {
    master = parseKey(currentRaw, "DATA_ENCRYPTION_KEY");
  } else if (process.env.NODE_ENV === "production") {
    throw new FieldEncryptionError("DATA_ENCRYPTION_KEY is not set. It is required in production to encrypt bank account numbers and PAN. Generate one with: openssl rand -base64 32");
  } else {
    if (!warned) {
      console.warn("[crypto] DATA_ENCRYPTION_KEY is not set; using the development-only key. Never use this outside local development and tests.");
      warned = true;
    }
    master = createHash("sha256").update(DEVELOPMENT_KEY_SEED).digest();
  }
  cached = {
    signature,
    current: derive(master),
    previous: previousRaw && previousRaw.trim() ? derive(parseKey(previousRaw, "DATA_ENCRYPTION_KEY_PREVIOUS")) : null,
  };
  return cached;
}

/** Fails fast when the production key is missing or malformed. */
export function assertFieldEncryptionConfigured(): void {
  keys();
}

export function isEncryptedValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptField(plaintext: string, context: string): string {
  const { current } = keys();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", current.encryptionKey, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${current.id}:${iv.toString("base64url")}:${ciphertext.toString("base64url")}:${tag.toString("base64url")}`;
}

export function decryptField(payload: string, context: string): string {
  if (!isEncryptedValue(payload)) throw new FieldEncryptionError("Value is not an encrypted field");
  const parts = payload.slice(PREFIX.length).split(":");
  if (parts.length !== 4) throw new FieldEncryptionError("Encrypted field is malformed");
  const [keyId, ivText, cipherText, tagText] = parts as [string, string, string, string];
  const { current, previous } = keys();
  const material = [current, previous].find((candidate) => candidate?.id === keyId);
  if (!material) throw new FieldEncryptionError("Encrypted field uses an unknown key; set DATA_ENCRYPTION_KEY_PREVIOUS during rotation");

  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new FieldEncryptionError("Encrypted field is malformed");
  try {
    const decipher = createDecipheriv("aes-256-gcm", material.encryptionKey, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(cipherText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new FieldEncryptionError("Encrypted field failed authentication (wrong key or context)");
  }
}

/** True when the value was encrypted under an older key and should be re-encrypted. */
export function needsReencryption(payload: string): boolean {
  if (!isEncryptedValue(payload)) return true;
  return payload.slice(PREFIX.length).split(":")[0] !== keys().current.id;
}

/**
 * Deterministic keyed fingerprint (HMAC-SHA256) for equality lookups on encrypted values, e.g.
 * "has this account number been verified before". Not reversible without the key.
 */
export function fingerprintField(value: string, purpose: string): string {
  return createHmac("sha256", keys().current.fingerprintKey).update(purpose).update("\u0000").update(value).digest("hex");
}

export function fingerprintsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Context strings, kept in one place so writers and readers always agree. */
export const ENCRYPTION_CONTEXT = {
  bankAccountNumber: (organisationId: string) => `BankAccount.accountNumber:${organisationId}`,
  organisationPan: (organisationId: string) => `Organisation.pan:${organisationId}`,
} as const;
