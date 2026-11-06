import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as metricsGET } from "@/app/api/metrics/route";
import { GET as readyGET } from "@/app/api/ready/route";
import { db } from "@/server/db";
import { setLogSink, type LogRecord } from "@/server/observability/logger";
import { metricsAccess } from "@/server/observability/metrics-endpoint";
import { checkMigrations, defaultMigrationsDir, evaluateReadiness, listBundledMigrations, resetReadinessCache } from "@/server/observability/readiness";
import { storage } from "@/server/storage";

const TOKEN = "metrics-token-for-tests-0123456789abcdef";
let logs: LogRecord[];
let restoreSink: () => void;

beforeEach(() => {
  logs = [];
  restoreSink = setLogSink((record) => logs.push(record), "debug");
  resetReadinessCache();
});

afterEach(() => {
  restoreSink();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function metricsRequest(authorization?: string) {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return new Request("http://localhost/api/metrics", { headers }) as Parameters<typeof metricsGET>[0];
}

function sample(text: string, series: string): number {
  const line = text.split("\n").find((l) => l.startsWith(`${series} `));
  if (!line) throw new Error(`series ${series} not found`);
  return Number(line.slice(series.length + 1));
}

describe("GET /api/ready", () => {
  it("is ready when the database answers, migrations are applied and storage is writable", async () => {
    const response = await readyGET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ready", checks: { database: "ok", migrations: "ok", storage: "ok", auditChain: "ok" } });
  });

  it("compares the bundled migration folders with _prisma_migrations", async () => {
    const bundled = await listBundledMigrations(defaultMigrationsDir());
    expect(bundled?.length).toBeGreaterThanOrEqual(2);
    expect(bundled).toContain("20261106120000_audit_hash_chain");

    const dir = await mkdtemp(path.join(os.tmpdir(), "bf-migrations-"));
    try {
      for (const name of bundled!) {
        await mkdir(path.join(dir, name));
        await writeFile(path.join(dir, name, "migration.sql"), "-- applied");
      }
      expect(await checkMigrations(dir)).toBe("ok");
      await mkdir(path.join(dir, "29991231000000_future"));
      await writeFile(path.join(dir, "29991231000000_future", "migration.sql"), "-- not applied");
      await mkdir(path.join(dir, "not_a_migration"));
      expect(await checkMigrations(dir)).toBe("pending");
      const report = await evaluateReadiness({ migrationsDir: dir });
      expect(report).toEqual({ ready: false, checks: { database: "ok", migrations: "pending", storage: "ok", auditChain: "fail" } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    expect(await checkMigrations(path.join(os.tmpdir(), "bf-does-not-exist"))).toBe("unknown");
  });

  it("is not ready while a migration has failed", async () => {
    await db.$executeRaw`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count)
      VALUES ('test-failed-migration', 'x', '29990101000000_failed', now(), 0)`;
    try {
      expect(await checkMigrations()).toBe("failed");
    } finally {
      await db.$executeRaw`DELETE FROM "_prisma_migrations" WHERE id = 'test-failed-migration'`;
    }
  });

  it("is not ready, naming the operator command, while the audit chain is unsealed or its state is tampered with", async () => {
    const state = await db.auditChainState.findUniqueOrThrow({ where: { id: 1 } });
    try {
      await db.auditChainState.update({ where: { id: 1 }, data: { legacySealedAt: null, keyId: null, signature: null } });
      const unsealed = await readyGET();
      expect(unsealed.status).toBe(503);
      const body = await unsealed.json();
      expect(body.checks.auditChain).toBe("unsealed");
      expect(body.reason).toContain("npm run audit:seal-legacy");
      expect(logs.some((l) => l.message === "readiness.audit_chain_unsealed" && l.level === "error")).toBe(true);

      resetReadinessCache();
      await db.auditChainState.update({ where: { id: 1 }, data: { ...state, legacyCutoffSeq: state.legacyCutoffSeq + 10n } });
      const tampered = await (await readyGET()).json();
      expect(tampered).toMatchObject({ status: "not_ready", checks: { auditChain: "broken" } });
      expect(tampered.reason).toBeUndefined();
    } finally {
      await db.auditChainState.update({ where: { id: 1 }, data: state });
    }
  });

  it("returns 503 without error details when the database is unreachable", async () => {
    vi.spyOn(db, "$queryRaw").mockRejectedValue(new Error("connect ECONNREFUSED postgresql://brickflow:secret@db/brickflow"));
    const response = await readyGET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ status: "not_ready", checks: { database: "fail", migrations: "fail", storage: "ok", auditChain: "fail" } });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(logs)).not.toContain("secret");
    expect(logs.some((l) => l.message === "readiness.check_failed" && l.check === "database")).toBe(true);
  });

  it("returns 503 when storage rejects writes and leaves no probe files behind", async () => {
    vi.spyOn(storage(), "put").mockRejectedValue(new Error("EROFS: read-only file system"));
    const response = await readyGET();
    expect(response.status).toBe(503);
    expect((await response.json()).checks.storage).toBe("fail");
  });
});

describe("GET /api/metrics", () => {
  it("does not exist unless METRICS_TOKEN is configured", async () => {
    vi.stubEnv("METRICS_TOKEN", "");
    expect((await metricsGET(metricsRequest(`Bearer ${TOKEN}`))).status).toBe(404);
  });

  it("stays disabled with a token that is too short", async () => {
    vi.stubEnv("METRICS_TOKEN", "short-token");
    expect((await metricsGET(metricsRequest("Bearer short-token"))).status).toBe(404);
  });

  it("requires the bearer token", async () => {
    vi.stubEnv("METRICS_TOKEN", TOKEN);
    for (const auth of [undefined, `Bearer ${TOKEN}x`, `Basic ${TOKEN}`, TOKEN, `Bearer ${TOKEN.slice(0, -1)}`]) {
      const response = await metricsGET(metricsRequest(auth));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
    }
    expect(metricsAccess(`bearer ${TOKEN}`, TOKEN)).toBe("granted");
  });

  it("exposes runtime, HTTP and business metrics in Prometheus text format", async () => {
    vi.stubEnv("METRICS_TOKEN", TOKEN);
    const response = await metricsGET(metricsRequest(`Bearer ${TOKEN}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain; version=0.0.4");
    const text = await response.text();

    for (const name of ["process_cpu_seconds_total", "process_resident_memory_bytes", "nodejs_heap_size_used_bytes", "http_requests_total", "http_request_duration_seconds"]) {
      expect(text).toContain(`# TYPE ${name}`);
    }

    const [invoiceGroups, requestGroups] = await Promise.all([
      db.invoice.groupBy({ by: ["status"], _count: { _all: true } }),
      db.financingRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    for (const g of invoiceGroups) expect(sample(text, `brickflow_invoices{status="${g.status}"}`)).toBe(g._count._all);
    expect(sample(text, 'brickflow_invoices{status="DRAFT"}')).toBe(invoiceGroups.find((g) => g.status === "DRAFT")?._count._all ?? 0);
    for (const g of requestGroups) expect(sample(text, `brickflow_financing_requests{status="${g.status}"}`)).toBe(g._count._all);

    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const overdue = await db.settlement.count({ where: { status: { not: "SETTLED" }, dueDate: { lt: startOfDay } } });
    expect(sample(text, "brickflow_settlements_overdue")).toBe(overdue);

    const oldestInvoice = await db.invoice.findFirst({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } }, orderBy: { submittedAt: "asc" } });
    const invoiceAge = sample(text, 'brickflow_oldest_pending_approval_age_seconds{queue="invoice"}');
    if (oldestInvoice?.submittedAt) expect(Math.abs(invoiceAge - (Date.now() - oldestInvoice.submittedAt.getTime()) / 1000)).toBeLessThan(60);
    else expect(invoiceAge).toBe(0);
    expect(text).toContain('brickflow_oldest_pending_approval_age_seconds{queue="financing"}');

    expect(sample(text, "brickflow_audit_log_entries")).toBe(await db.auditLog.count());
    expect(sample(text, "brickflow_business_metrics_up")).toBe(1);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("still serves runtime metrics when the business queries fail", async () => {
    vi.stubEnv("METRICS_TOKEN", TOKEN);
    vi.spyOn(db.invoice, "groupBy").mockRejectedValue(new Error("db down"));
    const text = await (await metricsGET(metricsRequest(`Bearer ${TOKEN}`))).text();
    expect(sample(text, "brickflow_business_metrics_up")).toBe(0);
    expect(text).toContain("# TYPE process_cpu_seconds_total counter");
    expect(logs.some((l) => l.message === "metrics.business_query_failed")).toBe(true);
  });
});
