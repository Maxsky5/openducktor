import { describe, expect, test } from "bun:test";
import path from "node:path";
import { Cause, Chunk, Effect, Exit } from "effect";
import { runElectronEffect } from "../src/effect/electron-boundary";
import { ElectronOperationError } from "../src/effect/electron-errors";
import {
  closeRendererServer,
  type ElectronDevProcessHandlers,
  electronGracefulShutdownSignal,
  electronRuntimeEnv,
  mainEffect,
  resolveMacosAppBundlePath,
  resolveMacosDevExecutablePath,
  resolveRendererDevPort,
  resolveRequiredMacosAppBundlePath,
  runElectronDevLifecycleEffect,
  shouldRestartElectronForChange,
  stopElectronEffect,
} from "./dev";

const createFakeProcessHandlers = () => {
  const registered: Array<{ event: string; listener: () => void }> = [];
  const removed: Array<{ event: string; listener: () => void }> = [];
  const processHandlers: ElectronDevProcessHandlers = {
    off(event, listener) {
      removed.push({ event, listener });
    },
    once(event, listener) {
      registered.push({ event, listener });
    },
  };

  return {
    processHandlers,
    registered,
    removed,
  };
};

describe("electron dev script", () => {
  test("uses the default renderer dev server port", () => {
    expect(resolveRendererDevPort(undefined)).toBe(1430);
    expect(resolveRendererDevPort("   ")).toBe(1430);
  });

  test("parses the explicit renderer dev server port", () => {
    expect(resolveRendererDevPort("1540")).toBe(1540);
  });

  test("rejects malformed renderer dev server ports", () => {
    expect(() => resolveRendererDevPort("1430abc")).toThrow(
      "ELECTRON_RENDERER_DEV_PORT must be a TCP port between 1 and 65535: 1430abc",
    );
    expect(() => resolveRendererDevPort("0")).toThrow(
      "ELECTRON_RENDERER_DEV_PORT must be a TCP port between 1 and 65535: 0",
    );
    expect(() => resolveRendererDevPort("-1")).toThrow(
      "ELECTRON_RENDERER_DEV_PORT must be a TCP port between 1 and 65535: -1",
    );
    expect(() => resolveRendererDevPort("70000")).toThrow(
      "ELECTRON_RENDERER_DEV_PORT must be a TCP port between 1 and 65535: 70000",
    );
  });

  test("uses typed errors for malformed renderer dev server ports", () => {
    const error = (() => {
      try {
        resolveRendererDevPort("0");
      } catch (caught) {
        return caught;
      }
      throw new Error("Expected resolveRendererDevPort to fail.");
    })();

    expect(error).toMatchObject({
      _tag: "ElectronValidationError",
      operation: "electron.dev.resolve-renderer-dev-port",
      field: "ELECTRON_RENDERER_DEV_PORT",
    });
  });

  test("keeps invalid renderer dev port in the main Effect failure channel", async () => {
    const originalPort = process.env.ELECTRON_RENDERER_DEV_PORT;
    process.env.ELECTRON_RENDERER_DEV_PORT = "0";

    try {
      const exit = await Effect.runPromiseExit(mainEffect());
      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) {
        throw new Error("Expected mainEffect to fail for an invalid renderer dev port.");
      }

      const failureOption = Chunk.head(Cause.failures(exit.cause));
      expect(failureOption._tag).toBe("Some");
      if (failureOption._tag !== "Some") {
        throw new Error("Expected mainEffect to fail through the typed error channel.");
      }

      expect(failureOption.value).toMatchObject({
        _tag: "ElectronValidationError",
        operation: "electron.dev.resolve-renderer-dev-port",
        field: "ELECTRON_RENDERER_DEV_PORT",
      });
      expect(Chunk.isEmpty(Cause.defects(exit.cause))).toBe(true);
    } finally {
      if (originalPort === undefined) {
        delete process.env.ELECTRON_RENDERER_DEV_PORT;
      } else {
        process.env.ELECTRON_RENDERER_DEV_PORT = originalPort;
      }
    }
  });

  test("does not launch Electron in Node compatibility mode", () => {
    expect(
      electronRuntimeEnv({
        ELECTRON_RUN_AS_NODE: "1",
        PATH: "/usr/bin",
      }),
    ).toEqual({ PATH: "/usr/bin" });
  });

  test("resolves the macOS Electron app bundle from the executable path", () => {
    expect(
      resolveMacosAppBundlePath(
        "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
      ),
    ).toBe("/repo/node_modules/electron/dist/Electron.app");
    expect(resolveMacosAppBundlePath("/repo/node_modules/.bin/electron")).toBeNull();
  });

  test("fails with a typed error when the macOS Electron executable is outside an app bundle", () => {
    const error = (() => {
      try {
        resolveRequiredMacosAppBundlePath("/repo/node_modules/.bin/electron");
      } catch (caught) {
        return caught;
      }
      throw new Error("Expected resolveRequiredMacosAppBundlePath to fail.");
    })();

    expect(error).toMatchObject({
      _tag: "ElectronOperationError",
      operation: "electron.dev.resolve-macos-app-bundle",
      path: "/repo/node_modules/.bin/electron",
    });
  });

  test("resolves the OpenDucktor macOS dev executable inside the copied app bundle", () => {
    expect(
      resolveMacosDevExecutablePath(
        "/repo/apps/electron/.electron-dev/OpenDucktor.app",
        "Electron",
      ),
    ).toBe("/repo/apps/electron/.electron-dev/OpenDucktor.app/Contents/MacOS/Electron");
  });

  test("requests interrupt-driven Electron shutdown on Windows", () => {
    expect(electronGracefulShutdownSignal("win32")).toBe("SIGINT");
    expect(electronGracefulShutdownSignal("darwin")).toBe("SIGTERM");
    expect(electronGracefulShutdownSignal("linux")).toBe("SIGTERM");
  });

  test("restarts Electron for main-process dependencies", () => {
    const roots = [
      "/repo/apps/electron/src/main",
      "/repo/apps/electron/src/preload",
      "/repo/apps/electron/src/shared",
      "/repo/packages/contracts/src",
      "/repo/packages/core/src",
      "/repo/packages/host/src",
    ];

    expect(shouldRestartElectronForChange("/repo/apps/electron/src/main/main.ts", roots)).toBe(
      true,
    );
    expect(
      shouldRestartElectronForChange("/repo/apps/electron/src/preload/preload.ts", roots),
    ).toBe(true);
    expect(
      shouldRestartElectronForChange("/repo/apps/electron/src/shared/contract.ts", roots),
    ).toBe(true);
    expect(shouldRestartElectronForChange("/repo/packages/host/src/index.ts", roots)).toBe(true);
    expect(shouldRestartElectronForChange("/repo/packages/contracts/src/index.ts", roots)).toBe(
      true,
    );
    expect(shouldRestartElectronForChange("/repo/packages/core/src/index.ts", roots)).toBe(true);
  });

  test("leaves renderer-only packages to Vite HMR", () => {
    const roots = [
      "/repo/apps/electron/src/main",
      "/repo/apps/electron/src/preload",
      "/repo/apps/electron/src/shared",
      "/repo/packages/contracts/src",
      "/repo/packages/core/src",
      "/repo/packages/host/src",
    ];

    expect(shouldRestartElectronForChange("/repo/apps/electron/src/renderer/app.tsx", roots)).toBe(
      false,
    );
    expect(shouldRestartElectronForChange("/repo/packages/frontend/src/App.tsx", roots)).toBe(
      false,
    );
    expect(shouldRestartElectronForChange("/repo/packages/host-client/src/index.ts", roots)).toBe(
      false,
    );
  });

  test("ignores unsupported file types inside restart roots", () => {
    expect(
      shouldRestartElectronForChange(path.join("/repo/packages/host/src", "README.md"), [
        "/repo/packages/host/src",
      ]),
    ).toBe(false);
  });

  test("forces open renderer connections while closing the Vite server", async () => {
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

    await closeRendererServer(rendererServer as never);

    expect(closeCalls).toBe(1);
    expect(closeIdleConnectionsCalls).toBe(1);
    expect(closeAllConnectionsCalls).toBe(1);
  });

  test("forces open renderer connections even when close throws synchronously", async () => {
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

    await expect(closeRendererServer(rendererServer as never)).rejects.toThrow(
      "renderer close failed",
    );
    expect(closeIdleConnectionsCalls).toBe(1);
    expect(closeAllConnectionsCalls).toBe(1);
  });

  test("keeps renderer shutdown bounded when close never resolves", async () => {
    let timeoutMs = 0;
    const rendererServer = {
      close: () => new Promise<void>(() => {}),
    };

    await closeRendererServer(rendererServer as never, async (durationMs) => {
      timeoutMs = durationMs;
    });

    expect(timeoutMs).toBe(3_000);
  });

  test("fails when Electron does not exit after forced shutdown", async () => {
    const signals: Array<NodeJS.Signals | number | undefined> = [];
    const electron = {
      exited: new Promise<number>(() => {}),
      kill(signal?: NodeJS.Signals | number) {
        signals.push(signal);
      },
    };

    const error = await runElectronEffect(
      stopElectronEffect(electron as never, async () => undefined),
    ).catch((caught: unknown) => caught);

    expect(signals).toEqual([electronGracefulShutdownSignal(process.platform), 9]);
    expect(error).toMatchObject({
      _tag: "ElectronOperationError",
      operation: "electron.dev.stop-electron",
    });
    expect((error as Error).message).toContain("Electron did not exit after forced shutdown");
  });

  test("runs the dev watcher and Electron process lifecycle as an Effect", async () => {
    const watchedRoots: string[][] = [];
    const watchedEvents: string[] = [];
    const startCalls: Array<{ executablePath: string; rendererDevUrl: string }> = [];
    const processHandlerFake = createFakeProcessHandlers();
    let buildCalls = 0;
    let closeCalls = 0;
    const rendererServer = {
      close: async () => {
        closeCalls += 1;
      },
      config: { server: { port: 1430 } },
      resolvedUrls: { local: ["http://127.0.0.1:1430/"] },
      watcher: {
        add(roots: string[]) {
          watchedRoots.push(roots);
        },
        on(event: string) {
          watchedEvents.push(event);
        },
      },
    };

    const exitCode = await runElectronEffect(
      runElectronDevLifecycleEffect({
        buildBundles: () =>
          Effect.sync(() => {
            buildCalls += 1;
          }),
        electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
        processHandlers: processHandlerFake.processHandlers,
        rendererDevUrl: "http://127.0.0.1:1430",
        rendererServer: rendererServer as never,
        startElectronProcess: (rendererDevUrl, electronExecutablePath) => {
          startCalls.push({ executablePath: electronExecutablePath, rendererDevUrl });
          return {
            exited: Promise.resolve(0),
            kill() {},
          } as never;
        },
      }),
    );

    expect(exitCode).toBe(0);
    expect(buildCalls).toBe(1);
    expect(startCalls).toEqual([
      {
        executablePath: "/repo/node_modules/electron/dist/Electron",
        rendererDevUrl: "http://127.0.0.1:1430",
      },
    ]);
    expect(watchedRoots).toHaveLength(1);
    expect(watchedEvents).toEqual(["add", "change", "unlink"]);
    expect(closeCalls).toBe(1);
    expect(processHandlerFake.registered.map(({ event }) => event)).toEqual([
      "SIGINT",
      "SIGTERM",
      "exit",
    ]);
    expect(processHandlerFake.removed.map(({ event }) => event)).toEqual([
      "exit",
      "SIGTERM",
      "SIGINT",
    ]);
  });

  test("keeps initial lifecycle setup failures in the typed failure channel", async () => {
    const processHandlerFake = createFakeProcessHandlers();
    const setupError = new ElectronOperationError({
      operation: "electron.dev.test-build",
      message: "build failed before launch",
    });
    const rendererServer = {
      close: async () => {},
      config: { server: { port: 1430 } },
      resolvedUrls: { local: ["http://127.0.0.1:1430/"] },
      watcher: {
        add() {},
        on() {},
      },
    };

    const exit = await Effect.runPromiseExit(
      runElectronDevLifecycleEffect({
        buildBundles: () => Effect.fail(setupError),
        electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
        processHandlers: processHandlerFake.processHandlers,
        rendererDevUrl: "http://127.0.0.1:1430",
        rendererServer: rendererServer as never,
        startElectronProcess: () => {
          throw new Error("Electron should not launch after setup failure.");
        },
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) {
      throw new Error("Expected initial lifecycle setup failure to fail the Effect.");
    }

    const failureOption = Chunk.head(Cause.failures(exit.cause));
    expect(failureOption._tag).toBe("Some");
    if (failureOption._tag !== "Some") {
      throw new Error("Expected setup failure in the typed failure channel.");
    }

    expect(failureOption.value).toBe(setupError);
    expect(processHandlerFake.removed.map(({ event }) => event)).toEqual([
      "exit",
      "SIGTERM",
      "SIGINT",
    ]);
  });
});
