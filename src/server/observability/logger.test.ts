import { afterEach, describe, expect, it } from "vitest";
import { runWithRequestContext, setRequestActor } from "./context";
import { logger, setLogSink, type LogRecord } from "./logger";
import { maskGstin, redact, REDACTED, scrubText } from "./redact";

let restore: (() => void) | undefined;

function capture(level: "debug" | "info" | "warn" | "error" = "debug") {
  const records: LogRecord[] = [];
  const lines: string[] = [];
  restore = setLogSink((record, line) => {
    records.push(record);
    lines.push(line);
  }, level);
  return { records, lines };
}

afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("logger", () => {
  it("writes one JSON line with level, time, message, service and version", () => {
    const { records, lines } = capture();
    logger.info("invoice.submitted", { invoiceId: "inv_1", amountPaise: 50_000_00n });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toMatchObject({ level: "info", message: "invoice.submitted", service: "brickflow-web", invoiceId: "inv_1", amountPaise: "5000000" });
    expect(parsed.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(new Date(parsed.time).toISOString()).toBe(parsed.time);
    expect(records[0]!.requestId).toBeUndefined();
  });

  it("adds the request ID and actor ID from the request context", () => {
    const { records } = capture();
    runWithRequestContext({ requestId: "req-12345678" }, () => {
      logger.info("before.login");
      setRequestActor("user_42");
      logger.warn("after.login");
    });
    logger.info("outside");
    expect(records[0]).toMatchObject({ requestId: "req-12345678" });
    expect(records[0]!.actorId).toBeUndefined();
    expect(records[1]).toMatchObject({ requestId: "req-12345678", actorId: "user_42", level: "warn" });
    expect(records[2]!.requestId).toBeUndefined();
  });

  it("honours the level threshold", () => {
    const { records } = capture("warn");
    logger.debug("hidden");
    logger.info("hidden");
    logger.warn("shown");
    logger.error("shown");
    expect(records.map((r) => r.level)).toEqual(["warn", "error"]);
  });

  it("serialises errors with name, message, stack and cause, scrubbing credentials", () => {
    const { records } = capture();
    const cause = new Error("socket hang up");
    const error = new Error("connect ECONNREFUSED postgresql://brickflow:s3cret@db:5432/brickflow", { cause });
    logger.error("db.failed", { err: error });
    logger.error("db.failed.direct", error);
    for (const record of records) {
      const err = record.err as Record<string, unknown>;
      expect(err.name).toBe("Error");
      expect(err.message).toContain(`postgresql://brickflow:${REDACTED}@db`);
      expect(JSON.stringify(record)).not.toContain("s3cret");
      expect((err.cause as Record<string, unknown>).message).toBe("socket hang up");
      expect(typeof err.stack).toBe("string");
    }
  });

  it("cannot overwrite reserved fields", () => {
    const { records } = capture();
    runWithRequestContext({ requestId: "req-abcdefgh" }, () => logger.info("ok", { level: "error", requestId: "spoofed", service: "x" }));
    expect(records[0]).toMatchObject({ level: "info", requestId: "req-abcdefgh", service: "brickflow-web" });
  });

  it("child loggers add bindings", () => {
    const { records } = capture();
    logger.child({ component: "settlements" }).info("tick", { count: 2 });
    expect(records[0]).toMatchObject({ component: "settlements", count: 2 });
  });

  it("never throws when the sink fails", () => {
    restore = setLogSink(() => {
      throw new Error("disk full");
    });
    expect(() => logger.error("still fine")).not.toThrow();
  });
});

describe("redact", () => {
  it("removes secrets by key, case- and separator-insensitively", () => {
    const out = redact({
      password: "hunter2",
      Authorization: "Bearer abc.def.ghi",
      cookie: "bf_session=xyz",
      "set-cookie": ["a=b"],
      AUTH_SECRET: "s",
      refresh_token: "t",
      apiKey: "k",
      nested: { sessionToken: "x", keep: "visible" },
      otp: "123456",
    }) as Record<string, unknown>;
    expect(out).toEqual({
      password: REDACTED,
      Authorization: REDACTED,
      cookie: REDACTED,
      "set-cookie": REDACTED,
      AUTH_SECRET: REDACTED,
      refresh_token: REDACTED,
      apiKey: REDACTED,
      nested: { sessionToken: REDACTED, keep: "visible" },
      otp: REDACTED,
    });
  });

  it("redacts PAN, masks account numbers to the last four and GSTIN partially", () => {
    const out = redact({
      pan: "ABCPE1234F",
      accountNumber: "001234567890",
      bank_account_number: "998877665544",
      gstin: "27ABCPE1234F1Z5",
      contactEmail: "rahul.mehta@example.com",
      phone: "+91 98200 12345",
    }) as Record<string, unknown>;
    expect(out.pan).toBe(REDACTED);
    expect(out.accountNumber).toBe("********7890");
    expect(out.bank_account_number).toBe("********5544");
    expect(out.gstin).toBe("27**********1Z5");
    expect(out.contactEmail).toBe("r***@example.com");
    expect(out.phone).toBe("*********2345");
  });

  it("keeps null and undefined values of sensitive keys as they are", () => {
    expect(redact({ pan: null, password: undefined })).toEqual({ pan: null });
  });

  it("scrubs secrets and identifiers inside free text", () => {
    const text = scrubText("token Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig for GSTIN 27ABCPE1234F1Z5 PAN ABCPE1234F at https://u:p@host/x");
    expect(text).not.toContain("eyJ");
    expect(text).toContain(`Bearer ${REDACTED}`);
    expect(text).toContain("27**********1Z5");
    expect(text).not.toContain("ABCPE1234F");
    expect(text).toContain(`https://u:${REDACTED}@host/x`);
  });

  it("handles BigInt, Date, Map, Set, binary, cycles and depth", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 10; i++) deep = { deep };
    const out = redact({
      amount: 10n,
      at: new Date("2026-11-06T10:00:00.000Z"),
      map: new Map([["password", "x"]]),
      set: new Set([1, 2]),
      bytes: new Uint8Array(4),
      cyclic,
      deep,
      fn: () => 1,
      nan: Number.NaN,
    }) as Record<string, unknown>;
    expect(out.amount).toBe("10");
    expect(out.at).toBe("2026-11-06T10:00:00.000Z");
    expect(out.map).toEqual({ password: REDACTED });
    expect(out.set).toEqual([1, 2]);
    expect(out.bytes).toBe("[Binary 4 bytes]");
    expect((out.cyclic as Record<string, unknown>).self).toBe("[Circular]");
    expect(JSON.stringify(out.deep)).toContain("[Truncated]");
    expect("fn" in out).toBe(false);
    expect(out.nan).toBe("NaN");
  });

  it("masks short GSTIN-like values entirely", () => {
    expect(maskGstin("27AB")).toBe("****");
  });
});
