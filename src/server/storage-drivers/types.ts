export interface StorageObjectStream {
  body: ReadableStream<Uint8Array>;
  contentLength: number | null;
}

/** Pluggable object storage for invoice documents. Keys are relative, slash-separated paths. */
export interface StorageDriver {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  getStream(key: string): Promise<StorageObjectStream>;
  move(fromKey: string, toKey: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** Rejects absolute paths, traversal segments and characters outside a conservative set. */
export function assertValidKey(key: string): void {
  if (typeof key !== "string" || key.length === 0 || key.length > 512 || !KEY_PATTERN.test(key) || key.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("Invalid storage key");
  }
}
