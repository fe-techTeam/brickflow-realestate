import "server-only";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { createS3Driver, LocalStorageDriver, storageDriverKind, type StorageDriver } from "./storage-drivers";

export type { StorageDriver, StorageObjectStream } from "./storage-drivers";

/** Uploads land under this scope until validation promotes them. */
export const QUARANTINE_SCOPE = "quarantine";

let driver: StorageDriver | undefined;

/** The configured document store: `local` (default, single host) or `s3` (private, server-side encrypted bucket). */
export function storage(): StorageDriver {
  if (driver) return driver;
  if (storageDriverKind() === "s3") {
    driver = createS3Driver();
  } else {
    // The ignore hint keeps output tracing from bundling the whole project into the standalone server.
    driver = new LocalStorageDriver(path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.STORAGE_DIR ?? "./storage"));
  }
  return driver;
}

export function newStorageKey(scope: string, extension: string): string {
  const now = new Date();
  return `${scope}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${extension}`;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}
