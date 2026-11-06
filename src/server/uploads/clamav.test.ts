import { afterEach, describe, expect, it } from "vitest";
import { startFakeClamd as fakeClamd, type FakeClamd } from "../../../test/support/fake-clamd";
import { ClamavUnavailableError, clamavConfigFromEnv, parseClamdReply, scanWithClamd } from "./clamav";

let current: FakeClamd | null = null;
afterEach(async () => {
  await current?.close();
  current = null;
});

const BYTES = Buffer.alloc(150 * 1024, 7);

describe("scanWithClamd", () => {
  it("streams the whole file in INSTREAM chunks and reports a clean result", async () => {
    current = await fakeClamd("clean");
    await expect(scanWithClamd(BYTES, { host: "127.0.0.1", port: current.port, timeoutMs: 5000 })).resolves.toEqual({ clean: true });
    expect(current.received()?.equals(BYTES)).toBe(true);
  });

  it("returns the signature of an infected file", async () => {
    current = await fakeClamd("infected");
    await expect(scanWithClamd(BYTES, { host: "127.0.0.1", port: current.port, timeoutMs: 5000 })).resolves.toEqual({ clean: false, signature: "Eicar-Test-Signature" });
  });

  it("treats a scanner error reply as unavailable", async () => {
    current = await fakeClamd("error");
    await expect(scanWithClamd(BYTES, { host: "127.0.0.1", port: current.port, timeoutMs: 5000 })).rejects.toBeInstanceOf(ClamavUnavailableError);
  });

  it("times out when the scanner does not answer", async () => {
    current = await fakeClamd("silent");
    await expect(scanWithClamd(BYTES, { host: "127.0.0.1", port: current.port, timeoutMs: 200 })).rejects.toThrow(/did not respond/);
  });

  it("fails when the scanner is unreachable", async () => {
    const probe = await fakeClamd("clean");
    const port = probe.port;
    await probe.close();
    await expect(scanWithClamd(BYTES, { host: "127.0.0.1", port, timeoutMs: 2000 })).rejects.toThrow(/connection failed/);
  });
});

describe("clamd configuration and replies", () => {
  it("is disabled unless CLAMAV_HOST is set", () => {
    expect(clamavConfigFromEnv({})).toBeNull();
    expect(clamavConfigFromEnv({ CLAMAV_HOST: "clamav" })).toEqual({ host: "clamav", port: 3310, timeoutMs: 15000 });
    expect(clamavConfigFromEnv({ CLAMAV_HOST: "av", CLAMAV_PORT: "3311", CLAMAV_TIMEOUT_MS: "500" })).toEqual({ host: "av", port: 3311, timeoutMs: 500 });
    expect(clamavConfigFromEnv({ CLAMAV_HOST: "av", CLAMAV_PORT: "99999" })?.port).toBe(3310);
  });

  it("parses clamd replies", () => {
    expect(parseClamdReply("stream: OK\0")).toEqual({ clean: true });
    expect(parseClamdReply("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({ clean: false, signature: "Win.Test.EICAR_HDB-1" });
    expect(() => parseClamdReply("")).toThrow(ClamavUnavailableError);
    expect(() => parseClamdReply("COMMAND READ TIMED OUT ERROR")).toThrow(ClamavUnavailableError);
  });
});
