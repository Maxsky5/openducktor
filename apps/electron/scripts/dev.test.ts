import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  closeRendererServer,
  electronGracefulShutdownSignal,
  electronRuntimeEnv,
  resolveMacosAppBundlePath,
  resolveMacosDevExecutablePath,
  resolveRendererDevPort,
  shouldRestartElectronForChange,
} from "./dev";

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
    expect(() => resolveRendererDevPort("70000")).toThrow(
      "ELECTRON_RENDERER_DEV_PORT must be a TCP port between 1 and 65535: 70000",
    );
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
});
