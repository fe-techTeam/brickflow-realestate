import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { db } from "@/server/db";
import { setLogSink, type LogRecord } from "@/server/observability/logger";

let restoreSink: (() => void) | undefined;

afterEach(() => {
  restoreSink?.();
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("reports ok when the database answers", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("returns 503 without leaking error details when the database is unavailable", async () => {
    vi.spyOn(db, "$queryRaw").mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432 (postgresql://brickflow:secret@db/brickflow)"));
    const logs: LogRecord[] = [];
    restoreSink = setLogSink((record) => logs.push(record));

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ status: "error", db: "unavailable" });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: "error", message: "health.database_unavailable" });
    expect(JSON.stringify(logs)).not.toContain("secret");
  });
});
