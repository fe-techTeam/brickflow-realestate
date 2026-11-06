/** Scripted fetch for connector tests: records every request and replays queued responses in order. */

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type ScriptedReply = { status: number; body?: unknown; headers?: Record<string, string> } | { error: Error } | { hang: true };

export function fakeFetch(replies: ScriptedReply[]) {
  const requests: RecordedRequest[] = [];
  const queue = [...replies];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
    const raw = typeof init?.body === "string" ? init.body : undefined;
    requests.push({ url: String(input), method: init?.method ?? "GET", headers, body: raw ? JSON.parse(raw) : undefined });
    const reply = queue.shift();
    if (!reply) throw new Error(`Unexpected request to ${String(input)}`);
    if ("error" in reply) throw reply.error;
    if ("hang" in reply) {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    }
    const text = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status, headers: { "content-type": "application/json", ...reply.headers } });
  }) as typeof fetch;
  return { impl, requests, remaining: () => queue.length };
}

export const noSleep = async () => undefined;
