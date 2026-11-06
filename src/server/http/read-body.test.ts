import { describe, expect, it } from "vitest";
import { BodyTooLargeError, readBodyWithLimit } from "./read-body";

const CHUNK = 64 * 1024;

/** An endless chunked body that records how much was pulled and whether it was cancelled. */
function endlessStream() {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulled += 1;
        controller.enqueue(new Uint8Array(CHUNK).fill(97));
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

function request(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/webhooks/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);
}

describe("readBodyWithLimit", () => {
  it("returns a body under the limit, joined from its chunks", async () => {
    const chunks = ["{\"a\":", "1", "}"].map((s) => new TextEncoder().encode(s));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
    const body = await readBodyWithLimit(request(stream), 1024);
    expect(new TextDecoder().decode(body)).toBe('{"a":1}');
  });

  it("stops reading a chunked body as soon as it passes the limit, without buffering the rest", async () => {
    const { stream, state } = endlessStream();
    const limit = 1024 * 1024;
    await expect(readBodyWithLimit(request(stream), limit)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(state.cancelled).toBe(true);
    // Just past the limit: 16 chunks fit, the 17th overflows.
    expect(state.pulled).toBeLessThanOrEqual(limit / CHUNK + 2);
  });

  it("does not trust a Content-Length that understates the body", async () => {
    const { stream, state } = endlessStream();
    await expect(readBodyWithLimit(request(stream, { "content-length": "10" }), 100_000)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(state.cancelled).toBe(true);
  });

  it("rejects a declared oversize body before reading it", async () => {
    const { stream, state } = endlessStream();
    await expect(readBodyWithLimit(request(stream, { "content-length": String(10 * 1024 * 1024) }), 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(state.pulled).toBe(0);
  });

  it("treats a missing body as empty", async () => {
    expect(await readBodyWithLimit(new Request("http://localhost/x"), 10)).toEqual(new Uint8Array(0));
  });
});
