import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { db } from "@/server/db";

afterEach(() => {
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
    vi.spyOn(db, "$queryRaw").mockRejectedValue(new Error("SQLITE_CANTOPEN: unable to open /secret/path/brickflow.db"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ status: "error", db: "unavailable" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
