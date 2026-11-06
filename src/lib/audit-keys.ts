/**
 * HMAC keyring for the audit chain.
 *
 *   AUDIT_HMAC_KEY            current key, base64, at least 32 random bytes (`openssl rand -base64 32`)
 *   AUDIT_HMAC_KEY_ID         identifier stored on every row sealed with it (default "k1")
 *   AUDIT_HMAC_PREVIOUS_KEYS  retired keys still needed to verify older rows: "id:base64,id:base64"
 *
 * Production refuses to start without a key, and refuses the development key. Outside production a
 * fixed, publicly known development key is used so local runs and tests work without configuration;
 * rows sealed with it carry the key id "dev-insecure" and are never accepted in production.
 */

export const MIN_AUDIT_KEY_BYTES = 32;
export const DEV_AUDIT_KEY_ID = "dev-insecure";
const DEV_AUDIT_KEY = Buffer.from("brickflow-development-only-audit-hmac-key-not-secret", "utf8");
const KEY_ID = /^[A-Za-z0-9._-]{1,32}$/;

export interface AuditKeyring {
  currentKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
  /** True when the publicly known development key is in use. */
  insecure: boolean;
}

export class AuditKeyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditKeyConfigError";
  }
}

function decodeKey(name: string, value: string): Buffer {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) throw new AuditKeyConfigError(`${name} must be base64`);
  const key = Buffer.from(trimmed.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (key.length < MIN_AUDIT_KEY_BYTES) throw new AuditKeyConfigError(`${name} must decode to at least ${MIN_AUDIT_KEY_BYTES} bytes (got ${key.length})`);
  if (key.equals(DEV_AUDIT_KEY)) throw new AuditKeyConfigError(`${name} must not be the development key`);
  return key;
}

function checkKeyId(name: string, id: string): string {
  if (!KEY_ID.test(id) || id === DEV_AUDIT_KEY_ID) throw new AuditKeyConfigError(`${name} must be 1–32 characters of A–Z, a–z, 0–9, ".", "_" or "-" and not "${DEV_AUDIT_KEY_ID}"`);
  return id;
}

/** Builds the keyring from the environment; throws AuditKeyConfigError on any misconfiguration. */
export function loadAuditKeyring(env: NodeJS.ProcessEnv = process.env): AuditKeyring {
  const production = env.NODE_ENV === "production";
  const raw = env.AUDIT_HMAC_KEY?.trim();
  const keys = new Map<string, Buffer>();

  for (const entry of (env.AUDIT_HMAC_PREVIOUS_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const separator = entry.indexOf(":");
    if (separator <= 0) throw new AuditKeyConfigError('AUDIT_HMAC_PREVIOUS_KEYS entries must look like "id:base64key"');
    const id = checkKeyId("AUDIT_HMAC_PREVIOUS_KEYS key id", entry.slice(0, separator));
    keys.set(id, decodeKey(`AUDIT_HMAC_PREVIOUS_KEYS (${id})`, entry.slice(separator + 1)));
  }

  if (!raw) {
    if (production) throw new AuditKeyConfigError("AUDIT_HMAC_KEY is required in production (base64, at least 32 random bytes: openssl rand -base64 32)");
    keys.set(DEV_AUDIT_KEY_ID, DEV_AUDIT_KEY);
    return { currentKeyId: DEV_AUDIT_KEY_ID, keys, insecure: true };
  }
  const currentKeyId = checkKeyId("AUDIT_HMAC_KEY_ID", env.AUDIT_HMAC_KEY_ID?.trim() || "k1");
  keys.set(currentKeyId, decodeKey("AUDIT_HMAC_KEY", raw));
  return { currentKeyId, keys, insecure: false };
}

let cached: { source: string; keyring: AuditKeyring } | undefined;

/** The keyring for the current environment, re-read when the relevant variables change. */
export function auditKeyring(): AuditKeyring {
  const source = [process.env.NODE_ENV, process.env.AUDIT_HMAC_KEY, process.env.AUDIT_HMAC_KEY_ID, process.env.AUDIT_HMAC_PREVIOUS_KEYS].join("\u0000");
  if (cached?.source !== source) cached = { source, keyring: loadAuditKeyring() };
  return cached.keyring;
}
