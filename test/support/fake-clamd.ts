import { createServer, type AddressInfo, type Socket } from "node:net";

export type FakeClamdBehaviour = "clean" | "infected" | "error" | "silent";

export interface FakeClamd {
  port: number;
  /** Bytes received through INSTREAM, once the terminating chunk arrived. */
  received: () => Buffer | null;
  close: () => Promise<void>;
}

const REPLIES: Record<Exclude<FakeClamdBehaviour, "silent">, string> = {
  clean: "stream: OK\0",
  infected: "stream: Eicar-Test-Signature FOUND\0",
  error: "INSTREAM size limit exceeded. ERROR\0",
};

/** A clamd stand-in that decodes the INSTREAM framing and answers like the real daemon. */
export async function startFakeClamd(behaviour: FakeClamdBehaviour): Promise<FakeClamd> {
  let payload: Buffer | null = null;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const command = "zINSTREAM\0";
      if (buffer.length < command.length) return;
      if (buffer.subarray(0, command.length).toString() !== command) {
        socket.end("UNKNOWN COMMAND\0");
        return;
      }
      const parts: Buffer[] = [];
      let offset = command.length;
      while (offset + 4 <= buffer.length) {
        const size = buffer.readUInt32BE(offset);
        if (size === 0) {
          payload = Buffer.concat(parts);
          if (behaviour !== "silent") socket.end(REPLIES[behaviour]);
          return;
        }
        if (offset + 4 + size > buffer.length) return;
        parts.push(buffer.subarray(offset + 4, offset + 4 + size));
        offset += 4 + size;
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    received: () => payload,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
