import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorageDriver } from "./local";

let root: string;
let driver: LocalStorageDriver;
const BYTES = new TextEncoder().encode("%PDF-1.7 local");

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "bf-storage-"));
  driver = new LocalStorageDriver(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("LocalStorageDriver", () => {
  it("writes, reads and streams files", async () => {
    await driver.put("invoices/2026/11/a.pdf", BYTES);
    expect(Buffer.from(await driver.get("invoices/2026/11/a.pdf")).equals(Buffer.from(BYTES))).toBe(true);

    const { body, contentLength } = await driver.getStream("invoices/2026/11/a.pdf");
    expect(contentLength).toBe(BYTES.byteLength);
    expect(Buffer.from(await new Response(body).arrayBuffer()).equals(Buffer.from(BYTES))).toBe(true);
  });

  it("moves a quarantined file into the clean area", async () => {
    await driver.put("quarantine/2026/11/q.pdf", BYTES);
    await driver.move("quarantine/2026/11/q.pdf", "invoices/2026/12/c.pdf");
    expect(await readdir(path.join(root, "quarantine", "2026", "11"))).toEqual([]);
    expect(Buffer.from(await driver.get("invoices/2026/12/c.pdf")).equals(Buffer.from(BYTES))).toBe(true);
  });

  it("deletes idempotently", async () => {
    await driver.put("invoices/d.pdf", BYTES);
    await driver.delete("invoices/d.pdf");
    await driver.delete("invoices/d.pdf");
    await expect(driver.get("invoices/d.pdf")).rejects.toThrow();
  });

  it("refuses keys that escape the root", async () => {
    for (const key of ["../outside.pdf", "/etc/passwd", "invoices/../../x.pdf", "invoices\\..\\x.pdf"]) {
      await expect(driver.put(key, BYTES)).rejects.toThrow(/Invalid storage key/);
    }
  });
});
