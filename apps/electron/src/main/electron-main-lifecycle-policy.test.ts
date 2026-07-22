import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Cause, Chunk, Effect, Exit } from "effect";
import { runElectronEffect } from "../effect/electron-boundary";
import { ElectronLifecycleError } from "../effect/electron-errors";
import {
  composeElectronMainStartupEffect,
  createElectronMainShutdownController,
  runElectronMainStartupBoundary,
} from "./electron-main-lifecycle";
import { createElectronMainLogger } from "./electron-main-logger";
import { createElectronMainRuntimeBindings } from "./electron-main-runtime-bindings";

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

  test("main window remains visible while the renderer performs its initial commit", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).not.toContain("show: false");
    expect(source).not.toContain('window.once("ready-to-show"');
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

    expect(source).toContain('window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))');
    expect(source).toContain('window.webContents.on("will-navigate", (event) => {');
    expect(source).toContain("event.preventDefault()");
    const windowOpenHandlerIndex = source.indexOf("window.webContents.setWindowOpenHandler");
    expect(windowOpenHandlerIndex).toBeGreaterThanOrEqual(0);
    expect(
      source.indexOf("registerWindowContextMenu(window", windowOpenHandlerIndex),
    ).toBeGreaterThan(windowOpenHandlerIndex);
  });

  test("startup starts scheduled app update checks after the main window is created", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain("createMainWindowEffect(rendererSession).pipe(");
    expect(source).toContain("appUpdateService.startBackgroundChecks()");
  });

  test("packaged startup ignores a renderer development URL from the environment", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain(
      "const rendererDevUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;",
    );
  });

  test("startup selects the Chromium profile from Electron packaging state", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain("profileKind: resolveElectronProfileKind(app.isPackaged)");
  });

  test("startup passes Electron packaging state to MCP discovery composition", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain("isPackaged: app.isPackaged");
  });

  test("startup does not claim single-instance ownership of the selected profile", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).not.toContain("requestSingleInstanceLock");
    expect(source).not.toContain('app.on("second-instance"');
  });

  test("startup does not initialize the native updater on the main-process path", () => {
    const mainSource = readRepoFile("apps/electron/src/main/main.ts");
    const nativeAdapterSource = readRepoFile(
      "apps/electron/src/main/app-updates/electron-updater-adapter.ts",
    );

    expect(mainSource).toContain("createElectronUpdaterAdapter({ currentVersion, releaseSource })");
    expect(nativeAdapterSource).not.toContain('import { autoUpdater } from "electron-updater"');
    expect(nativeAdapterSource).toContain('await import("electron-updater")');
  });

  test("app update service is disposed with the active Electron runtime", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain("let activeAppUpdateService: ElectronAppUpdateService | null = null");
    expect(source).toContain("await service?.dispose()");
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

  test("startup creates the window before initializing background host services", async () => {
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
      "create-window:renderer-session",
      "initialize-host:host-router",
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
          return Effect.sync(() => errors.push({ message, error }));
        },
        info: () => Effect.void,
      },
      markShutdownComplete: () => {
        shutdownComplete = true;
      },
      markShutdownStarted: () => {
        shutdownStarted = true;
      },
      reportFailure: () => {},
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

  test("startup boundary still cleans up and exits when persistent logging fails", async () => {
    const persistenceError = new Error("openducktor.logs.append failed");
    const reportedFailures: unknown[] = [];
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
        error: () => Effect.fail(persistenceError),
        info: () => Effect.void,
      },
      markShutdownComplete: () => {
        shutdownComplete = true;
      },
      markShutdownStarted: () => {
        shutdownStarted = true;
      },
      reportFailure: (cause) => {
        reportedFailures.push(cause);
      },
      startupEffect: Effect.fail(
        new ElectronLifecycleError({
          operation: "electron.main.integration-startup",
          message: "startup failed",
        }),
      ),
    });

    expect(cleanupCalls).toBe(1);
    expect(shutdownStarted).toBe(true);
    expect(shutdownComplete).toBe(true);
    expect(reportedFailures).toEqual([persistenceError]);
    expect(exitCodes).toEqual([1]);
  });

  test("startup boundary reports persistence and cleanup failures together", async () => {
    const persistenceError = new Error("openducktor.logs.append failed");
    const cleanupError = new ElectronLifecycleError({
      operation: "electron.main.cleanup-startup",
      message: "cleanup failed",
    });
    const reportedFailures: unknown[] = [];

    await runElectronMainStartupBoundary({
      cleanupAfterFailure: () => Effect.fail(cleanupError),
      exitProcess: () => {},
      logger: {
        error: () => Effect.fail(persistenceError),
        info: () => Effect.void,
      },
      markShutdownComplete: () => {},
      markShutdownStarted: () => {},
      reportFailure: (cause) => {
        reportedFailures.push(cause);
      },
      startupEffect: Effect.fail(
        new ElectronLifecycleError({
          operation: "electron.main.integration-startup",
          message: "startup failed",
        }),
      ),
    });

    expect(reportedFailures).toHaveLength(1);
    expect(reportedFailures[0]).toMatchObject({
      _tag: "ElectronLifecycleError",
      operation: "electron.main.startup-failure-report",
      details: { failures: [persistenceError, cleanupError] },
    });
  });

  test("startup boundary reports cleanup failures when persistence succeeds", async () => {
    const cleanupError = new ElectronLifecycleError({
      operation: "electron.main.cleanup-startup",
      message: "cleanup failed",
    });
    const reportedFailures: unknown[] = [];

    await runElectronMainStartupBoundary({
      cleanupAfterFailure: () => Effect.fail(cleanupError),
      exitProcess: () => {},
      logger: {
        error: () => Effect.void,
        info: () => Effect.void,
      },
      markShutdownComplete: () => {},
      markShutdownStarted: () => {},
      reportFailure: (cause) => {
        reportedFailures.push(cause);
      },
      startupEffect: Effect.fail(
        new ElectronLifecycleError({
          operation: "electron.main.integration-startup",
          message: "startup failed",
        }),
      ),
    });

    expect(reportedFailures).toEqual([cleanupError]);
  });

  test("persists real startup failure and shutdown lifecycle events with console parity", async () => {
    const configDirectory = mkdtempSync(resolve(tmpdir(), "openducktor-electron-lifecycle-"));
    let consoleOutput = "";
    try {
      const logger = await Effect.runPromise(
        createElectronMainLogger({
          env: { NO_COLOR: "1", OPENDUCKTOR_CONFIG_DIR: configDirectory },
          now: () => new Date(2026, 4, 13, 23, 45, 12, 345),
          stream: {
            write(chunk) {
              consoleOutput += chunk;
            },
          },
        }),
      );
      const startupError = new ElectronLifecycleError({
        operation: "electron.main.integration-startup",
        message: "integration startup failed",
      });

      await runElectronMainStartupBoundary({
        cleanupAfterFailure: () => Effect.void,
        exitProcess: () => {},
        logger,
        markShutdownComplete: () => {},
        markShutdownStarted: () => {},
        reportFailure: () => {},
        startupEffect: Effect.fail(startupError),
      });
      const controller = createElectronMainShutdownController({
        disposeHost: () => Effect.void,
        drainHostCommands: () => Promise.resolve(),
        exitProcess: () => {},
        logger,
        quitApp: () => {},
        reportFailure: () => {},
      });
      await controller.shutdownHostAndQuit({ reason: "integration-shutdown" });

      const persisted = readFileSync(
        resolve(configDirectory, "logs", "openducktor-electron-2026-05-13.log"),
        "utf8",
      );
      for (const message of [
        "OpenDucktor Electron startup failed",
        "OpenDucktor host shutdown started (integration-shutdown)",
        "OpenDucktor host shutdown complete",
      ]) {
        expect(consoleOutput).toContain(message);
        expect(persisted).toContain(message);
      }
    } finally {
      rmSync(configDirectory, { force: true, recursive: true });
    }
  });

  test("shutdown controller disposes the host once for concurrent shutdown triggers", async () => {
    const disposeReasons: string[] = [];
    const quitCalls: string[] = [];
    let markDisposeStarted: () => void = () => {};
    const disposeStarted = new Promise<void>((resolve) => {
      markDisposeStarted = resolve;
    });
    let releaseDispose: () => void = () => {};
    const disposeGate = new Promise<void>((resolve) => {
      releaseDispose = resolve;
    });
    const controller = createElectronMainShutdownController({
      disposeHost: (reason) =>
        Effect.tryPromise({
          try: async () => {
            disposeReasons.push(reason);
            markDisposeStarted();
            await disposeGate;
          },
          catch: (cause) =>
            new ElectronLifecycleError({
              operation: "electron.main.dispose-host",
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }),
      drainHostCommands: () => Promise.resolve(),
      exitProcess: () => {},
      logger: {
        error: () => Effect.void,
        info: () => Effect.void,
      },
      quitApp: () => {
        quitCalls.push("quit");
      },
      reportFailure: () => {},
    });

    const firstShutdown = controller.shutdownHostAndQuit({ reason: "window-all-closed" });
    const secondShutdown = controller.shutdownHostAndQuit({ reason: "before-quit" });

    await disposeStarted;
    expect(disposeReasons).toEqual(["window-all-closed"]);
    expect(controller.isHostShutdownStarted()).toBe(true);

    releaseDispose();
    await Promise.all([firstShutdown, secondShutdown]);

    expect(disposeReasons).toEqual(["window-all-closed"]);
    expect(quitCalls).toEqual(["quit"]);
    expect(controller.isHostShutdownComplete()).toBe(true);
  });

  test("shutdown persists an admitted host command failure before quitting", async () => {
    const records: string[] = [];
    let markErrorAppendStarted: () => void = () => {};
    const errorAppendStarted = new Promise<void>((resolve) => {
      markErrorAppendStarted = resolve;
    });
    let releaseErrorAppend: () => void = () => {};
    const errorAppendGate = new Promise<void>((resolve) => {
      releaseErrorAppend = resolve;
    });
    const logger = await Effect.runPromise(
      createElectronMainLogger({
        stream: { write: () => {} },
        writer: {
          append: (_recordedAt, record) => {
            if (!record.includes("Electron host command")) {
              return Effect.sync(() => {
                records.push(record);
              });
            }
            return Effect.promise(async () => {
              markErrorAppendStarted();
              await errorAppendGate;
              records.push(record);
            });
          },
        },
      }),
    );
    const runtimeBindings = createElectronMainRuntimeBindings(logger);
    let markDisposeCompleted: () => void = () => {};
    const disposeCompleted = new Promise<void>((resolve) => {
      markDisposeCompleted = resolve;
    });
    let quitCalled = false;
    const controller = createElectronMainShutdownController({
      disposeHost: () =>
        Effect.sync(() => {
          markDisposeCompleted();
        }),
      drainHostCommands: runtimeBindings.drainHostCommands,
      exitProcess: () => {},
      logger: {
        error: logger.error,
        info: logger.info,
      },
      quitApp: () => {
        quitCalled = true;
      },
      reportFailure: () => {},
    });

    const commandFailure = new Error("Codex session was released during shutdown");
    const command = runtimeBindings.runHostCommand(
      "runtime.session.context-usage",
      Effect.fail(commandFailure),
    );
    await errorAppendStarted;
    const shutdown = controller.shutdownHostAndQuit({ reason: "window-close" });
    await disposeCompleted;

    expect(quitCalled).toBe(false);
    releaseErrorAppend();
    await expect(command).rejects.toBe(commandFailure);
    await shutdown;

    const commandErrorIndex = records.findIndex((record) =>
      record.includes("ERROR Electron host command 'runtime.session.context-usage' failed"),
    );
    const shutdownCompleteIndex = records.findIndex((record) =>
      record.includes("INFO OpenDucktor host shutdown complete"),
    );
    expect(commandErrorIndex).toBeGreaterThanOrEqual(0);
    expect(shutdownCompleteIndex).toBeGreaterThan(commandErrorIndex);
    expect(quitCalled).toBe(true);
  });

  test("shutdown reports admitted host command log persistence failures before exiting", async () => {
    const commandFailure = new Error("Codex session was released during shutdown");
    const persistenceFailure = new Error("openducktor.logs.append failed");
    const logger = {
      error: () => Effect.fail(persistenceFailure),
      info: () => Effect.void,
      warn: () => Effect.void,
    };
    const runtimeBindings = createElectronMainRuntimeBindings(logger);
    const reportedFailures: unknown[] = [];
    const exitCodes: number[] = [];
    let quitCalls = 0;
    const controller = createElectronMainShutdownController({
      disposeHost: () => Effect.void,
      drainHostCommands: runtimeBindings.drainHostCommands,
      exitProcess: (exitCode) => {
        exitCodes.push(exitCode);
      },
      logger,
      quitApp: () => {
        quitCalls += 1;
      },
      reportFailure: (cause) => {
        reportedFailures.push(cause);
      },
    });

    const commandOutcome = runtimeBindings
      .runHostCommand("runtime.session.context-usage", Effect.fail(commandFailure))
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    await controller.shutdownHostAndQuit({ reason: "window-close" });
    const rejectedCommand = await commandOutcome;

    expect(rejectedCommand).toMatchObject({
      _tag: "ElectronOperationError",
      operation: "electron.main.host-command",
      cause: commandFailure,
      details: { commandFailure, persistenceFailure },
    });
    expect(reportedFailures).toEqual([rejectedCommand]);
    expect(exitCodes).toEqual([1]);
    expect(quitCalls).toBe(0);
  });

  test("shutdown controller exits with failure when host disposal fails on a signal path", async () => {
    const errors: Array<{ error: unknown; message: string }> = [];
    const exitCodes: number[] = [];
    const disposalError = new ElectronLifecycleError({
      operation: "electron.main.dispose-host",
      message: "dispose failed",
      reason: "SIGTERM",
    });
    const reportedFailures: unknown[] = [];

    const controller = createElectronMainShutdownController({
      disposeHost: () => Effect.fail(disposalError),
      drainHostCommands: () => Promise.resolve(),
      exitProcess: (exitCode) => {
        exitCodes.push(exitCode);
      },
      logger: {
        error(message, error) {
          return Effect.sync(() => errors.push({ message, error }));
        },
        info: () => Effect.void,
      },
      quitApp: () => {
        throw new Error("Expected signal shutdown to exit instead of quitting the app.");
      },
      reportFailure: (cause) => {
        reportedFailures.push(cause);
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
    expect(reportedFailures).toEqual([disposalError]);
  });

  test("shutdown controller disposes and exits when persistent logging fails", async () => {
    const persistenceError = new Error("openducktor.logs.append failed");
    const reportedFailures: unknown[] = [];
    const exitCodes: number[] = [];
    let disposeCalls = 0;
    let quitCalls = 0;

    const controller = createElectronMainShutdownController({
      disposeHost: () =>
        Effect.sync(() => {
          disposeCalls += 1;
        }),
      drainHostCommands: () => Promise.resolve(),
      exitProcess: (exitCode) => {
        exitCodes.push(exitCode);
      },
      logger: {
        error: () => Effect.fail(persistenceError),
        info: () => Effect.fail(persistenceError),
      },
      quitApp: () => {
        quitCalls += 1;
      },
      reportFailure: (cause) => {
        reportedFailures.push(cause);
      },
    });

    await controller.shutdownHostAndQuit({ reason: "window-all-closed" });

    expect(disposeCalls).toBe(1);
    expect(controller.isHostShutdownComplete()).toBe(true);
    expect(reportedFailures).toEqual([persistenceError]);
    expect(exitCodes).toEqual([1]);
    expect(quitCalls).toBe(0);
  });

  test("shutdown controller reports persistence and disposal failures together", async () => {
    const persistenceError = new Error("openducktor.logs.append failed");
    const disposalError = new ElectronLifecycleError({
      operation: "electron.main.dispose-host",
      message: "dispose failed",
    });
    const reportedFailures: unknown[] = [];
    const controller = createElectronMainShutdownController({
      disposeHost: () => Effect.fail(disposalError),
      drainHostCommands: () => Promise.resolve(),
      exitProcess: () => {},
      logger: {
        error: () => Effect.fail(persistenceError),
        info: () => Effect.fail(persistenceError),
      },
      quitApp: () => {},
      reportFailure: (cause) => {
        reportedFailures.push(cause);
      },
    });

    await controller.shutdownHostAndQuit({ reason: "window-all-closed" });

    expect(reportedFailures).toHaveLength(1);
    expect(reportedFailures[0]).toMatchObject({
      _tag: "ElectronLifecycleError",
      operation: "electron.main.shutdown-failure-report",
      details: { failures: [persistenceError, disposalError] },
    });
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
      drainHostCommands: () => Promise.resolve(),
      exitProcess: () => {},
      logger: {
        error: () => Effect.void,
        info: () => Effect.void,
      },
      quitApp: () => {},
      reportFailure: () => {},
    });

    await expect(
      controller.shutdownHostAndRun({
        reason: "update-install",
        runAfterShutdown: async () => {
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
        runAfterShutdown: async () => {
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

  test("shutdown controller marks a failed post-shutdown action as terminal", async () => {
    const installError = new Error("updater handoff failed");
    const controller = createElectronMainShutdownController({
      disposeHost: () => Effect.void,
      drainHostCommands: () => Promise.resolve(),
      exitProcess: () => {},
      logger: {
        error: () => Effect.void,
        info: () => Effect.void,
      },
      quitApp: () => {},
      reportFailure: () => {},
    });

    await expect(
      controller.shutdownHostAndRun({
        reason: "update-install",
        runAfterShutdown: async () => {
          throw installError;
        },
      }),
    ).rejects.toMatchObject({
      _tag: "ElectronLifecycleError",
      cause: installError,
      operation: "electron.main.run-after-shutdown",
    });
  });
});
