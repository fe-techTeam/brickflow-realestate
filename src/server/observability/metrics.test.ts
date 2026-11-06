import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRequestContext } from "./context";
import { installHttpInstrumentation, routeGroup } from "./http";
import { setLogSink, type LogRecord } from "./logger";
import { Counter, Gauge, Histogram, httpRequestDuration, httpRequestsTotal, Registry, renderGauge } from "./metrics";
import { resolveRequestId } from "./request-id";
import { renderRuntimeMetrics } from "./runtime-metrics";

describe("Prometheus registry", () => {
  it("renders counters with escaped labels", () => {
    const counter = new Counter("demo_total", "A demo counter.\nSecond line");
    counter.inc({ path: 'a"b\\c\nd' });
    counter.inc({ path: 'a"b\\c\nd' }, 2);
    expect(counter.render()).toEqual(["# HELP demo_total A demo counter.\\nSecond line", "# TYPE demo_total counter", 'demo_total{path="a\\"b\\\\c\\nd"} 3']);
    expect(() => counter.inc({}, -1)).toThrow();
  });

  it("renders cumulative histogram buckets, sum and count", () => {
    const histogram = new Histogram("latency_seconds", "Latency.", [0.1, 0.5, 1]);
    for (const v of [0.05, 0.2, 0.7, 3]) histogram.observe({ route: "x" }, v);
    expect(histogram.render()).toEqual([
      "# HELP latency_seconds Latency.",
      "# TYPE latency_seconds histogram",
      'latency_seconds_bucket{route="x",le="0.1"} 1',
      'latency_seconds_bucket{route="x",le="0.5"} 2',
      'latency_seconds_bucket{route="x",le="1"} 3',
      'latency_seconds_bucket{route="x",le="+Inf"} 4',
      'latency_seconds_sum{route="x"} 3.95',
      'latency_seconds_count{route="x"} 4',
    ]);
  });

  it("returns the existing metric on re-registration and rejects type clashes and bad names", () => {
    const registry = new Registry();
    const first = registry.counter("jobs_total", "Jobs.");
    expect(registry.counter("jobs_total", "Jobs.")).toBe(first);
    expect(() => registry.gauge("jobs_total", "Jobs.")).toThrow(/already registered/);
    expect(() => new Gauge("bad-name", "x")).toThrow(/Invalid metric name/);
    expect(() => new Gauge("ok", "x").set({ "bad-label": "1" }, 1)).toThrow(/Invalid metric label/);
  });

  it("renders gauges, including special values", () => {
    expect(renderGauge("g", "G.", [{ value: Number.POSITIVE_INFINITY }, { labels: { a: "1" }, value: 2 }])).toBe('# HELP g G.\n# TYPE g gauge\ng +Inf\ng{a="1"} 2');
  });

  it("renders process and runtime metrics", () => {
    const text = renderRuntimeMetrics({ service: "brickflow-web", version: "1.2.3" });
    for (const name of ["process_cpu_seconds_total", "process_resident_memory_bytes", "process_start_time_seconds", "nodejs_heap_size_used_bytes", "nodejs_eventloop_lag_seconds"]) {
      expect(text).toContain(`# TYPE ${name}`);
    }
    expect(text).toContain('brickflow_build_info{service="brickflow-web",version="1.2.3"');
  });
});

describe("routeGroup", () => {
  it.each([
    ["GET", "/", {}, "home"],
    ["GET", "/login?next=/admin", {}, "login"],
    ["GET", "/admin/audit?cursor=abc", {}, "admin"],
    ["GET", "/partner/invoices/123", {}, "partner"],
    ["POST", "/builder/invoices/1", { "next-action": "abc" }, "server_action"],
    ["GET", "/api/health", {}, "api_health"],
    ["GET", "/api/documents/invoices/x", {}, "api_documents"],
    ["GET", "/api/whatever/../../etc", {}, "api_other"],
    ["GET", "/_next/static/chunks/a.js", {}, "static"],
    ["GET", "/favicon.ico", {}, "static"],
    ["GET", "/random-path-from-a-scanner", {}, "other"],
  ] as const)("%s %s → %s", (method, url, headers, group) => {
    expect(routeGroup(method, url, headers)).toBe(group);
  });
});

describe("resolveRequestId", () => {
  it("keeps well-formed IDs and replaces anything else with a UUID", () => {
    expect(resolveRequestId("abc-123_DEF.456:7")).toBe("abc-123_DEF.456:7");
    for (const bad of [undefined, null, "", "short", "has space in it", "x".repeat(200), "evil\nline-break-0001"]) {
      expect(resolveRequestId(bad)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe("HTTP instrumentation", () => {
  let server: http.Server;
  let base: string;
  const records: LogRecord[] = [];
  let restore: () => void;

  beforeAll(async () => {
    installHttpInstrumentation();
    installHttpInstrumentation();
    restore = setLogSink((record) => records.push(record), "info");
    server = http.createServer((req, res) => {
      const context = getRequestContext();
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/api/health")) res.statusCode = 503;
      res.end(JSON.stringify({ requestId: context?.requestId ?? null, header: req.headers["x-request-id"] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("propagates a valid incoming request ID into the handler context, the request and the response", async () => {
    const response = await fetch(`${base}/admin/audit`, { headers: { "x-request-id": "edge-request-0001" } });
    expect(response.headers.get("x-request-id")).toBe("edge-request-0001");
    expect(await response.json()).toEqual({ requestId: "edge-request-0001", header: "edge-request-0001" });
  });

  it("generates an ID when none (or an invalid one) is sent", async () => {
    const response = await fetch(`${base}/partner`, { headers: { "x-request-id": "bad id" } });
    const id = response.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await response.json()).requestId).toBe(id);
  });

  it("counts requests and latency by route group and writes an access log line", async () => {
    const before = httpRequestsTotal.get({ route_group: "api_health", method: "GET", status_class: "5xx" });
    const histogramBefore = httpRequestDuration.snapshot({ route_group: "api_health", method: "GET" })?.count ?? 0;
    const response = await fetch(`${base}/api/health?probe=1`);
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(httpRequestsTotal.get({ route_group: "api_health", method: "GET", status_class: "5xx" })).toBe(before + 1);
    expect(httpRequestDuration.snapshot({ route_group: "api_health", method: "GET" })?.count).toBe(histogramBefore + 1);
    const line = records.find((r) => r.message === "http.request" && r.path === "/api/health");
    expect(line).toMatchObject({ level: "error", status: 503, routeGroup: "api_health", method: "GET" });
    expect(line?.requestId).toBe(response.headers.get("x-request-id"));
    expect(String(line?.path)).not.toContain("probe");
  });
});
