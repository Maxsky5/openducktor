import { readdir } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import {
  causeToWebBoundaryError,
  errorMessage,
  runWebBoundary,
  WebDependencyError,
  type WebError,
  WebOperationError,
} from "./effect/web-errors";
import { logError } from "./logger";
import type { TypescriptHostBackend } from "./typescript-host-backend";

type ManagedHost = Pick<Bun.Subprocess, "exited"> | TypescriptHostBackend;
type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SleepFunction = (durationMs: number) => Promise<unknown>;
type BackendReadinessDependencies = {
  fetch: FetchFunction;
  sleep: SleepFunction;
};
export type FrontendServer = {
  close(): Promise<void>;
};
type ForceCloseableHttpServer = {
  closeAllConnections?: () => void;
  closeIdleConnections?: () => void;
};
type FrontendServerWithHttpConnections = FrontendServer & {
  httpServer?: ForceCloseableHttpServer | null;
};
type StopLauncherServicesInput = {
  frontendServer: FrontendServer | null;
  hostBackend: TypescriptHostBackend;
};
type LauncherShutdownDependencies = {
  closeServer: (server: FrontendServer | null) => Promise<void>;
  stopHost: (hostBackend: TypescriptHostBackend) => Promise<void>;
};
type KeepAliveTimer = ReturnType<typeof setInterval>;
type ProcessKeepAliveDependencies = {
  clearInterval: (timer: KeepAliveTimer) => void;
  setInterval: (callback: () => void, durationMs: number) => KeepAliveTimer;
};

export const LOCALHOST = "127.0.0.1";

const APP_TOKEN_HEADER = "x-openducktor-app-token";
const FRONTEND_CLOSE_TIMEOUT_MS = 3_000;
const SHUTDOWN_KEEP_ALIVE_INTERVAL_MS = 1_000;

export const buildFrontendUrl = (port: number): string => `http://${LOCALHOST}:${port}`;

export const buildBackendUrl = (port: number): string => `http://${LOCALHOST}:${port}`;

export const buildFrontendDisplayUrls = (port: number): string[] => [
  `http://localhost:${port}/`,
  `http://${LOCALHOST}:${port}/`,
];

const verifyBackendReadinessEffect = (
  backendUrl: string,
  appToken: string,
  fetchImpl: FetchFunction,
  signal?: AbortSignal,
): Effect.Effect<void, WebDependencyError> =>
  Effect.gen(function* () {
    const healthResponse = yield* Effect.tryPromise({
      try: () => fetchImpl(`${backendUrl}/health`, signal ? { signal } : undefined),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "typescript-host-backend",
          operation: "health-check",
          message: errorMessage(cause),
          cause,
          details: { backendUrl },
        }),
    });
    if (!healthResponse.ok) {
      return yield* new WebDependencyError({
        dependency: "typescript-host-backend",
        operation: "health-check",
        message: `Health endpoint returned ${healthResponse.status}.`,
        details: { backendUrl, status: healthResponse.status },
      });
    }

    const sessionResponse = yield* Effect.tryPromise({
      try: () =>
        fetchImpl(`${backendUrl}/session`, {
          method: "POST",
          headers: {
            [APP_TOKEN_HEADER]: appToken,
          },
          ...(signal ? { signal } : {}),
        }),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "typescript-host-backend",
          operation: "session-check",
          message: errorMessage(cause),
          cause,
          details: { backendUrl },
        }),
    });
    if (!sessionResponse.ok) {
      return yield* new WebDependencyError({
        dependency: "typescript-host-backend",
        operation: "session-check",
        message: `Session endpoint rejected the launcher app token with status ${sessionResponse.status}.`,
        details: { backendUrl, status: sessionResponse.status },
      });
    }
  });

const forceCloseFrontendConnections = (server: FrontendServer): void => {
  const httpServer = (server as FrontendServerWithHttpConnections).httpServer;
  httpServer?.closeIdleConnections?.();
  httpServer?.closeAllConnections?.();
};

export const closeFrontendServerEffect = (
  server: FrontendServer | null,
  sleep: SleepFunction = Bun.sleep,
): Effect.Effect<void, WebDependencyError> =>
  Effect.gen(function* () {
    if (!server) {
      return;
    }

    // Capture only synchronous close-call failures here while preserving the
    // close Promise for Promise.race; async rejections are handled below.
    const closePromise = yield* Effect.try({
      try: () => server.close(),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "frontend-server",
          operation: "close",
          message: errorMessage(cause),
          cause,
        }),
    }).pipe(Effect.ensuring(Effect.sync(() => forceCloseFrontendConnections(server))));
    yield* Effect.tryPromise({
      try: () => Promise.race([closePromise, sleep(FRONTEND_CLOSE_TIMEOUT_MS)]),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "frontend-server",
          operation: "close",
          message: errorMessage(cause),
          cause,
        }),
    });
  });

const verifyBackendReadinessAttemptEffect = (
  backendUrl: string,
  appToken: string,
  fetchImpl: FetchFunction,
  timeoutMs: number,
): Effect.Effect<void, WebDependencyError> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      return { controller, timeout };
    }),
    ({ controller }) =>
      verifyBackendReadinessEffect(backendUrl, appToken, fetchImpl, controller.signal),
    ({ timeout }) => Effect.sync(() => clearTimeout(timeout)),
  );

export const closeFrontendServer = (
  server: FrontendServer | null,
  sleep: SleepFunction = Bun.sleep,
): Promise<void> => runWebBoundary(closeFrontendServerEffect(server, sleep));

export const waitForBackendEffect = (
  backendUrl: string,
  appToken: string,
  timeoutMs: number,
  hostProcess: ManagedHost,
  dependencies: BackendReadinessDependencies = { fetch, sleep: Bun.sleep },
): Effect.Effect<void, WebDependencyError | WebOperationError> =>
  Effect.gen(function* () {
    const startedAt = Date.now();
    let lastError: unknown;
    let earlyExitCode: number | null = null;

    yield* Effect.sync(() => {
      void hostProcess.exited.then((exitCode) => {
        earlyExitCode = exitCode;
      });
    });
    // Let an already-settled host exit promise win before applying the timeout path.
    yield* Effect.promise(() => Promise.resolve());

    while (Date.now() - startedAt < timeoutMs) {
      if (earlyExitCode !== null) {
        return yield* new WebOperationError({
          operation: "web.launcher.wait-for-backend",
          message: `OpenDucktor web host exited before startup completed with code ${earlyExitCode}.`,
          details: { backendUrl, exitCode: earlyExitCode },
        });
      }

      const remainingMs = timeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        break;
      }

      const readinessExit = yield* Effect.exit(
        verifyBackendReadinessAttemptEffect(backendUrl, appToken, dependencies.fetch, remainingMs),
      );
      if (readinessExit._tag === "Success") {
        return;
      }
      lastError = causeToWebBoundaryError(readinessExit.cause);

      yield* Effect.tryPromise({
        try: () => dependencies.sleep(250),
        catch: (cause) =>
          new WebDependencyError({
            dependency: "timer",
            operation: "wait-for-backend",
            message: errorMessage(cause),
            cause,
          }),
      });
    }

    if (earlyExitCode !== null) {
      return yield* new WebOperationError({
        operation: "web.launcher.wait-for-backend",
        message: `OpenDucktor web host exited before startup completed with code ${earlyExitCode}.`,
        details: { backendUrl, exitCode: earlyExitCode },
      });
    }

    const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
    return yield* new WebOperationError({
      operation: "web.launcher.wait-for-backend",
      message: `Timed out waiting for OpenDucktor web host at ${backendUrl}.${detail}`,
      details: { backendUrl, timeoutMs },
    });
  });

export const waitForBackend = (
  backendUrl: string,
  appToken: string,
  timeoutMs: number,
  hostProcess: ManagedHost,
  dependencies: BackendReadinessDependencies = { fetch, sleep: Bun.sleep },
): Promise<void> =>
  runWebBoundary(waitForBackendEffect(backendUrl, appToken, timeoutMs, hostProcess, dependencies));

export const buildBrowserRuntimeConfigJson = (backendUrl: string, appToken: string): string =>
  `${JSON.stringify({ backendUrl, appToken })}\n`;

export const resolveStaticAssetPath = (staticRoot: string, requestPath: string): string | null => {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  for (const character of decodedPath) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return null;
    }
  }
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }

  return path.join(staticRoot, normalized);
};

export const indexStaticAssetPaths = async (staticRoot: string): Promise<Set<string>> => {
  const assetPaths = new Set<string>();

  const visitDirectory = async (directoryPath: string): Promise<void> => {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          await visitDirectory(entryPath);
        } else if (entry.isFile()) {
          assetPaths.add(entryPath);
        }
      }),
    );
  };

  await visitDirectory(staticRoot);
  return assetPaths;
};

export const resolveIndexedStaticAssetPath = (
  staticRoot: string,
  indexPath: string,
  assetPaths: ReadonlySet<string>,
  requestPath: string,
): string | null => {
  const assetPath = resolveStaticAssetPath(staticRoot, requestPath);
  if (!assetPath) {
    return null;
  }
  if (assetPaths.has(assetPath)) {
    return assetPath;
  }
  return path.extname(assetPath) ? null : indexPath;
};

const launcherShutdownFailure = (failures: unknown[]): WebOperationError | null => {
  if (failures.length === 0) {
    return null;
  }
  if (failures.length === 1) {
    const [failure] = failures;
    return new WebOperationError({
      operation: "web.launcher.shutdown",
      message: errorMessage(failure),
      cause: failure,
    });
  }
  return new WebOperationError({
    operation: "web.launcher.shutdown",
    message: "OpenDucktor web shutdown failed.",
    details: { failures: failures.map(errorMessage) },
  });
};

const defaultLauncherShutdownDependencies: LauncherShutdownDependencies = {
  closeServer: closeFrontendServer,
  stopHost: (hostBackend) => hostBackend.stop(),
};

export const stopLauncherServicesEffect = (
  { frontendServer, hostBackend }: StopLauncherServicesInput,
  { closeServer, stopHost }: LauncherShutdownDependencies = defaultLauncherShutdownDependencies,
): Effect.Effect<void, WebError> =>
  Effect.gen(function* () {
    const [frontendCloseExit, hostStopExit] = yield* Effect.all(
      [
        Effect.exit(
          Effect.tryPromise({
            try: () => closeServer(frontendServer),
            catch: (cause) =>
              new WebDependencyError({
                dependency: "frontend-server",
                operation: "close",
                message: errorMessage(cause),
                cause,
              }),
          }),
        ),
        Effect.exit(
          Effect.tryPromise({
            try: () => stopHost(hostBackend),
            catch: (cause) =>
              new WebDependencyError({
                dependency: "typescript-host-backend",
                operation: "stop",
                message: errorMessage(cause),
                cause,
              }),
          }),
        ),
      ],
      { concurrency: "unbounded" },
    );
    const shutdownFailures = [frontendCloseExit, hostStopExit]
      .filter((result) => result._tag === "Failure")
      .map((result) => causeToWebBoundaryError(result.cause));
    for (const failure of shutdownFailures) {
      logError(errorMessage(failure));
    }
    if (hostStopExit._tag === "Failure") {
      const failure = launcherShutdownFailure(shutdownFailures);
      if (failure) {
        return yield* failure;
      }
      return;
    }

    const hostExitCode = yield* Effect.tryPromise({
      try: () => hostBackend.exited,
      catch: (cause) =>
        new WebDependencyError({
          dependency: "typescript-host-backend",
          operation: "await-exit",
          message: errorMessage(cause),
          cause,
        }),
    });
    if (hostExitCode !== 0) {
      shutdownFailures.push(
        new WebOperationError({
          operation: "web.launcher.shutdown",
          message: `OpenDucktor TypeScript host shutdown failed with exit code ${hostExitCode}.`,
          details: { hostExitCode },
        }),
      );
    }

    const failure = launcherShutdownFailure(shutdownFailures);
    if (failure) {
      return yield* failure;
    }
  });

export const stopLauncherServices = (
  input: StopLauncherServicesInput,
  dependencies: LauncherShutdownDependencies = defaultLauncherShutdownDependencies,
): Promise<void> => runWebBoundary(stopLauncherServicesEffect(input, dependencies));

export const keepProcessAliveDuringEffect = <T, E>(
  operation: Effect.Effect<T, E>,
  dependencies: ProcessKeepAliveDependencies = {
    clearInterval,
    setInterval,
  },
): Effect.Effect<T, E> =>
  Effect.acquireUseRelease(
    Effect.sync(() => dependencies.setInterval(() => {}, SHUTDOWN_KEEP_ALIVE_INTERVAL_MS)),
    () => operation,
    (timer) => Effect.sync(() => dependencies.clearInterval(timer)),
  );

export const keepProcessAliveDuring = <T>(
  operation: Promise<T>,
  dependencies: ProcessKeepAliveDependencies = {
    clearInterval,
    setInterval,
  },
): Promise<T> =>
  runWebBoundary(
    keepProcessAliveDuringEffect(
      Effect.tryPromise({
        try: () => operation,
        catch: (cause) =>
          new WebDependencyError({
            dependency: "launcher-operation",
            operation: "keep-process-alive",
            message: errorMessage(cause),
            cause,
          }),
      }),
      dependencies,
    ),
  );
