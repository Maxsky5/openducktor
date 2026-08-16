import { describe, expect, test } from "bun:test";
import { closeRendererServer, resolveRendererDevUrl } from "./electron-renderer-dev-server";

describe("Electron renderer dev server", () => {
  test("resolves the URL that Vite reports for its assigned port", () => {
    const url = resolveRendererDevUrl({
      close: async () => {},
      config: { server: { port: 0 } },
      resolvedUrls: { local: ["http://127.0.0.1:49152/"] },
      watcher: { add() {}, on() {} },
    });

    expect(url).toBe("http://127.0.0.1:49152");
  });

  test("forces open renderer connections while closing Vite", async () => {
    let closeAllConnectionsCalls = 0;
    let closeIdleConnectionsCalls = 0;
    let closeCalls = 0;
    let resolveClose: () => void = () => {};
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const rendererServer = {
      httpServer: {
        closeAllConnections: () => {
          closeAllConnectionsCalls += 1;
          resolveClose();
        },
        closeIdleConnections: () => {
          closeIdleConnectionsCalls += 1;
        },
      },
      close: () => {
        closeCalls += 1;
        return closePromise;
      },
    };

    await closeRendererServer(rendererServer);

    expect(closeCalls).toBe(1);
    expect(closeIdleConnectionsCalls).toBe(1);
    expect(closeAllConnectionsCalls).toBe(1);
  });

  test("forces open renderer connections when close throws", async () => {
    let closeAllConnectionsCalls = 0;
    let closeIdleConnectionsCalls = 0;
    const rendererServer = {
      httpServer: {
        closeAllConnections: () => {
          closeAllConnectionsCalls += 1;
        },
        closeIdleConnections: () => {
          closeIdleConnectionsCalls += 1;
        },
      },
      close: () => {
        throw new Error("renderer close failed");
      },
    };

    await expect(closeRendererServer(rendererServer)).rejects.toThrow("renderer close failed");
    expect(closeIdleConnectionsCalls).toBe(1);
    expect(closeAllConnectionsCalls).toBe(1);
  });

  test("bounds renderer shutdown when close does not resolve", async () => {
    let timeoutMs = 0;
    const rendererServer = {
      close: () => new Promise<void>(() => {}),
    };

    await closeRendererServer(rendererServer, async (durationMs) => {
      timeoutMs = durationMs;
    });

    expect(timeoutMs).toBe(3_000);
  });
});
