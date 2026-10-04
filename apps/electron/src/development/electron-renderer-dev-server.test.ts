import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { closeRendererServerEffect } from "./electron-renderer-dev-server";

const createRendererServer = (events: string[], closeError?: Error) => ({
  close: async () => {
    events.push("close-vite");
  },
  httpServer: {
    closeAllConnections: () => {
      events.push("close-connections");
    },
    close(callback: (error?: Error) => void) {
      events.push("close-http-server");
      callback(closeError);
      return this;
    },
  },
});

describe("Electron renderer dev server", () => {
  test("stops the HTTP server that the dev script owns, ends its connections, then closes Vite", async () => {
    const events: string[] = [];

    await Effect.runPromise(closeRendererServerEffect(createRendererServer(events)));

    expect(events).toEqual(["close-http-server", "close-connections", "close-vite"]);
  });

  test("fails when the HTTP server cannot close", async () => {
    const events: string[] = [];

    await expect(
      Effect.runPromise(
        closeRendererServerEffect(createRendererServer(events, new Error("close failed"))),
      ),
    ).rejects.toThrow("close failed");
  });
});
