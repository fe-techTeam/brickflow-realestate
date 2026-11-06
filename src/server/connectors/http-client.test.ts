import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "./circuit-breaker";
import { ProviderDownError } from "./errors";
import { parseRetryAfter, ResilientHttpClient } from "./http-client";
import type { ConnectorLogger, LogLevel } from "./log";
import { fakeFetch, type ScriptedReply } from "./testing/fake-fetch";

function setup(replies: ScriptedReply[], options: { breaker?: CircuitBreaker; timeoutMs?: number; random?: () => number } = {}) {
  const fetch = fakeFetch(replies);
  const sleeps: number[] = [];
  const logs: { level: LogLevel; message: string; fields?: Record<string, unknown> }[] = [];
  const logger: ConnectorLogger = { log: (level, message, fields) => logs.push({ level, message, fields }) };
  const client = new ResilientHttpClient({
    provider: "acme",
    baseUrl: "https://api.acme.test/v1/",
    fetchImpl: fetch.impl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    logger,
    random: options.random ?? (() => 0.5),
    breaker: options.breaker ?? new CircuitBreaker("acme-test"),
    timeoutMs: options.timeoutMs,
    defaultHeaders: { "x-api-key": "super-secret-key" },
  });
  return { client, fetch, sleeps, logs };
}

const ok = { status: 200, body: { ok: true } };

describe("ResilientHttpClient", () => {
  it("joins URLs, sends JSON and propagates the request ID", async () => {
    const { client, fetch } = setup([ok]);
    const response = await client.request({ operation: "thing.create", method: "POST", path: "/things", query: { a: "1", b: undefined }, json: { x: 1 }, requestId: "req-1" });
    expect(response).toMatchObject({ status: 200, ok: true, json: { ok: true }, attempts: 1, requestId: "req-1" });
    expect(fetch.requests[0]).toMatchObject({ url: "https://api.acme.test/v1/things?a=1", method: "POST", body: { x: 1 } });
    expect(fetch.requests[0]!.headers).toMatchObject({ "x-request-id": "req-1", "content-type": "application/json", "x-api-key": "super-secret-key" });
  });

  it("generates a request ID when none is given", async () => {
    const { client, fetch } = setup([ok]);
    const response = await client.request({ operation: "thing.get", method: "GET", path: "/things/1" });
    expect(response.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fetch.requests[0]!.headers["x-request-id"]).toBe(response.requestId);
  });

  it("retries idempotent calls on 5xx with exponential backoff and full jitter", async () => {
    const { client, fetch, sleeps } = setup([{ status: 503 }, { status: 502 }, ok], { random: () => 0.5 });
    const response = await client.request({ operation: "thing.get", method: "GET", path: "/things/1" });
    expect(response.status).toBe(200);
    expect(response.attempts).toBe(3);
    expect(fetch.requests).toHaveLength(3);
    expect(sleeps).toEqual([125, 250]);
  });

  it("caps backoff at the maximum delay", () => {
    const { client } = setup([], { random: () => 1 });
    expect(client.backoffMs(0)).toBe(250);
    expect(client.backoffMs(10)).toBe(4000);
  });

  it("does not retry a non-idempotent call on 5xx unless marked retry-safe", async () => {
    const unsafe = setup([{ status: 503 }]);
    expect((await unsafe.client.request({ operation: "transfer", method: "POST", path: "/transfer" })).status).toBe(503);
    expect(unsafe.fetch.requests).toHaveLength(1);

    const safe = setup([{ status: 503 }, ok]);
    expect((await safe.client.request({ operation: "lookup", method: "POST", path: "/lookup", retrySafe: true })).status).toBe(200);
    expect(safe.fetch.requests).toHaveLength(2);
  });

  it("retries 429 even for non-idempotent calls, honouring Retry-After", async () => {
    const { client, fetch, sleeps } = setup([{ status: 429, headers: { "retry-after": "2" } }, ok]);
    expect((await client.request({ operation: "transfer", method: "POST", path: "/transfer" })).status).toBe(200);
    expect(fetch.requests).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it("returns the last response when retries are exhausted", async () => {
    const { client, fetch } = setup([{ status: 503 }, { status: 503 }, { status: 503 }]);
    const response = await client.request({ operation: "thing.get", method: "GET", path: "/x" });
    expect(response).toMatchObject({ status: 503, ok: false, attempts: 3 });
    expect(fetch.remaining()).toBe(0);
  });

  it("throws ProviderDownError after network failures and timeouts", async () => {
    const network = setup([{ error: new TypeError("fetch failed") }, { error: new TypeError("fetch failed") }, { error: new TypeError("fetch failed") }]);
    await expect(network.client.request({ operation: "thing.get", method: "GET", path: "/x" })).rejects.toBeInstanceOf(ProviderDownError);
    expect(network.fetch.requests).toHaveLength(3);

    const slow = setup([{ hang: true }], { timeoutMs: 20 });
    await expect(slow.client.request({ operation: "transfer", method: "POST", path: "/x" })).rejects.toThrow(/timed out after 20 ms/);
  });

  it("opens the circuit after consecutive failures and fails fast", async () => {
    const breaker = new CircuitBreaker("acme-open", { failureThreshold: 2, openMs: 60_000 });
    const { client, fetch } = setup([{ status: 500 }, { status: 500 }], { breaker });
    await client.request({ operation: "a", method: "POST", path: "/a" });
    await client.request({ operation: "a", method: "POST", path: "/a" });
    expect(breaker.currentState).toBe("OPEN");
    const error = await client.request({ operation: "a", method: "POST", path: "/a" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderDownError);
    expect((error as ProviderDownError).retryAfterMs).toBeGreaterThan(0);
    expect(fetch.requests).toHaveLength(2);
  });

  it("does not count client errors against the circuit", async () => {
    const breaker = new CircuitBreaker("acme-4xx", { failureThreshold: 1 });
    const { client } = setup([{ status: 400 }, { status: 404 }, { status: 401 }], { breaker });
    for (let i = 0; i < 3; i++) await client.request({ operation: "a", method: "POST", path: "/a" });
    expect(breaker.currentState).toBe("CLOSED");
  });

  it("logs structured events without secrets or identifiers", async () => {
    const { client, logs } = setup([{ status: 503 }, ok]);
    await client.request({ operation: "gstin.verify", method: "GET", path: "/gstin/27AAPFP9005H1Z6", requestId: "req-log" });
    const serialised = JSON.stringify(logs);
    expect(logs.map((l) => l.level)).toEqual(["warn", "info"]);
    expect(logs[1]!.fields).toMatchObject({ provider: "acme", operation: "gstin.verify", requestId: "req-log", status: 200, attempts: 2 });
    expect(serialised).not.toContain("27AAPFP9005H1Z6");
    expect(serialised).not.toContain("super-secret-key");
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds and HTTP dates", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});
