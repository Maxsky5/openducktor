import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Cause, Chunk, Effect, Exit, Fiber } from "effect";
import type {
  ElectronDevRendererWatcher,
  ElectronRendererDevServer,
} from "../src/development/electron-renderer-dev-server";
import { runElectronEffect } from "../src/effect/electron-boundary";
import { ElectronOperationError } from "../src/effect/electron-errors";
import {
  ELECTRON_RESTART_WATCH_ROOTS,
  type ElectronDevProcessHandlers,
  electronDebugEndpointLogLine,
  electronDevServerLogLines,
  electronGracefulShutdownSignal,
  electronLaunchArgs,
  electronRuntimeEnv,
  macosDevAppRegistrationCommand,
  macosDevSignOptions,
  mainEffect,
  resolveMacosAppBundlePath,
  resolveMacosDevBundleIdentifier,
  resolveMacosDevExecutablePath,
  resolveRendererDevPort,
  resolveRequiredMacosAppBundlePath,
  runElectronDevLifecycleEffect,
  shouldEnableRemoteDebugging,
  shouldRestartElectronForChange,
  stopElectronEffect,
} from "./dev";

const isPathList = (paths: string | readonly string[]): paths is readonly string[] =>
  Array.isArray(paths);

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

const defaultWatcher: ElectronDevRendererWatcher = {
  add() {
    return defaultWatcher;
  },
  on() {
    return defaultWatcher;
  },
};

const createFakeRenderer = ({
  close = () => Effect.void,
  watcher = defaultWatcher,
}: Partial<
  Pick<ElectronRendererDevServer, "close" | "watcher">
> = {}): ElectronRendererDevServer => ({
  close,
  url: "http://127.0.0.1:1430",
  watcher,
});

describe("electron dev script", () => {
  test("uses the default renderer dev server port", () => {
    expect(resolveRendererDevPort(undefined)).toBe(0);
    expect(resolveRendererDevPort("   ")).toBe(0);
  });

  test("parses the explicit renderer dev server port", () => {
    expect(resolveRendererDevPort("1540")).toBe(1540);
  });

  test("rejects malformed renderer dev server ports", () => {
    expect(() => resolveRendererDevPort("1430abc")).toThrow(
      "ELECTRON_RENDERER_DEV_PORT must be an integer between 0 and 65535: 1430abc",
    );
    expect(resolveRendererDevPort("0")).toBe(0);
    expect(() => resolveRendererDevPort("-1")).toThrow(
      "ELECTRON_RENDERER_DEV_PORT must be an integer between 0 and 65535: -1",
    );
    expect(() => resolveRendererDevPort("70000")).toThrow(
      "ELECTRON_RENDERER_DEV_PORT must be an integer between 0 and 65535: 70000",
    );
  });

  test("reports the resolved renderer URL and development instance for copying", () => {
    const rendererDevUrl = "http://127.0.0.1:49152";

    expect(electronDevServerLogLines("electron-0123456789ab", rendererDevUrl)).toEqual([
      "[electron:dev] Development instance: electron-0123456789ab",
      "[electron:dev] Renderer URL: http://127.0.0.1:49152",
    ]);
  });

  test("reports the CDP endpoint when remote debugging is enabled", () => {
    expect(electronDebugEndpointLogLine(53_421)).toBe(
      "[electron:dev] CDP endpoint: http://127.0.0.1:53421",
    );
  });

  test("enables remote debugging only for the explicit CDP flag", () => {
    expect(shouldEnableRemoteDebugging(["--cdp"])).toBe(true);
    expect(shouldEnableRemoteDebugging(["bun", "scripts/dev.ts"])).toBe(false);
  });

  test("builds Electron launch arguments with a dynamic CDP port", () => {
    expect(electronLaunchArgs("/repo/node_modules/electron/dist/Electron", false)).toEqual([
      "/repo/node_modules/electron/dist/Electron",
      "dist/main.js",
    ]);
    expect(electronLaunchArgs("/repo/node_modules/electron/dist/Electron", true)).toEqual([
      "/repo/node_modules/electron/dist/Electron",
      "--remote-debugging-port=0",
      "dist/main.js",
    ]);
  });

  test("uses typed errors for malformed renderer dev server ports", () => {
    const error = (() => {
      try {
        resolveRendererDevPort("invalid");
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
    process.env.ELECTRON_RENDERER_DEV_PORT = "invalid";

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

  test("uses a stable macOS bundle identifier for each development worktree", () => {
    expect(resolveMacosDevBundleIdentifier("electron-0123456789ab")).toBe(
      "com.openducktor.app.dev.electron-0123456789ab",
    );
  });

  test("uses a complete ad-hoc signature for the macOS development app", () => {
    const devAppPath = "/repo/apps/electron/.electron-dev/OpenDucktor.app";
    const options = macosDevSignOptions(devAppPath);

    expect(options).toMatchObject({
      app: devAppPath,
      identity: "-",
      identityValidation: false,
      platform: "darwin",
    });
    expect(options.optionsForFile?.(devAppPath)).toEqual({
      hardenedRuntime: false,
      timestamp: "none",
    });
  });

  test("registers the signed macOS development app with LaunchServices", () => {
    const devAppPath = "/repo/apps/electron/.electron-dev/OpenDucktor.app";

    expect(macosDevAppRegistrationCommand(devAppPath)).toEqual([
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      "-f",
      devAppPath,
    ]);
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

  test("closes Electron and the renderer when the lifecycle receives SIGTERM", async () => {
    const fakeProcessHandlers = createFakeProcessHandlers();
    const killSignals: Array<NodeJS.Signals | number | undefined> = [];
    let closeCalls = 0;
    let markStarted: () => void = () => {};
    let resolveElectronExit: (exitCode: number) => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const electronExited = new Promise<number>((resolve) => {
      resolveElectronExit = resolve;
    });
    const renderer = createFakeRenderer({
      close: () =>
        Effect.sync(() => {
          closeCalls += 1;
        }),
    });

    const lifecycle = runElectronEffect(
      runElectronDevLifecycleEffect({
        buildBundles: () => Effect.void,
        electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
        processHandlers: fakeProcessHandlers.processHandlers,
        renderer,
        startElectronProcess: () => {
          markStarted();
          return {
            exited: electronExited,
            kill(signal?: NodeJS.Signals | number) {
              killSignals.push(signal);
              resolveElectronExit(0);
            },
          };
        },
      }),
    );
    await started;

    const shutdownHandler = fakeProcessHandlers.registered.find(({ event }) => event === "SIGTERM");
    if (!shutdownHandler) {
      throw new Error("Expected the Electron dev lifecycle to register SIGTERM.");
    }
    shutdownHandler.listener();

    expect(await lifecycle).toBe(143);
    expect(killSignals).toEqual([electronGracefulShutdownSignal(process.platform)]);
    expect(closeCalls).toBe(1);
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
      stopElectronEffect(electron, async () => undefined),
    ).catch((cause: unknown): Error =>
      cause instanceof Error ? cause : new Error(String(cause), { cause }),
    );

    expect(signals).toEqual([electronGracefulShutdownSignal(process.platform), 9]);
    expect(error).toMatchObject({
      _tag: "ElectronOperationError",
      operation: "electron.dev.stop-electron",
    });
    if (!(error instanceof Error)) {
      throw new TypeError("Expected an Error instance.");
    }
    expect(error.message).toContain("Electron did not exit after forced shutdown");
  });

  test("runs the dev watcher and Electron process lifecycle as an Effect", async () => {
    const watchedRoots: string[][] = [];
    const watchedEvents: string[] = [];
    const startCalls: Array<{
      executablePath: string;
      remoteDebugging: boolean;
      rendererDevUrl: string;
    }> = [];
    const fakeProcessHandlers = createFakeProcessHandlers();
    let buildCalls = 0;
    let closeCalls = 0;
    const watcher: ElectronDevRendererWatcher = {
      add(roots) {
        if (isPathList(roots)) {
          watchedRoots.push([...roots]);
        } else {
          watchedRoots.push([roots]);
        }
        return watcher;
      },
      on(event) {
        watchedEvents.push(event);
        return watcher;
      },
    };
    const renderer = createFakeRenderer({
      close: () =>
        Effect.sync(() => {
          closeCalls += 1;
        }),
      watcher,
    });

    const exitCode = await runElectronEffect(
      runElectronDevLifecycleEffect({
        buildBundles: () =>
          Effect.sync(() => {
            buildCalls += 1;
          }),
        electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
        processHandlers: fakeProcessHandlers.processHandlers,
        renderer,
        startElectronProcess: (rendererDevUrl, electronExecutablePath, remoteDebugging) => {
          startCalls.push({
            executablePath: electronExecutablePath,
            remoteDebugging,
            rendererDevUrl,
          });
          return {
            exited: Promise.resolve(0),
            kill() {},
          };
        },
      }),
    );

    expect(exitCode).toBe(0);
    expect(buildCalls).toBe(1);
    expect(startCalls).toEqual([
      {
        executablePath: "/repo/node_modules/electron/dist/Electron",
        remoteDebugging: false,
        rendererDevUrl: "http://127.0.0.1:1430",
      },
    ]);
    expect(watchedRoots).toHaveLength(1);
    expect(watchedEvents).toEqual(["add", "change", "unlink"]);
    expect(closeCalls).toBe(1);
    expect(fakeProcessHandlers.registered.map(({ event }) => event)).toEqual([
      "SIGINT",
      "SIGTERM",
      "exit",
    ]);
    expect(fakeProcessHandlers.removed.map(({ event }) => event)).toEqual([
      "exit",
      "SIGTERM",
      "SIGINT",
    ]);
  });

  test("waits for the CDP port file before logging the endpoint", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "odt-electron-cdp-"));
    const endpointLine = electronDebugEndpointLogLine(45_678);
    const loggedLines: string[] = [];
    let resolveElectronExit: (exitCode: number) => void = () => {};
    const electronExited = new Promise<number>((resolve) => {
      resolveElectronExit = resolve;
    });
    const originalConsoleLog = console.log;
    console.log = (...arguments_: unknown[]) => {
      const line = arguments_.map(String).join(" ");
      loggedLines.push(line);
      if (line === endpointLine) {
        resolveElectronExit(0);
      }
    };

    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      const fakeProcessHandlers = createFakeProcessHandlers();
      const remoteDebuggingValues: boolean[] = [];

      const lifecycle = runElectronEffect(
        runElectronDevLifecycleEffect({
          buildBundles: () => Effect.void,
          devToolsActivePortPath: activePortPath,
          electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
          processHandlers: fakeProcessHandlers.processHandlers,
          renderer: createFakeRenderer(),
          startElectronProcess: (_rendererDevUrl, _executablePath, remoteDebugging) => {
            remoteDebuggingValues.push(remoteDebugging);
            void writeFile(activePortPath, "45678\n/devtools/browser/example\n");
            return {
              exited: electronExited,
              kill() {},
            };
          },
        }),
      );

      expect(await lifecycle).toBe(0);
      expect(remoteDebuggingValues).toEqual([true]);
      expect(loggedLines).toContain(endpointLine);
    } finally {
      console.log = originalConsoleLog;
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("fails when Electron exits before it publishes the CDP port", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "odt-electron-cdp-"));
    const loggedLines: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (...arguments_: unknown[]) => {
      loggedLines.push(arguments_.map(String).join(" "));
    };

    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      const fakeProcessHandlers = createFakeProcessHandlers();

      await expect(
        runElectronEffect(
          runElectronDevLifecycleEffect({
            buildBundles: () => Effect.void,
            devToolsActivePortPath: activePortPath,
            electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
            processHandlers: fakeProcessHandlers.processHandlers,
            renderer: createFakeRenderer(),
            startElectronProcess: () => ({
              exited: Promise.resolve(0),
              kill() {},
            }),
          }),
        ),
      ).rejects.toThrow(
        "Electron exited with code 0 before it published the CDP port. Check the Electron startup output, then rerun `bun run electron:dev:cdp`.",
      );

      await writeFile(activePortPath, "45678\n/devtools/browser/example\n");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(loggedLines.filter((line) => line.includes("CDP endpoint"))).toEqual([]);
    } finally {
      console.log = originalConsoleLog;
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("fails the restart when the replacement Electron exits before it writes the CDP port file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "odt-electron-cdp-"));
    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      const fakeProcessHandlers = createFakeProcessHandlers();
      const changeListeners: Array<(filePath: string) => void> = [];
      const watcher: ElectronDevRendererWatcher = {
        add() {
          return watcher;
        },
        on(event, listener) {
          if (event === "change") {
            changeListeners.push(listener);
          }
          return watcher;
        },
      };
      const remoteDebuggingValues: boolean[] = [];
      let killCalls = 0;
      let resolveInitialExit: (exitCode: number) => void = () => {};
      const initialExited = new Promise<number>((resolve) => {
        resolveInitialExit = resolve;
      });

      const lifecycle = runElectronEffect(
        runElectronDevLifecycleEffect({
          buildBundles: () => Effect.void,
          devToolsActivePortPath: activePortPath,
          electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
          processHandlers: fakeProcessHandlers.processHandlers,
          renderer: createFakeRenderer({ watcher }),
          startElectronProcess: (_rendererDevUrl, _executablePath, remoteDebugging) => {
            const launchIndex = remoteDebuggingValues.length;
            remoteDebuggingValues.push(remoteDebugging);
            if (launchIndex === 0) {
              void writeFile(activePortPath, "45678\n/devtools/browser/example\n");
              return {
                exited: initialExited,
                kill() {
                  killCalls += 1;
                  resolveInitialExit(0);
                },
              };
            }
            return {
              exited: Promise.resolve(0),
              kill() {},
            };
          },
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      const changeListener = changeListeners[0];
      if (!changeListener) {
        throw new Error("Expected the lifecycle to register a watcher change listener.");
      }
      changeListener(path.join(ELECTRON_RESTART_WATCH_ROOTS[0], "main.ts"));

      expect(await lifecycle).toBe(1);
      expect(remoteDebuggingValues).toEqual([true, true]);
      expect(killCalls).toBe(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("restarts Electron when a change interrupts the initial CDP port wait", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "odt-electron-cdp-"));
    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      const fakeProcessHandlers = createFakeProcessHandlers();
      const changeListeners: Array<(filePath: string) => void> = [];
      const watcher: ElectronDevRendererWatcher = {
        add() {
          return watcher;
        },
        on(event, listener) {
          if (event === "change") {
            changeListeners.push(listener);
          }
          return watcher;
        },
      };
      const remoteDebuggingValues: boolean[] = [];
      let resolveInitialExit: (exitCode: number) => void = () => {};
      const initialExited = new Promise<number>((resolve) => {
        resolveInitialExit = resolve;
      });
      let resolveReplacementExit: (exitCode: number) => void = () => {};
      const replacementExited = new Promise<number>((resolve) => {
        resolveReplacementExit = resolve;
      });

      const lifecycle = runElectronEffect(
        runElectronDevLifecycleEffect({
          buildBundles: () => Effect.void,
          devToolsActivePortPath: activePortPath,
          electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
          processHandlers: fakeProcessHandlers.processHandlers,
          renderer: createFakeRenderer({ watcher }),
          startElectronProcess: (_rendererDevUrl, _executablePath, remoteDebugging) => {
            const launchIndex = remoteDebuggingValues.length;
            remoteDebuggingValues.push(remoteDebugging);
            if (launchIndex === 0) {
              return {
                exited: initialExited,
                kill() {
                  resolveInitialExit(0);
                },
              };
            }
            void writeFile(activePortPath, "45678\n/devtools/browser/example\n");
            return {
              exited: replacementExited,
              kill() {
                resolveReplacementExit(0);
              },
            };
          },
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 30));
      const changeListener = changeListeners[0];
      if (!changeListener) {
        throw new Error("Expected the lifecycle to register a watcher change listener.");
      }
      changeListener(path.join(ELECTRON_RESTART_WATCH_ROOTS[0], "main.ts"));

      for (let attempt = 0; attempt < 50 && remoteDebuggingValues.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const shutdownHandler = fakeProcessHandlers.registered.find(
        ({ event }) => event === "SIGTERM",
      );
      if (!shutdownHandler) {
        throw new Error("Expected the Electron dev lifecycle to register SIGTERM.");
      }
      shutdownHandler.listener();

      expect(await lifecycle).toBe(143);
      expect(remoteDebuggingValues).toEqual([true, true]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("does not start a stale launch when a restart interrupts CDP port file preparation", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "odt-electron-cdp-"));
    const fakeProcessHandlers = createFakeProcessHandlers();
    let resolveInitialPreparation: () => void = () => {};
    const initialPreparation = new Promise<void>((resolve) => {
      resolveInitialPreparation = resolve;
    });
    let preparationCalls = 0;
    let resolveProcessExit: (exitCode: number) => void = () => {};
    const processExited = new Promise<number>((resolve) => {
      resolveProcessExit = resolve;
    });
    const remoteDebuggingValues: boolean[] = [];

    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      const changeListeners: Array<(filePath: string) => void> = [];
      const watcher: ElectronDevRendererWatcher = {
        add() {
          return watcher;
        },
        on(event, listener) {
          if (event === "change") {
            changeListeners.push(listener);
          }
          return watcher;
        },
      };

      const lifecycle = runElectronEffect(
        runElectronDevLifecycleEffect({
          buildBundles: () => Effect.void,
          devToolsActivePortPath: activePortPath,
          electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
          prepareDevToolsPortFile: () => {
            preparationCalls += 1;
            if (preparationCalls === 1) {
              return Effect.promise(() => initialPreparation);
            }
            return Effect.void;
          },
          processHandlers: fakeProcessHandlers.processHandlers,
          renderer: createFakeRenderer({ watcher }),
          startElectronProcess: (_rendererDevUrl, _executablePath, remoteDebugging) => {
            remoteDebuggingValues.push(remoteDebugging);
            void writeFile(activePortPath, "45678\n/devtools/browser/example\n");
            return {
              exited: processExited,
              kill() {
                resolveProcessExit(0);
              },
            };
          },
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      const changeListener = changeListeners[0];
      if (!changeListener) {
        throw new Error("Expected the lifecycle to register a watcher change listener.");
      }
      changeListener(path.join(ELECTRON_RESTART_WATCH_ROOTS[0], "main.ts"));

      for (let attempt = 0; attempt < 100 && remoteDebuggingValues.length < 1; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(remoteDebuggingValues.length).toBe(1);

      resolveInitialPreparation();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(remoteDebuggingValues).toEqual([true]);

      const shutdownHandler = fakeProcessHandlers.registered.find(
        ({ event }) => event === "SIGTERM",
      );
      if (!shutdownHandler) {
        throw new Error("Expected the Electron dev lifecycle to register SIGTERM.");
      }
      shutdownHandler.listener();

      expect(await lifecycle).toBe(143);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("settles when a replacement Electron exits right after publishing the CDP port", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "odt-electron-cdp-"));
    const endpointLine = electronDebugEndpointLogLine(45_678);
    const loggedLines: string[] = [];
    const originalConsoleLog = console.log;
    let resolveReplacementExit: (exitCode: number) => void = () => {};
    const replacementExited = new Promise<number>((resolve) => {
      resolveReplacementExit = resolve;
    });
    console.log = (...arguments_: unknown[]) => {
      const line = arguments_.map(String).join(" ");
      loggedLines.push(line);
      if (
        line === endpointLine &&
        loggedLines.filter((entry) => entry === endpointLine).length === 2
      ) {
        resolveReplacementExit(0);
      }
    };

    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      const fakeProcessHandlers = createFakeProcessHandlers();
      const changeListeners: Array<(filePath: string) => void> = [];
      const watcher: ElectronDevRendererWatcher = {
        add() {
          return watcher;
        },
        on(event, listener) {
          if (event === "change") {
            changeListeners.push(listener);
          }
          return watcher;
        },
      };
      const remoteDebuggingValues: boolean[] = [];
      let resolveInitialExit: (exitCode: number) => void = () => {};
      const initialExited = new Promise<number>((resolve) => {
        resolveInitialExit = resolve;
      });

      const lifecycle = runElectronEffect(
        runElectronDevLifecycleEffect({
          buildBundles: () => Effect.void,
          devToolsActivePortPath: activePortPath,
          electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
          processHandlers: fakeProcessHandlers.processHandlers,
          renderer: createFakeRenderer({ watcher }),
          startElectronProcess: (_rendererDevUrl, _executablePath, remoteDebugging) => {
            const launchIndex = remoteDebuggingValues.length;
            remoteDebuggingValues.push(remoteDebugging);
            void writeFile(activePortPath, "45678\n/devtools/browser/example\n");
            if (launchIndex === 0) {
              return {
                exited: initialExited,
                kill() {
                  resolveInitialExit(0);
                },
              };
            }
            return {
              exited: replacementExited,
              kill() {
                resolveReplacementExit(0);
              },
            };
          },
        }),
      );

      for (
        let attempt = 0;
        attempt < 50 && loggedLines.filter((line) => line === endpointLine).length < 1;
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(loggedLines.filter((line) => line === endpointLine).length).toBe(1);

      const changeListener = changeListeners[0];
      if (!changeListener) {
        throw new Error("Expected the lifecycle to register a watcher change listener.");
      }
      changeListener(path.join(ELECTRON_RESTART_WATCH_ROOTS[0], "main.ts"));

      expect(await lifecycle).toBe(0);
      expect(remoteDebuggingValues).toEqual([true, true]);
      expect(loggedLines.filter((line) => line === endpointLine).length).toBe(2);
    } finally {
      console.log = originalConsoleLog;
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("does not launch Electron when shutdown starts during CDP port file preparation", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "odt-electron-cdp-"));
    const fakeProcessHandlers = createFakeProcessHandlers();
    let startCalls = 0;

    try {
      const exitCode = await runElectronEffect(
        runElectronDevLifecycleEffect({
          buildBundles: () => Effect.void,
          devToolsActivePortPath: path.join(directory, "DevToolsActivePort"),
          prepareDevToolsPortFile: () =>
            Effect.tryPromise({
              try: async () => {
                const shutdownHandler = fakeProcessHandlers.registered.find(
                  ({ event }) => event === "SIGTERM",
                );
                if (!shutdownHandler) {
                  throw new Error("Expected the SIGTERM handler to be registered before launch.");
                }
                shutdownHandler.listener();
                await Promise.resolve();
              },
              catch: (cause) =>
                new ElectronOperationError({
                  operation: "electron.dev.test-prepare-devtools-port-file",
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause,
                }),
            }),
          electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
          processHandlers: fakeProcessHandlers.processHandlers,
          renderer: createFakeRenderer(),
          startElectronProcess: () => {
            startCalls += 1;
            return {
              exited: Promise.resolve(0),
              kill() {},
            };
          },
        }),
      );

      expect(exitCode).toBe(143);
      expect(startCalls).toBe(0);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("stops Electron when the CDP port watcher fails", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "odt-electron-cdp-"));
    const fakeProcessHandlers = createFakeProcessHandlers();
    const killSignals: Array<NodeJS.Signals | number | undefined> = [];
    let resolveExit: (exitCode: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    let startCalls = 0;

    try {
      const lifecycleFailure = runElectronEffect(
        runElectronDevLifecycleEffect({
          buildBundles: () => Effect.void,
          devToolsActivePortPath: path.join(directory, "missing", "DevToolsActivePort"),
          electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
          prepareDevToolsPortFile: () => Effect.void,
          processHandlers: fakeProcessHandlers.processHandlers,
          renderer: createFakeRenderer(),
          startElectronProcess: () => {
            startCalls += 1;
            return {
              exited,
              kill(signal?: NodeJS.Signals | number) {
                killSignals.push(signal);
                resolveExit(0);
              },
            };
          },
        }),
      );

      await expect(lifecycleFailure).rejects.toThrow("Failed to watch");
      await expect(lifecycleFailure).rejects.toThrow(
        "Check the profile directory and its permissions, then rerun `bun run electron:dev:cdp`.",
      );

      expect(startCalls).toBe(1);
      expect(killSignals).toEqual([electronGracefulShutdownSignal(process.platform)]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("keeps an invalid config directory in the main Effect failure channel for CDP mode", async () => {
    const originalConfigDir = process.env.OPENDUCKTOR_CONFIG_DIR;
    const originalArgv = process.argv;
    process.env.OPENDUCKTOR_CONFIG_DIR = "   ";
    process.argv = ["bun", "scripts/dev.ts", "--cdp"];

    try {
      const exit = await Effect.runPromiseExit(mainEffect());
      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) {
        throw new Error("Expected mainEffect to fail for an invalid config directory.");
      }

      const failureOption = Chunk.head(Cause.failures(exit.cause));
      expect(failureOption._tag).toBe("Some");
      if (failureOption._tag !== "Some") {
        throw new Error("Expected the config failure in the typed error channel.");
      }

      expect(failureOption.value).toMatchObject({
        _tag: "ElectronValidationError",
        operation: "electron.dev.resolve-devtools-active-port-path",
      });
      expect(Chunk.isEmpty(Cause.defects(exit.cause))).toBe(true);
    } finally {
      process.argv = originalArgv;
      if (originalConfigDir === undefined) {
        delete process.env.OPENDUCKTOR_CONFIG_DIR;
      } else {
        process.env.OPENDUCKTOR_CONFIG_DIR = originalConfigDir;
      }
    }
  });

  test("cleans up Electron dev lifecycle resources when the Effect is interrupted", async () => {
    const fakeProcessHandlers = createFakeProcessHandlers();
    const killSignals: Array<NodeJS.Signals | number | undefined> = [];
    let closeCalls = 0;
    let markStarted: () => void = () => {};
    let resolveElectronExit: (exitCode: number) => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const electronExited = new Promise<number>((resolve) => {
      resolveElectronExit = resolve;
    });
    const renderer = createFakeRenderer({
      close: () =>
        Effect.sync(() => {
          closeCalls += 1;
        }),
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          runElectronDevLifecycleEffect({
            buildBundles: () => Effect.void,
            electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
            processHandlers: fakeProcessHandlers.processHandlers,
            renderer,
            startElectronProcess: () => {
              markStarted();
              return {
                exited: electronExited,
                kill(signal?: NodeJS.Signals | number) {
                  killSignals.push(signal);
                  resolveElectronExit(0);
                },
              };
            },
          }),
        );
        yield* Effect.promise(() => started);
        yield* Fiber.interrupt(fiber);
      }),
    );

    expect(killSignals).toEqual([electronGracefulShutdownSignal(process.platform)]);
    expect(closeCalls).toBe(1);
    expect(fakeProcessHandlers.removed.map(({ event }) => event)).toEqual([
      "SIGTERM",
      "SIGINT",
      "exit",
    ]);
  });

  test("keeps initial lifecycle setup failures in the typed failure channel", async () => {
    const fakeProcessHandlers = createFakeProcessHandlers();
    const setupError = new ElectronOperationError({
      operation: "electron.dev.test-build",
      message: "build failed before launch",
    });
    const renderer = createFakeRenderer();

    const exit = await Effect.runPromiseExit(
      runElectronDevLifecycleEffect({
        buildBundles: () => Effect.fail(setupError),
        electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
        processHandlers: fakeProcessHandlers.processHandlers,
        renderer,
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
    expect(fakeProcessHandlers.removed.map(({ event }) => event)).toEqual(["SIGTERM", "SIGINT"]);
  });

  test("does not launch Electron when shutdown starts during bundle build", async () => {
    const fakeProcessHandlers = createFakeProcessHandlers();
    const renderer = createFakeRenderer();
    let startCalls = 0;

    const exitCode = await runElectronEffect(
      runElectronDevLifecycleEffect({
        buildBundles: () =>
          Effect.tryPromise({
            try: async () => {
              const shutdownHandler = fakeProcessHandlers.registered.find(
                ({ event }) => event === "SIGTERM",
              );
              if (!shutdownHandler) {
                throw new Error("Expected SIGTERM handler to be registered before build.");
              }
              shutdownHandler.listener();
              await Promise.resolve();
            },
            catch: (cause) =>
              new ElectronOperationError({
                operation: "electron.dev.test-build",
                message: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
          }),
        electronExecutablePath: "/repo/node_modules/electron/dist/Electron",
        processHandlers: fakeProcessHandlers.processHandlers,
        renderer,
        startElectronProcess: () => {
          startCalls += 1;
          return {
            exited: Promise.resolve(0),
            kill() {},
          };
        },
      }),
    );

    expect(exitCode).toBe(143);
    expect(startCalls).toBe(0);
  });
});
