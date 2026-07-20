import { describe, expect, test } from "bun:test";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, type Server } from "node:net";
import { Effect } from "effect";
import { isOpenCodeHealthy, pickFreePort } from "./opencode-local-port";

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
    const server = createTcpServer();
    try {
      await listen(server, port);
      expect(server.listening).toBe(true);
    } finally {
      if (server.listening) {
        await close(server);
      }
    }
  });

  test("waits for the OpenCode health contract instead of accepting a bare TCP socket", async () => {
    const server = createHttpServer((_request, response) => {
      response.writeHead(503);
      response.end();
    });
    try {
      const port = await listen(server);
      await expect(Effect.runPromise(isOpenCodeHealthy(port, 50))).resolves.toBe(false);
    } finally {
      if (server.listening) {
        await close(server);
      }
    }
  });

  test("recognizes the official OpenCode health response", async () => {
    const server = createHttpServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ healthy: true, version: "1.17.18" }));
    });
    try {
      const port = await listen(server);
      await expect(Effect.runPromise(isOpenCodeHealthy(port, 250))).resolves.toBe(true);
    } finally {
      if (server.listening) {
        await close(server);
      }
    }
  });
});
