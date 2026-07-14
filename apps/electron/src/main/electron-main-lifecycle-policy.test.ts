import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Cause, Chunk, Effect, Exit } from "effect";
import { runElectronEffect } from "../effect/electron-boundary";
import { ElectronLifecycleError } from "../effect/electron-errors";
import {
  composeElectronMainStartupEffect,
  createElectronMainShutdownController,
  runElectronMainStartupBoundary,
} from "./electron-main-lifecycle";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");

const readRepoFile = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), "utf8");

describe("Electron main lifecycle policy", () => {
  test("main window uses the tracked application icon", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain("resolveElectronWindowIcon()");
    expect(source).toContain("nativeImage.createFromPath(iconPath)");
    expect(source).toContain("throw new ElectronOperationError({");
    expect(source).toContain('operation: "electron.main.load-icon"');
    expect(source).toContain("icon is missing or invalid:");
    expect(source).toContain("icon: resolveElectronWindowIcon()");
  });

  test("macOS dock uses the tracked application icon", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain("configureElectronDockIcon()");
    expect(source).toContain('path.join(resolveElectronIconDirectory(), "icon.png")');
    expect(source).toContain("app.dock.setIcon(");
  });

  test("window close hides windows and routes through host shutdown", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain('window.on("close"');
    expect(source).toContain("event.preventDefault();");
    expect(source).toContain("hideWindowsForShutdown();");
    expect(source).not.toContain("window.destroy();");
  });

  test("Windows and Linux keep the menu hidden until the native reveal shortcut", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain('autoHideMenuBar: process.platform !== "darwin"');
  });

  test("main window denies child windows and renderer-initiated navigation", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain(
      `window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    registerWindowContextMenu(window, { isDevelopment });`,
    );
  });

  test("startup starts scheduled app update checks after the main window is created", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain("createMainWindowEffect(rendererSession).pipe(");
    expect(source).toContain("appUpdateService.startBackgroundChecks()");
  });

  test("app update service is disposed with the active Electron runtime", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain("let activeAppUpdateService: ElectronAppUpdateService | null = null");
    expect(source).toContain("activeAppUpdateService?.dispose()");
    expect(source).toContain("disposeActiveElectronRuntimeEffect");
    expect(source).toContain(
      'cleanupAfterFailure: () => disposeActiveElectronRuntimeEffect("startup-failure")',
    );
    expect(source).toContain(
      "disposeHost: (reason) => disposeActiveElectronRuntimeForShutdownEffect(reason)",
    );
  });

  test("update install shutdown keeps app update listeners alive through native handoff", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain("disposeActiveElectronRuntimeForShutdownEffect");
    expect(source).toContain('if (reason === "update-install")');
    expect(source).toContain("return disposeActiveHostEffect(reason)");
    expect(source).toContain("return disposeActiveElectronRuntimeEffect(reason)");
  });

  test("app update check IPC returns a structured rejection for invalid input", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain("createRejectedAppUpdateCommandResult");
    expect(source).toContain("checkInput = readElectronAppUpdateCheckInput(input)");
    expect(source).toContain('code: "invalid_state"');
  });

  test("app update state forwarding skips destroyed windows and logs send failures", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain("window.isDestroyed() || window.webContents.isDestroyed()");
    expect(source).toContain("window.webContents.send(ELECTRON_APP_UPDATE_STATE_CHANGED_CHANNEL");
    expect(source).toContain("OpenDucktor update state forwarding failed");
  });

  test("startup runs pre-ready setup before app readiness and initializes host before window", async () => {
    const calls: string[] = [];

    const ready = await runElectronEffect(
      composeElectronMainStartupEffect({
        configureReady: (preReady: string) =>
          Effect.sync(() => {
            calls.push(`configure-ready:${preReady}`);
            return { router: preReady, session: "renderer-session" };
          }),
        createMainWindow: (runtime) =>
          Effect.sync(() => {
            calls.push(`create-window:${runtime.session}`);
          }),
        initializeHost: (runtime) =>
          Effect.sync(() => {
            calls.push(`initialize-host:${runtime.router}`);
          }),
        preparePreReady: () =>
          Effect.sync(() => {
            calls.push("prepare-pre-ready");
            return "host-router";
          }),
        registerActivateHandler: (runtime) => {
          calls.push(`register-activate:${runtime.session}`);
        },
        waitUntilReady: () =>
          Effect.sync(() => {
            calls.push("wait-until-ready");
          }),
      }),
    );

    expect(ready).toEqual({ router: "host-router", session: "renderer-session" });
    expect(calls).toEqual([
      "prepare-pre-ready",
      "wait-until-ready",
      "configure-ready:host-router",
      "initialize-host:host-router",
      "create-window:renderer-session",
      "register-activate:renderer-session",
    ]);
  });

  test("startup stops before ready configuration when shutdown has started", async () => {
    const calls: string[] = [];
    let shutdownStarted = false;

    const exit = await Effect.runPromiseExit(
      composeElectronMainStartupEffect({
        configureReady: (preReady: string) =>
          Effect.sync(() => {
            calls.push(`configure-ready:${preReady}`);
            return { router: preReady, session: "renderer-session" };
          }),
        createMainWindow: (runtime) =>
          Effect.sync(() => {
            calls.push(`create-window:${runtime.session}`);
          }),
        initializeHost: (runtime) =>
          Effect.sync(() => {
            calls.push(`initialize-host:${runtime.router}`);
          }),
        preparePreReady: () =>
          Effect.sync(() => {
            calls.push("prepare-pre-ready");
            return "host-router";
          }),
        registerActivateHandler: (runtime) => {
          calls.push(`register-activate:${runtime.session}`);
        },
        shouldContinueStartup: () => !shutdownStarted,
        waitUntilReady: () =>
          Effect.sync(() => {
            calls.push("wait-until-ready");
            shutdownStarted = true;
          }),
      }),
    );

    expect(calls).toEqual(["prepare-pre-ready", "wait-until-ready"]);
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) {
      throw new Error("Expected startup to fail after shutdown starts.");
    }
    const failure = Chunk.head(Cause.failures(exit.cause));
    expect(failure._tag).toBe("Some");
    if (failure._tag !== "Some") {
      throw new Error("Expected startup shutdown failure.");
    }
    expect(failure.value).toMatchObject({
      _tag: "ElectronLifecycleError",
      operation: "electron.main.configure-ready",
      reason: "shutdown-started",
    });
  });

  test("startup boundary logs typed setup failures, runs cleanup, marks shutdown, and exits", async () => {
    const startupError = new ElectronLifecycleError({
      operation: "electron.main.configure-app-identity",
      message: "profile setup failed",
    });
    const errors: Array<{ error: unknown; message: string }> = [];
    const exitCodes: number[] = [];
    let cleanupCalls = 0;
    let shutdownStarted = false;
    let shutdownComplete = false;

    await runElectronMainStartupBoundary({
      cleanupAfterFailure: () =>
        Effect.sync(() => {
          cleanupCalls += 1;
        }),
      exitProcess: (exitCode) => {
        exitCodes.push(exitCode);
      },
      logger: {
        error(message, error) {
          errors.push({ message, error });
        },
        info() {},
      },
      markShutdownComplete: () => {
        shutdownComplete = true;
      },
      markShutdownStarted: () => {
        shutdownStarted = true;
      },
      startupEffect: Effect.fail(startupError),
    });

    expect(cleanupCalls).toBe(1);
    expect(shutdownStarted).toBe(true);
    expect(shutdownComplete).toBe(true);
    expect(exitCodes).toEqual([1]);
    expect(errors).toEqual([
      {
        message: "OpenDucktor Electron startup failed",
        error: startupError,
      },
    ]);
  });

  test("shutdown controller disposes the host once for concurrent shutdown triggers", async () => {
    const disposeReasons: string[] = [];
    const quitCalls: string[] = [];
    let releaseDispose: () => void = () => {};
    const disposeGate = new Promise<void>((resolve) => {
      releaseDispose = resolve;
    });
    const controller = createElectronMainShutdownController({
      disposeHost: (reason) =>
        Effect.tryPromise({
          try: async () => {
            disposeReasons.push(reason);
            await disposeGate;
          },
          catch: (cause) =>
            new ElectronLifecycleError({
              operation: "electron.main.dispose-host",
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }),
      exitProcess: () => {},
      logger: {
        error() {},
        info() {},
      },
      quitApp: () => {
        quitCalls.push("quit");
      },
    });

    const firstShutdown = controller.shutdownHostAndQuit({ reason: "window-all-closed" });
    const secondShutdown = controller.shutdownHostAndQuit({ reason: "before-quit" });

    await Promise.resolve();
    expect(disposeReasons).toEqual(["window-all-closed"]);
    expect(controller.isHostShutdownStarted()).toBe(true);

    releaseDispose();
    await Promise.all([firstShutdown, secondShutdown]);

    expect(disposeReasons).toEqual(["window-all-closed"]);
    expect(quitCalls).toEqual(["quit"]);
    expect(controller.isHostShutdownComplete()).toBe(true);
  });

  test("shutdown controller exits with failure when host disposal fails on a signal path", async () => {
    const errors: Array<{ error: unknown; message: string }> = [];
    const exitCodes: number[] = [];
    const disposalError = new ElectronLifecycleError({
      operation: "electron.main.dispose-host",
      message: "dispose failed",
      reason: "SIGTERM",
    });

    const controller = createElectronMainShutdownController({
      disposeHost: () => Effect.fail(disposalError),
      exitProcess: (exitCode) => {
        exitCodes.push(exitCode);
      },
      logger: {
        error(message, error) {
          errors.push({ message, error });
        },
        info() {},
      },
      quitApp: () => {
        throw new Error("Expected signal shutdown to exit instead of quitting the app.");
      },
    });

    await controller.shutdownHostAndQuit({ exitAfterShutdown: true, reason: "SIGTERM" });

    expect(exitCodes).toEqual([1]);
    expect(errors).toEqual([
      {
        message: "OpenDucktor host shutdown failed",
        error: disposalError,
      },
    ]);
  });

  test("shutdown controller preserves a failed host disposal outcome across run retries", async () => {
    const disposalError = new ElectronLifecycleError({
      operation: "electron.main.dispose-host",
      message: "dispose failed",
      reason: "update-install",
    });
    const installCalls: string[] = [];
    let disposeCalls = 0;

    const controller = createElectronMainShutdownController({
      disposeHost: () => {
        disposeCalls += 1;
        return Effect.fail(disposalError);
      },
      exitProcess: () => {},
      logger: {
        error() {},
        info() {},
      },
      quitApp: () => {},
    });

    await expect(
      controller.shutdownHostAndRun({
        reason: "update-install",
        runAfterShutdown: () => {
          installCalls.push("install");
        },
      }),
    ).rejects.toMatchObject({
      _tag: "ElectronLifecycleError",
      operation: "electron.main.shutdown-host-before-run",
    });

    await expect(
      controller.shutdownHostAndRun({
        reason: "update-install",
        runAfterShutdown: () => {
          installCalls.push("install");
        },
      }),
    ).rejects.toMatchObject({
      _tag: "ElectronLifecycleError",
      operation: "electron.main.shutdown-host-before-run",
    });

    expect(disposeCalls).toBe(1);
    expect(installCalls).toEqual([]);
  });
});
