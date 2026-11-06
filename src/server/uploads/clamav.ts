/**
 * Minimal clamd client using the INSTREAM command over TCP (no dependencies).
 * Protocol: "zINSTREAM\0", then chunks of <4-byte big-endian length><bytes>, then a zero-length
 * chunk; clamd replies "stream: OK", "stream: <signature> FOUND" or "<message> ERROR".
 */
import { Socket } from "node:net";

export interface ClamavConfig {
  host: string;
  port: number;
  timeoutMs: number;
}

export type ClamavResult = { clean: true } | { clean: false; signature: string };

export class ClamavUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClamavUnavailableError";
  }
}

const CHUNK_BYTES = 64 * 1024;

/** Scanner configuration, or null when scanning is disabled (CLAMAV_HOST unset). */
export function clamavConfigFromEnv(env: Record<string, string | undefined> = process.env): ClamavConfig | null {
  const host = env.CLAMAV_HOST?.trim();
  if (!host) return null;
  const port = Number.parseInt(env.CLAMAV_PORT ?? "", 10);
  const timeout = Number.parseInt(env.CLAMAV_TIMEOUT_MS ?? "", 10);
  return {
    host,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3310,
    timeoutMs: Number.isInteger(timeout) && timeout > 0 ? timeout : 15_000,
  };
}

export function parseClamdReply(reply: string): ClamavResult {
  const text = reply.replace(/\0/g, "").trim();
  if (/^(stream: )?OK$/.test(text)) return { clean: true };
  const found = text.match(/^(?:stream: )?(.+) FOUND$/);
  if (found) return { clean: false, signature: found[1]!.trim() };
  throw new ClamavUnavailableError(`Unexpected scanner reply: ${text.slice(0, 200) || "(empty)"}`);
}

/** Streams the bytes to clamd and resolves with its verdict. Rejects with ClamavUnavailableError on any transport failure. */
export function scanWithClamd(bytes: Uint8Array, config: ClamavConfig): Promise<ClamavResult> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const received: Buffer[] = [];
    let settled = false;

    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      outcome();
    };
    const fail = (message: string) => finish(() => reject(new ClamavUnavailableError(message)));

    socket.setTimeout(config.timeoutMs);
    socket.on("timeout", () => fail(`Scanner did not respond within ${config.timeoutMs} ms`));
    socket.on("error", (error) => fail(`Scanner connection failed: ${error.message}`));
    socket.on("data", (chunk: Buffer) => {
      received.push(chunk);
      if (chunk.includes(0)) socket.end();
    });
    socket.on("close", () => {
      if (settled) return;
      const reply = Buffer.concat(received).toString("utf8");
      if (!reply) return fail("Scanner closed the connection without a reply");
      try {
        const result = parseClamdReply(reply);
        finish(() => resolve(result));
      } catch (error) {
        finish(() => reject(error));
      }
    });

    socket.connect(config.port, config.host, () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
        const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.byteLength));
        const header = Buffer.alloc(4);
        header.writeUInt32BE(chunk.byteLength, 0);
        socket.write(header);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
