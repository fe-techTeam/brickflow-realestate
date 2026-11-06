import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Field-level encryption for secrets stored in the database (AES-256-GCM).
 *
 * Format: `v1.<iv>.<ciphertext>.<tag>` (base64url parts). The `context` string is bound as
 * additional authenticated data, so a ciphertext copied to another row or column fails to decrypt.
 * Use a context that names the owner and purpose, e.g. `user:<id>:totp`.
 */
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: { raw: string; key: Buffer } | null = null;

export function parseEncryptionKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error("DATA_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes encoded as base64 (openssl rand -base64 32)");
  return key;
}

function dataKey(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (cachedKey && cachedKey.raw === raw) return cachedKey.key;
  const key = parseEncryptionKey(raw);
  cachedKey = { raw: raw!, key };
  return key;
}

export function encryptField(plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dataKey(), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

/** Throws when the value was tampered with, encrypted under another key, or bound to another context. */
export function decryptField(payload: string, context: string): string {
  const [version, iv, ciphertext, tag] = payload.split(".");
  if (version !== VERSION || !iv || ciphertext === undefined || !tag) throw new Error("Unsupported encrypted field format");
  const decipher = createDecipheriv("aes-256-gcm", dataKey(), Buffer.from(iv, "base64url"), { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
