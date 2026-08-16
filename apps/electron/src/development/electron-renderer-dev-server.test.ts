import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { closeRendererServerEffect, resolveRendererDevUrl } from "./electron-renderer-dev-server";

describe("Electron renderer dev server", () => {
  test("resolves the URL that Vite reports for its assigned port", () => {
    const url = resolveRendererDevUrl({
      close: async () => {},
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

    await Effect.runPromise(closeRendererServerEffect(rendererServer));

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

    await expect(Effect.runPromise(closeRendererServerEffect(rendererServer))).rejects.toThrow(
      "renderer close failed",
    );
    expect(closeIdleConnectionsCalls).toBe(1);
    expect(closeAllConnectionsCalls).toBe(1);
  });

  test("fails when Vite does not report the local renderer URL", () => {
    expect(() =>
      resolveRendererDevUrl({
        close: async () => {},
        resolvedUrls: { local: [] },
        watcher: { add() {}, on() {} },
      }),
    ).toThrow("Vite renderer dev server did not report a local URL");
  });
});
