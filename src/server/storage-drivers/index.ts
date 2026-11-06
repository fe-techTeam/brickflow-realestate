import path from "node:path";
import { LocalStorageDriver } from "./local";
import { S3StorageDriver, s3ConfigFromEnv } from "./s3";
import type { StorageDriver } from "./types";

export { LocalStorageDriver } from "./local";
export { S3StorageDriver, StorageObjectNotFoundError, createS3Client, s3ConfigFromEnv, type S3CommandClient, type S3StorageConfig } from "./s3";
export { assertValidKey, type StorageDriver, type StorageObjectStream } from "./types";

export type StorageDriverKind = "local" | "s3";

export function storageDriverKind(env: Record<string, string | undefined> = process.env): StorageDriverKind {
  const kind = (env.STORAGE_DRIVER ?? "local").trim() || "local";
  if (kind !== "local" && kind !== "s3") throw new Error(`Unsupported STORAGE_DRIVER "${kind}". Expected "local" or "s3".`);
  return kind;
}

export function createLocalDriver(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): LocalStorageDriver {
  return new LocalStorageDriver(path.resolve(cwd, env.STORAGE_DIR ?? "./storage"));
}

export function createS3Driver(env: Record<string, string | undefined> = process.env): S3StorageDriver {
  return new S3StorageDriver(s3ConfigFromEnv(env));
}

export function createDriver(kind: StorageDriverKind, env: Record<string, string | undefined> = process.env, cwd?: string): StorageDriver {
  return kind === "s3" ? createS3Driver(env) : createLocalDriver(env, cwd);
}
