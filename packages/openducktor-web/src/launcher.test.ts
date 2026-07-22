import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { WebOperationError } from "./effect/web-errors";
import {
  logDuplicateWebTerminationNotice,
  preserveLauncherFailureAfterStop,
  resolveWebMcpBridgeDiscoveryMode,
  runWebSignalShutdown,
} from "./launcher";
import {
  buildBrowserRuntimeConfigJson,
  buildFrontendDisplayUrls,
  closeFrontendServer,
  indexStaticAssetPaths,
  keepProcessAliveDuring,
  resolveIndexedStaticAssetPath,
  resolveStaticAssetPath,
  stopLauncherServices,
  waitForBackend,
} from "./launcher-support";
import type { WebLogger } from "./logger";

const testLogger: WebLogger = {
  error: () => Effect.void,
  info: () => Effect.void,
  success: () => Effect.void,
};

const createHostProcess = (exited: Promise<number>): Bun.Subprocess => {
  return { exited } as Bun.Subprocess;
};

describe("launcher internals", () => {
  test("uses development discovery for workspace source launches", () => {
    expect(resolveWebMcpBridgeDiscoveryMode(true)).toBe("development");
  });

  test("uses production discovery for installed static launches", () => {
    expect(resolveWebMcpBridgeDiscoveryMode(false)).toBe("production");
  });

  test("waits for the fake host health and token-authenticated session endpoints", async () => {
    const requests: Array<{ url: string; method: string | undefined; token: string | null }> = [];
    let healthAttempts = 0;
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(url),
        method: init?.method,
        token: headers.get("x-openducktor-app-token"),
      });
      if (String(url).endsWith("/health")) {
        healthAttempts += 1;
        return new Response(null, { status: healthAttempts === 1 ? 503 : 200 });
      }
      return new Response(null, { status: 200 });
    };

    await waitForBackend(
      "http://127.0.0.1:14327",
      "app-token",
      1_000,
      createHostProcess(new Promise<number>(() => {})),
      { fetch: fetchImpl, sleep: async () => {} },
    );

    expect(requests).toEqual([
      { url: "http://127.0.0.1:14327/health", method: undefined, token: null },
      { url: "http://127.0.0.1:14327/health", method: undefined, token: null },
      { url: "http://127.0.0.1:14327/session", method: "POST", token: "app-token" },
    ]);
  });

  test("fails fast when the fake host exits before readiness", async () => {
    const exited = Promise.resolve(9);
    await exited;

    await expect(
      waitForBackend("http://127.0.0.1:14327", "app-token", 0, createHostProcess(exited), {
        fetch: async () => new Response(null, { status: 503 }),
        sleep: async () => {},
      }),
    ).rejects.toThrow("OpenDucktor web host exited before startup completed with code 9.");
    await expect(
      waitForBackend("http://127.0.0.1:14327", "app-token", 0, createHostProcess(exited), {
        fetch: async () => new Response(null, { status: 503 }),
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ _tag: "WebOperationError" });
  });

  test("fails fast when the host readiness exit rejects", async () => {
    const backgroundFailure = new Error("task-sync persistent logging failed");

    await expect(
      waitForBackend(
        "http://127.0.0.1:14327",
        "app-token",
        0,
        createHostProcess(Promise.reject(backgroundFailure)),
        {
          fetch: async () => new Response(null, { status: 503 }),
          sleep: async () => {},
        },
      ),
    ).rejects.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.launcher.wait-for-backend",
      cause: backgroundFailure,
    });
  });

  test("aborts readiness fetches when the launcher timeout expires", async () => {
    let aborted = false;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("readiness aborted"));
        });
      });

    await expect(
      waitForBackend(
        "http://127.0.0.1:14327",
        "app-token",
        10,
        createHostProcess(new Promise<number>(() => {})),
        {
          fetch: fetchImpl,
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow("Timed out waiting for OpenDucktor web host");
    expect(aborted).toBe(true);
  });

  test("stops frontend and host services directly", async () => {
    let stopCalls = 0;
    let frontendCloseCalls = 0;
    let resolveExited: (exitCode: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExited = resolve;
    });
    const hostBackend = {
      exited,
      port: 14327,
      stop: async () => {
        stopCalls += 1;
        resolveExited(0);
      },
    };
    const frontendServer = {
      close: async () => {
        frontendCloseCalls += 1;
      },
    };

    await stopLauncherServices(
      {
        frontendServer,
        hostBackend,
        logger: testLogger,
      },
      {
        closeServer: async (server) => {
          await server?.close();
        },
        stopHost: async (backend) => {
          await backend.stop();
        },
      },
    );

    expect(frontendCloseCalls).toBe(1);
    expect(stopCalls).toBe(1);
  });

  test("forces open frontend server connections during Vite shutdown", async () => {
    let closeAllConnectionsCalls = 0;
    let closeIdleConnectionsCalls = 0;
    let closeCalls = 0;
    let resolveClose: () => void = () => {};
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const frontendServer = {
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

    await closeFrontendServer(frontendServer);

    expect(closeCalls).toBe(1);
    expect(closeIdleConnectionsCalls).toBe(1);
    expect(closeAllConnectionsCalls).toBe(1);
  });

  test("forces open frontend connections even when close throws synchronously", async () => {
    let closeAllConnectionsCalls = 0;
    let closeIdleConnectionsCalls = 0;
    const frontendServer = {
      httpServer: {
        closeAllConnections: () => {
          closeAllConnectionsCalls += 1;
        },
        closeIdleConnections: () => {
          closeIdleConnectionsCalls += 1;
        },
      },
      close: () => {
        throw new Error("close failed");
      },
    };

    const result = await closeFrontendServer(frontendServer).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    if (result.ok) {
      throw new Error("Expected closeFrontendServer to reject");
    }

    expect(result.error).toMatchObject({ _tag: "WebDependencyError" });
    expect(result.error).toEqual(expect.objectContaining({ message: "close failed" }));
    expect(closeIdleConnectionsCalls).toBe(1);
    expect(closeAllConnectionsCalls).toBe(1);
  });

  test("keeps frontend shutdown bounded when close never resolves", async () => {
    let timeoutMs = 0;
    const frontendServer = {
      close: () => new Promise<void>(() => {}),
    };

    await closeFrontendServer(frontendServer, async (durationMs) => {
      timeoutMs = durationMs;
    });

    expect(timeoutMs).toBe(3_000);
  });

  test("keeps the process alive while shutdown work is pending", async () => {
    let intervalCallback: (() => void) | null = null;
    const timer = Symbol("timer") as unknown as ReturnType<typeof setInterval>;
    const clearedTimers: Array<ReturnType<typeof setInterval>> = [];
    let finishOperation: () => void = () => {};
    const operation = new Promise<void>((resolve) => {
      finishOperation = resolve;
    });

    const keepAlivePromise = keepProcessAliveDuring(operation, {
      clearInterval: (nextTimer) => {
        clearedTimers.push(nextTimer);
      },
      setInterval: (callback) => {
        intervalCallback = callback;
        return timer;
      },
    });

    expect(intervalCallback).not.toBeNull();
    expect(clearedTimers).toEqual([]);

    finishOperation();
    await keepAlivePromise;
    expect(clearedTimers).toEqual([timer]);
  });

  test("awaits a delayed duplicate-signal persistence failure before exiting", async () => {
    const persistenceError = new Error(
      "openducktor.logs.append failed for /tmp/openducktor-web.log",
    );
    const exitCodes: number[] = [];
    const reportedFailures: unknown[] = [];
    let markLogStarted: () => void = () => {};
    const logStarted = new Promise<void>((resolve) => {
      markLogStarted = resolve;
    });
    let rejectLog: () => void = () => {};

    const duplicateLogFailed = Effect.runPromise(
      logDuplicateWebTerminationNotice(
        {
          error: () => Effect.void,
          info: () =>
            Effect.tryPromise({
              try: () =>
                new Promise<void>((_resolve, reject) => {
                  markLogStarted();
                  rejectLog = () => reject(persistenceError);
                }),
              catch: (cause) => cause,
            }),
          success: () => Effect.void,
        },
        (cause) => {
          reportedFailures.push(cause);
        },
      ),
    );
    await logStarted;
    let markDuplicateAwaitStarted: () => void = () => {};
    const duplicateAwaitStarted = new Promise<void>((resolve) => {
      markDuplicateAwaitStarted = resolve;
    });

    const shutdown = runWebSignalShutdown({
      awaitDuplicateTerminationLog: () => {
        markDuplicateAwaitStarted();
        return duplicateLogFailed;
      },
      boundary: {
        exit: (exitCode) => exitCodes.push(exitCode),
        flush: async () => {},
        reportFailure: (cause) => reportedFailures.push(cause),
      },
      exitCode: 143,
      logger: {
        error: () => Effect.void,
        info: () => Effect.void,
        success: () => Effect.void,
      },
      signal: "SIGTERM",
      stop: Effect.void,
    });

    await duplicateAwaitStarted;
    expect(exitCodes).toEqual([]);
    rejectLog();
    await shutdown;

    expect(exitCodes).toEqual([1]);
    expect(reportedFailures).toEqual([
      expect.objectContaining({
        _tag: "WebResourceError",
        cause: persistenceError,
        resource: "persistent-log",
      }),
    ]);
  });

  test("closes duplicate-signal log admission before the final output flush", async () => {
    const exitCodes: number[] = [];
    let admissionOpen = true;
    let duplicateLogStarts = 0;
    let markFlushStarted: () => void = () => {};
    const flushStarted = new Promise<void>((resolve) => {
      markFlushStarted = resolve;
    });
    let releaseFlush: () => void = () => {};
    const flushReleased = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });

    const shutdown = runWebSignalShutdown({
      awaitDuplicateTerminationLog: async () => false,
      boundary: {
        exit: (exitCode) => exitCodes.push(exitCode),
        flush: async () => {
          if (admissionOpen) {
            duplicateLogStarts += 1;
          }
          markFlushStarted();
          await flushReleased;
        },
        reportFailure: () => {},
      },
      closeDuplicateTerminationLogAdmission: () => {
        admissionOpen = false;
      },
      exitCode: 143,
      logger: {
        error: () => Effect.void,
        info: () => Effect.void,
        success: () => Effect.void,
      },
      signal: "SIGTERM",
      stop: Effect.void,
    });

    await flushStarted;
    expect(duplicateLogStarts).toBe(0);
    expect(exitCodes).toEqual([]);

    releaseFlush();
    await shutdown;
    expect(exitCodes).toEqual([143]);
  });

  test("signal logging failures still run cleanup and exit through the explicit boundary", async () => {
    const persistenceError = new Error("openducktor.logs.append failed");
    const exitCodes: number[] = [];
    const reportedFailures: unknown[] = [];
    let cleanupCalls = 0;
    let flushCalls = 0;

    await runWebSignalShutdown({
      boundary: {
        exit: (exitCode) => {
          exitCodes.push(exitCode);
        },
        flush: async () => {
          flushCalls += 1;
        },
        reportFailure: (cause) => {
          reportedFailures.push(cause);
        },
      },
      exitCode: 143,
      logger: {
        error: () => Effect.die("The failed persistent logger must not be retried."),
        info: () => Effect.fail(persistenceError),
        success: () => Effect.void,
      },
      signal: "SIGTERM",
      stop: Effect.sync(() => {
        cleanupCalls += 1;
      }),
    });

    expect(cleanupCalls).toBe(1);
    expect(flushCalls).toBe(1);
    expect(exitCodes).toEqual([1]);
    expect(reportedFailures).toEqual([
      expect.objectContaining({
        _tag: "WebResourceError",
        cause: persistenceError,
        resource: "persistent-log",
      }),
    ]);
  });

  test("signal shutdown persists cleanup and logging failures together", async () => {
    const persistenceError = new Error("openducktor.logs.append failed");
    const cleanupError = new WebOperationError({
      operation: "web.launcher.cleanup",
      message: "frontend cleanup failed",
    });
    const persistedErrors: string[] = [];
    const exitCodes: number[] = [];

    await runWebSignalShutdown({
      boundary: {
        exit: (exitCode) => exitCodes.push(exitCode),
        flush: async () => {},
        reportFailure: () => {},
      },
      exitCode: 143,
      logger: {
        error: (message) => Effect.sync(() => persistedErrors.push(message)),
        info: () => Effect.fail(persistenceError),
        success: () => Effect.void,
      },
      signal: "SIGTERM",
      stop: Effect.fail(cleanupError),
    });

    expect(persistedErrors).toHaveLength(1);
    expect(persistedErrors[0]).toContain("frontend cleanup failed");
    expect(persistedErrors[0]).toContain("openducktor.logs.append failed");
    expect(exitCodes).toEqual([1]);
  });

  test("does not wait for the host exit code when host stop fails", async () => {
    const hostBackend = {
      exited: new Promise<number>(() => {}),
      port: 14327,
      stop: async () => {},
    };

    await expect(
      stopLauncherServices(
        {
          frontendServer: null,
          hostBackend,
          logger: testLogger,
        },
        {
          closeServer: async () => {},
          stopHost: async () => {
            throw new Error("host stop failed");
          },
        },
      ),
    ).rejects.toThrow("host stop failed");
    await expect(
      stopLauncherServices(
        {
          frontendServer: null,
          hostBackend,
          logger: testLogger,
        },
        {
          closeServer: async () => {},
          stopHost: async () => {
            throw new Error("host stop failed");
          },
        },
      ),
    ).rejects.toMatchObject({
      _tag: "WebDependencyError",
      dependency: "typescript-host-backend",
      operation: "stop",
    });
  });

  test("preserves frontend and host shutdown failures together", async () => {
    const frontendFailure = new Error("frontend close failed");
    const hostFailure = new Error("host stop failed");
    const hostBackend = {
      exited: new Promise<number>(() => {}),
      port: 14327,
      stop: async () => {},
    };

    await expect(
      stopLauncherServices(
        { frontendServer: null, hostBackend, logger: testLogger },
        {
          closeServer: async () => {
            throw frontendFailure;
          },
          stopHost: async () => {
            throw hostFailure;
          },
        },
      ),
    ).rejects.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.launcher.shutdown",
      details: {
        failures: [
          expect.objectContaining({ cause: frontendFailure }),
          expect.objectContaining({ cause: hostFailure }),
        ],
      },
    });
  });

  test("preserves frontend shutdown and rejected host exit failures together", async () => {
    const frontendFailure = new Error("frontend close failed");
    const hostExitFailure = new Error("host background logging failed");
    const hostBackend = {
      exited: Promise.reject(hostExitFailure),
      port: 14327,
      stop: async () => {},
    };

    await expect(
      stopLauncherServices(
        { frontendServer: null, hostBackend, logger: testLogger },
        {
          closeServer: async () => {
            throw frontendFailure;
          },
          stopHost: async () => {},
        },
      ),
    ).rejects.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.launcher.shutdown",
      details: {
        failures: [
          expect.objectContaining({ cause: frontendFailure }),
          expect.objectContaining({ cause: hostExitFailure, operation: "await-exit" }),
        ],
      },
    });
  });

  test("preserves cleanup failures when shutdown error logging fails", async () => {
    const frontendFailure = new Error("frontend close failed");
    const persistenceFailure = new Error("log append failed");
    const hostBackend = {
      exited: Promise.resolve(0),
      port: 14327,
      stop: async () => {},
    };

    await expect(
      stopLauncherServices(
        {
          frontendServer: null,
          hostBackend,
          logger: {
            error: () => Effect.fail(persistenceFailure),
            info: () => Effect.void,
            success: () => Effect.void,
          },
        },
        {
          closeServer: async () => {
            throw frontendFailure;
          },
          stopHost: async () => {},
        },
      ),
    ).rejects.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.launcher.shutdown",
      details: {
        failures: [
          expect.objectContaining({ cause: frontendFailure }),
          expect.objectContaining({ cause: persistenceFailure }),
        ],
      },
    });
  });

  test("preserves launcher, cleanup, and cleanup-log failures together", async () => {
    const launcherFailure = new WebOperationError({
      operation: "web.launcher.start",
      message: "launcher failed",
    });
    const cleanupFailure = new WebOperationError({
      operation: "web.launcher.cleanup",
      message: "cleanup failed",
    });
    const loggingFailure = new Error("log append failed");

    await expect(
      Effect.runPromise(
        Effect.flip(
          preserveLauncherFailureAfterStop(launcherFailure, Effect.fail(cleanupFailure), {
            error: () => Effect.fail(loggingFailure),
            info: () => Effect.void,
            success: () => Effect.void,
          }),
        ),
      ),
    ).resolves.toMatchObject({
      _tag: "WebOperationError",
      operation: "web.launcher.failure-cleanup",
      details: {
        failures: [
          launcherFailure,
          cleanupFailure,
          expect.objectContaining({
            _tag: "WebResourceError",
            cause: loggingFailure,
          }),
        ],
      },
    });
  });

  test("builds runtime config JSON for the browser shell", () => {
    expect(buildBrowserRuntimeConfigJson("http://127.0.0.1:14327", "app-token")).toBe(
      '{"backendUrl":"http://127.0.0.1:14327","appToken":"app-token"}\n',
    );
  });

  test("prints localhost first in the frontend availability URLs", () => {
    expect(buildFrontendDisplayUrls(1420)).toEqual([
      "http://localhost:1420/",
      "http://127.0.0.1:1420/",
    ]);
  });

  test("rejects static asset paths that escape the web shell root", () => {
    expect(resolveStaticAssetPath("/web-shell", "/assets/app.js")).toBe(
      path.join("/web-shell", "assets/app.js"),
    );
    expect(resolveStaticAssetPath("/web-shell", "/../secret.txt")).toBeNull();
    expect(resolveStaticAssetPath("/web-shell", "/foo/..")).toBeNull();
    expect(resolveStaticAssetPath("/web-shell", "/foo%2F..")).toBeNull();
  });

  test("rejects malformed and decoded control characters in static request paths", () => {
    expect(resolveStaticAssetPath("/web-shell", "/%E0%A4%A")).toBeNull();
    expect(resolveStaticAssetPath("/web-shell", "/%00")).toBeNull();
    expect(resolveStaticAssetPath("/web-shell", "/%0A")).toBeNull();
    expect(resolveStaticAssetPath("/web-shell", "/%C2%80")).toBeNull();
  });

  test("resolves static requests against the startup asset index", () => {
    const staticRoot = path.resolve("/web-shell");
    const indexPath = path.join(staticRoot, "index.html");
    const appPath = path.join(staticRoot, "assets/app.js");
    const assetPaths = new Set([indexPath, appPath]);

    expect(resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, "/")).toBe(indexPath);
    expect(resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, "/assets/app.js")).toBe(
      appPath,
    );
    expect(
      resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, "/missing.js"),
    ).toBeNull();
    expect(
      resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, "/missing%2Ejs"),
    ).toBeNull();
    expect(resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, "/%00")).toBeNull();
    expect(resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, "/tasks/example")).toBe(
      indexPath,
    );
    expect(
      resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, "/%2e%2e/secret.txt"),
    ).toBeNull();

    const traversalUrl = new URL("http://127.0.0.1/%2e%2e%2fsecret.txt");
    expect(
      resolveIndexedStaticAssetPath(staticRoot, indexPath, assetPaths, traversalUrl.pathname),
    ).toBeNull();
  });

  test("indexes nested web shell assets during startup", async () => {
    const staticRoot = await mkdtemp(path.join(os.tmpdir(), "openducktor-web-shell-"));
    const assetDirectory = path.join(staticRoot, "assets");
    const chunksDirectory = path.join(assetDirectory, "chunks");
    const indexPath = path.join(staticRoot, "index.html");
    const appPath = path.join(chunksDirectory, "app.js");

    try {
      await mkdir(chunksDirectory, { recursive: true });
      await Promise.all([writeFile(indexPath, "shell"), writeFile(appPath, "app")]);

      expect(await indexStaticAssetPaths(staticRoot)).toEqual(new Set([appPath, indexPath]));
    } finally {
      await rm(staticRoot, { force: true, recursive: true });
    }
  });
});
