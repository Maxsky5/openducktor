import { describe, expect, test } from "bun:test";
import path from "node:path";
import { electronRuntimeEnv, resolveRendererDevPort, shouldRestartElectronForChange } from "./dev";

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
});
