import { describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { Effect } from "effect";
import { canConnect, pickFreePort } from "./opencode-local-port";

const listen = (server: Server, port = 0): Promise<number> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("server did not expose a TCP address"));
        return;
      }
      resolve(address.port);
    });
  });

const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

describe("opencode-local-port", () => {
  test("allocates a reusable local TCP port", async () => {
    const port = await Effect.runPromise(pickFreePort());
    const server = createServer();
    try {
      await listen(server, port);
      expect(server.listening).toBe(true);
    } finally {
      if (server.listening) {
        await close(server);
      }
    }
  });

  test("probes local TCP connectivity", async () => {
    const server = createServer();
    try {
      const port = await listen(server);
      await expect(Effect.runPromise(canConnect(port, 250))).resolves.toBe(true);
    } finally {
      if (server.listening) {
        await close(server);
      }
    }
  });
});
