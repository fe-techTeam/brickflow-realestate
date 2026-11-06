import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { assertValidKey, type StorageDriver, type StorageObjectStream } from "./types";

/** Stores objects as files under a root directory. Used for development and single-host deployments. */
export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    assertValidKey(key);
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return target;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(key)));
  }

  async getStream(key: string): Promise<StorageObjectStream> {
    const target = this.resolve(key);
    const info = await stat(target);
    const body = Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
    return { body, contentLength: info.size };
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    const source = this.resolve(fromKey);
    const target = this.resolve(toKey);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(source, target);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
