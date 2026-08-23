import { randomUUID } from "node:crypto";
import path from "node:path";
import { OPENDUCKTOR_DEV_INSTANCE_ENV, hasRuntimeType } from "@openducktor/contracts";
import type { McpBridgeDiscoveryMode } from "@openducktor/host";
import { Effect } from "effect";
import {
  type BrowserRuntimeConfigState,
  createBrowserRuntimeConfigState,
  readBrowserRuntimeConfig,
} from "./browser-runtime-config-state";
import {
  causeToWebBoundaryError,
  combineWebErrors,
  errorMessage,
  runWebBoundary,
  WebDependencyError,
  type WebError,
  WebResourceError,
} from "./effect/web-errors";
import { createWebLauncherLifecycle, type WebLauncherLifecycle } from "./launcher-lifecycle";
import {
  buildBackendUrl,
  buildBrowserRuntimeConfigJson,
  buildFrontendDisplayUrls,
  buildFrontendUrl,
  closeFrontendServerEffect,
  closeViteFrontendServer,
  type FrontendServer,
  indexStaticAssetPaths,
  keepProcessAliveDuringEffect,
  LOCALHOST,
  resolveIndexedStaticAssetPath,
  stopLauncherServicesEffect,
  waitForBackendEffect,
} from "./launcher-support";
import { type WebLogger, writeWebLogEffect } from "./logger";
import { RUNTIME_CONFIG_PATH } from "./runtime-config";
import {
  startTypescriptHostBackendEffect,
  type TypescriptHostBackend,
  type TypescriptHostBackendOptions,
} from "./typescript-host-backend";
import { resolveWebRuntimeDistributionEffect } from "./web-runtime-distribution";
import { resolveWebProvidedToolPathsEffect } from "./web-tool-discovery";

type CommonLauncherOptions = {
  packageRoot: string;
  frontendPort: number;
  backendPort: number;
  readinessTimeoutMs?: number;
};

export type LauncherOptions = CommonLauncherOptions &
  (
    | {
        developmentInstanceId: string;
        workspaceMode: true;
        workspaceRoot: string;
      }
    | {
        developmentInstanceId?: never;
        workspaceMode: false;
        workspaceRoot?: never;
      }
  );

export const resolveWebMcpBridgeDiscoveryMode = (workspaceMode: boolean): McpBridgeDiscoveryMode =>
  workspaceMode ? "development" : "production";

type CommonWebLauncherHostBackendOptions = Omit<
  TypescriptHostBackendOptions,
  "mcpBridgeDiscoveryMode" | "processEnv"
>;

export type WebLauncherHostBackendOptions = CommonWebLauncherHostBackendOptions &
  (
    | { developmentInstanceId: string; workspaceMode: true }
    | { developmentInstanceId?: never; workspaceMode: false }
  );

export const startWebLauncherHostBackendEffect = ({
  developmentInstanceId,
  workspaceMode,
  ...options
}: WebLauncherHostBackendOptions) => {
  const processEnv = workspaceMode
    ? { ...process.env, [OPENDUCKTOR_DEV_INSTANCE_ENV]: developmentInstanceId }
    : process.env;
  return startTypescriptHostBackendEffect({
    ...options,
    mcpBridgeDiscoveryMode: resolveWebMcpBridgeDiscoveryMode(workspaceMode),
    processEnv,
  });
};

type StartedFrontendServer = FrontendServer & {
  port: number;
};

const logFrontendAvailability = (
  port: number,
  backendUrl: string,
  developmentInstanceId: string | undefined,
  logger: WebLogger,
): Effect.Effect<void, WebError> =>
  Effect.gen(function* () {
    yield* writeWebLogEffect(logger, "success", "OpenDucktor web is ready:");
    for (const url of buildFrontendDisplayUrls(port)) {
      yield* writeWebLogEffect(logger, "success", `  ➜  Local:   ${url}`);
    }
    yield* writeWebLogEffect(logger, "success", `  ➜  Backend: ${backendUrl}`);
    if (developmentInstanceId) {
      yield* writeWebLogEffect(logger, "success", `  ➜  Instance: ${developmentInstanceId}`);
    }
  });

export const writeRuntimeConfigResponse = (
  runtimeConfigState: BrowserRuntimeConfigState,
  response: {
    end(body: string): void;
    setHeader(name: string, value: string): void;
    statusCode: number;
  },
  reportFailure: (cause: unknown) => void,
): Promise<void> => {
  response.setHeader("cache-control", "no-store");
  return Promise.resolve(readBrowserRuntimeConfig(runtimeConfigState))
    .then((runtimeConfig) => {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(runtimeConfig);
    })
    .catch(reportFailure);
};

const flushProcessOutput = async (): Promise<void> => {
  await Promise.all([
    new Promise<void>((resolve, reject) =>
      process.stdout.write("", (error) => (error ? reject(error) : resolve())),
    ),
    new Promise<void>((resolve, reject) =>
      process.stderr.write("", (error) => (error ? reject(error) : resolve())),
    ),
  ]);
};

type WebSignalProcessBoundary = {
  exit(exitCode: number): void;
  flush(): Promise<void>;
  reportFailure(cause: unknown): void;
};

const defaultWebSignalProcessBoundary: WebSignalProcessBoundary = {
  exit: (exitCode) => process.exit(exitCode),
  flush: flushProcessOutput,
  reportFailure: (cause) => {
    console.error(`OpenDucktor web fatal boundary: ${errorMessage(cause)}`);
  },
};

export { logDuplicateWebTerminationNotice } from "./launcher-lifecycle";

export const resolveWebSignalExitCode = (
  requestedExitCode: number,
  duplicateTerminationLogFailed: boolean,
): number => (duplicateTerminationLogFailed ? 1 : requestedExitCode);

const stopLauncherForSignalEffect = (
  signal: NodeJS.Signals,
  logger: WebLogger,
  stop: Effect.Effect<void, WebError>,
): Effect.Effect<void, WebError> =>
  Effect.gen(function* () {
    const signalLogExit = yield* Effect.exit(
      writeWebLogEffect(logger, "info", `Stopping OpenDucktor web after ${signal}...`),
    );
    const stopExit = yield* Effect.exit(stop);
    const failures: WebError[] = [];
    if (stopExit._tag === "Failure") {
      failures.push(causeToWebBoundaryError(stopExit.cause));
    }
    if (signalLogExit._tag === "Failure") {
      failures.push(causeToWebBoundaryError(signalLogExit.cause));
    }
    const failure = combineWebErrors(
      "web.launcher.signal-shutdown",
      failures.map(errorMessage).join("\n"),
      failures,
    );
    if (failure) {
      return yield* failure;
    }
  });

export const runWebSignalShutdown = async ({
  awaitDuplicateTerminationLog = async () => false,
  boundary = defaultWebSignalProcessBoundary,
  closeDuplicateTerminationLogAdmission = () => {},
  exitCode,
  logger,
  signal,
  stop,
}: {
  awaitDuplicateTerminationLog?: () => Promise<boolean>;
  boundary?: WebSignalProcessBoundary;
  closeDuplicateTerminationLogAdmission?: () => void;
  exitCode: number;
  logger: WebLogger;
  signal: NodeJS.Signals;
  stop: Effect.Effect<void, WebError>;
}): Promise<void> => {
  let resolvedExitCode = exitCode;
  try {
    await runWebBoundary(
      keepProcessAliveDuringEffect(stopLauncherForSignalEffect(signal, logger, stop)),
    );
  } catch (cause) {
    resolvedExitCode = 1;
    if (cause instanceof WebResourceError && cause.resource === "persistent-log") {
      boundary.reportFailure(cause);
    } else {
      try {
        await runWebBoundary(writeWebLogEffect(logger, "error", errorMessage(cause)));
      } catch (loggingCause) {
        boundary.reportFailure(loggingCause);
      }
    }
  }

  try {
    closeDuplicateTerminationLogAdmission();
    const duplicateTerminationLogFailed = await awaitDuplicateTerminationLog();
    resolvedExitCode = resolveWebSignalExitCode(resolvedExitCode, duplicateTerminationLogFailed);
  } catch (duplicateLogCause) {
    boundary.reportFailure(duplicateLogCause);
    resolvedExitCode = 1;
  }

  try {
    await boundary.flush();
  } catch (flushCause) {
    boundary.reportFailure(flushCause);
    resolvedExitCode = 1;
  }
  boundary.exit(resolvedExitCode);
};

const contentTypeForPath = (filePath: string): string => {
  switch (path.extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".png":
      return "image/png";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
};

const cleanupStartedFrontendServerEffect = (
  server: FrontendServer,
  logger: WebLogger,
): Effect.Effect<void, WebError> =>
  Effect.gen(function* () {
    const closeExit = yield* Effect.exit(closeFrontendServerEffect(server));
    if (closeExit._tag === "Failure") {
      yield* writeWebLogEffect(
        logger,
        "error",
        errorMessage(causeToWebBoundaryError(closeExit.cause)),
      );
    }
  });

const startViteServerEffect = (
  options: LauncherOptions,
  runtimeConfigState: BrowserRuntimeConfigState,
  logger: WebLogger,
): Effect.Effect<StartedFrontendServer, WebError> =>
  Effect.gen(function* () {
    const { createServer } = yield* Effect.tryPromise({
      try: () => import("vite"),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "vite",
          operation: "import",
          message: errorMessage(cause),
          cause,
        }),
    });
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const server = yield* Effect.tryPromise({
          try: () =>
            createServer({
              root: options.packageRoot,
              configFile: path.join(options.packageRoot, "vite.config.ts"),
              plugins: [
                {
                  name: "openducktor-runtime-config",
                  configureServer(devServer) {
                    devServer.middlewares.use(RUNTIME_CONFIG_PATH, (_request, response) => {
                      void writeRuntimeConfigResponse(
                        runtimeConfigState,
                        response,
                        defaultWebSignalProcessBoundary.reportFailure,
                      );
                    });
                  },
                },
              ],
              server: {
                host: LOCALHOST,
                port: options.frontendPort,
                strictPort: true,
              },
            }),
          catch: (cause) =>
            new WebDependencyError({
              dependency: "vite",
              operation: "create-server",
              message: errorMessage(cause),
              cause,
              details: { frontendPort: options.frontendPort },
            }),
        });
        const httpServer = server.httpServer;
        if (
          !httpServer ||
          !("closeAllConnections" in httpServer) ||
          !hasRuntimeType(httpServer.closeAllConnections, "function")
        ) {
          return yield* Effect.fail(
            new WebDependencyError({
              dependency: "vite",
              operation: "create-server",
              message: "Vite did not create the expected HTTP/1 server.",
              details: { frontendPort: options.frontendPort },
            }),
          );
        }
        const close = (): Promise<void> =>
          closeViteFrontendServer({
            close: () => server.close(),
            httpServer,
          });
        const startedServer = { close };

        yield* restore(
          Effect.tryPromise({
            try: () => server.listen(options.frontendPort),
            catch: (cause) =>
              new WebDependencyError({
                dependency: "vite",
                operation: "listen",
                message: errorMessage(cause),
                cause,
                details: { frontendPort: options.frontendPort },
              }),
          }),
        ).pipe(
          Effect.catchAll((error) =>
            preserveLauncherFailureAfterStop(
              error,
              closeFrontendServerEffect(startedServer),
              logger,
            ),
          ),
          Effect.onInterrupt(() =>
            cleanupStartedFrontendServerEffect(startedServer, logger).pipe(
              Effect.catchAll((cause) =>
                Effect.sync(() => defaultWebSignalProcessBoundary.reportFailure(cause)),
              ),
            ),
          ),
        );
        const address = httpServer.address();
        if (!address || hasRuntimeType(address, "string")) {
          return yield* preserveLauncherFailureAfterStop(
            new WebDependencyError({
              dependency: "vite",
              operation: "resolve-listening-port",
              message: "Vite did not expose its listening TCP port.",
              details: { frontendPort: options.frontendPort },
            }),
            closeFrontendServerEffect(startedServer),
            logger,
          );
        }
        return {
          close,
          httpServer: server.httpServer,
          port: address.port,
        };
      }),
    );
  });

const startStaticFrontendServerEffect = (
  options: LauncherOptions,
  runtimeConfigState: BrowserRuntimeConfigState,
): Effect.Effect<StartedFrontendServer, WebDependencyError | WebResourceError> =>
  Effect.gen(function* () {
    const staticRoot = path.join(options.packageRoot, "dist/web-shell");
    const indexPath = path.join(staticRoot, "index.html");
    const assetPaths = yield* Effect.tryPromise({
      try: () => indexStaticAssetPaths(staticRoot),
      catch: (cause) =>
        new WebResourceError({
          resource: "web-shell-assets",
          operation: "index",
          message: errorMessage(cause),
          cause,
          details: { indexPath, staticRoot },
        }),
    });
    if (!assetPaths.has(indexPath)) {
      return yield* new WebResourceError({
        resource: "web-shell-assets",
        operation: "resolve",
        message: `OpenDucktor web shell assets were not found at ${staticRoot}. Reinstall @openducktor/web or run the package build before starting.`,
        details: { indexPath, staticRoot },
      });
    }

    return yield* Effect.uninterruptible(
      Effect.try({
        try: () =>
          Bun.serve({
            hostname: LOCALHOST,
            port: options.frontendPort,
            async fetch(request) {
              const requestUrl = new URL(request.url);
              if (requestUrl.pathname === RUNTIME_CONFIG_PATH) {
                const runtimeConfig = await readBrowserRuntimeConfig(runtimeConfigState);
                return new Response(runtimeConfig, {
                  headers: {
                    "cache-control": "no-store",
                    "content-type": "application/json; charset=utf-8",
                  },
                });
              }

              const responsePath = resolveIndexedStaticAssetPath(
                staticRoot,
                indexPath,
                assetPaths,
                requestUrl.pathname,
              );
              if (!responsePath) {
                return new Response("Not found", { status: 404 });
              }

              return new Response(Bun.file(responsePath), {
                headers: {
                  "content-type": contentTypeForPath(responsePath),
                },
              });
            },
          }),
        catch: (cause) =>
          new WebDependencyError({
            dependency: "bun-server",
            operation: "start-static-frontend",
            message: errorMessage(cause),
            cause,
            details: { frontendPort: options.frontendPort },
          }),
      }).pipe(
        Effect.flatMap((server) => {
          if (server.port === undefined) {
            server.stop(true);
            return Effect.fail(
              new WebDependencyError({
                dependency: "bun-server",
                operation: "resolve-static-frontend-port",
                message: "The static frontend server did not expose its listening TCP port.",
                details: { frontendPort: options.frontendPort },
              }),
            );
          }
          return Effect.succeed({
            close: () => Promise.resolve(server.stop(true)).then(() => undefined),
            port: server.port,
          });
        }),
      ),
    );
  });

const startFrontendServerEffect = (
  options: LauncherOptions,
  runtimeConfigState: BrowserRuntimeConfigState,
  logger: WebLogger,
): Effect.Effect<StartedFrontendServer, WebError> =>
  options.workspaceMode
    ? startViteServerEffect(options, runtimeConfigState, logger)
    : startStaticFrontendServerEffect(options, runtimeConfigState);

export const preserveLauncherFailureAfterStop = (
  launcherFailure: WebError,
  stop: Effect.Effect<void, WebError>,
  logger: WebLogger,
): Effect.Effect<never, WebError> =>
  Effect.gen(function* () {
    const failures: WebError[] = [launcherFailure];
    const stopExit = yield* Effect.exit(stop);
    if (stopExit._tag === "Failure") {
      const stopFailure = causeToWebBoundaryError(stopExit.cause);
      failures.push(stopFailure);
      const loggingExit = yield* Effect.exit(
        writeWebLogEffect(logger, "error", errorMessage(stopFailure)),
      );
      if (loggingExit._tag === "Failure") {
        failures.push(causeToWebBoundaryError(loggingExit.cause));
      }
    }
    const failure = combineWebErrors(
      "web.launcher.failure-cleanup",
      errorMessage(launcherFailure),
      failures,
    );
    if (failure) {
      return yield* failure;
    }
    return yield* launcherFailure;
  });

const createLauncherLifecycle = (logger: WebLogger): Effect.Effect<WebLauncherLifecycle> =>
  createWebLauncherLifecycle({
    closeFrontend: closeFrontendServerEffect,
    logger,
    onSignalShutdownFailure: (cause) => {
      console.error(`OpenDucktor web fatal boundary: ${errorMessage(cause)}`);
      process.exit(1);
    },
    reportFailure: defaultWebSignalProcessBoundary.reportFailure,
    runSignalShutdown: runWebSignalShutdown,
    stopResources: ({ closeFrontend, frontendServer, hostBackend }) =>
      stopLauncherServicesEffect(
        { frontendServer, hostBackend, logger },
        {
          closeServer: (server) => runWebBoundary(closeFrontend(server)),
          stopHost: (backend) => backend.stop(),
        },
      ),
  });

const runStartedLauncherEffect = ({
  appToken,
  backendUrl,
  developmentInstanceId,
  frontendServer,
  hostBackend,
  logger,
  owner,
  readinessTimeoutMs,
}: {
  appToken: string;
  backendUrl: string;
  developmentInstanceId: string | undefined;
  frontendServer: StartedFrontendServer;
  hostBackend: TypescriptHostBackend;
  logger: WebLogger;
  owner: WebLauncherLifecycle;
  readinessTimeoutMs: number;
}): Effect.Effect<number, WebError> =>
  Effect.gen(function* () {
    const launcherExit = yield* Effect.exit(
      Effect.gen(function* () {
        yield* writeWebLogEffect(
          logger,
          "info",
          "Waiting for OpenDucktor TypeScript host readiness...",
        );
        yield* waitForBackendEffect(backendUrl, appToken, readinessTimeoutMs, hostBackend);
        yield* logFrontendAvailability(
          frontendServer.port,
          backendUrl,
          developmentInstanceId,
          logger,
        );

        const exitCode = yield* Effect.tryPromise({
          try: () => hostBackend.exited,
          catch: (cause) =>
            new WebDependencyError({
              dependency: "typescript-host-backend",
              operation: "await-exit",
              message: errorMessage(cause),
              cause,
            }),
        });
        yield* owner.completeAfterHostExit();
        return exitCode;
      }),
    );

    if (launcherExit._tag === "Success") {
      return launcherExit.value;
    }
    return yield* preserveLauncherFailureAfterStop(
      causeToWebBoundaryError(launcherExit.cause),
      owner.stop(),
      logger,
    );
  });

const runWithLauncherSignalsEffect = <Success, Failure>(
  owner: WebLauncherLifecycle,
  operation: Effect.Effect<Success, Failure>,
): Effect.Effect<Success, Failure> => {
  const handleSigint = (): void => {
    void owner.handleTermination("SIGINT", 130);
  };
  const handleSigterm = (): void => {
    void owner.handleTermination("SIGTERM", 143);
  };

  return Effect.acquireUseRelease(
    Effect.sync(() => {
      process.on("SIGINT", handleSigint);
      process.on("SIGTERM", handleSigterm);
    }),
    () => operation,
    () =>
      Effect.gen(function* () {
        process.off("SIGINT", handleSigint);
        process.off("SIGTERM", handleSigterm);
        yield* owner.release();
      }),
  );
};

export const runLauncherEffect = (
  options: LauncherOptions,
  logger: WebLogger,
): Effect.Effect<number, WebError> =>
  Effect.gen(function* () {
    const readinessTimeoutMs = options.readinessTimeoutMs ?? 60_000;
    const controlToken = randomUUID();
    const appToken = randomUUID();
    const runtimeConfigState = createBrowserRuntimeConfigState();
    const developmentInstanceId = options.workspaceMode ? options.developmentInstanceId : undefined;
    const runtimeDistribution = yield* resolveWebRuntimeDistributionEffect({
      packageRoot: options.packageRoot,
      workspaceMode: options.workspaceMode,
      ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : undefined),
    });
    const providedToolPaths = yield* resolveWebProvidedToolPathsEffect();
    const hostDiscoveryOptions = options.workspaceMode
      ? {
          developmentInstanceId: options.developmentInstanceId,
          workspaceMode: true as const,
        }
      : { workspaceMode: false as const };
    const owner = yield* createLauncherLifecycle(logger);

    return yield* runWithLauncherSignalsEffect(
      owner,
      Effect.gen(function* () {
        yield* writeWebLogEffect(logger, "info", "Starting OpenDucktor frontend server...");
        const frontendServer = yield* startFrontendServerEffect(
          options,
          runtimeConfigState,
          logger,
        );
        yield* owner.registerFrontend(frontendServer);
        const frontendUrl = buildFrontendUrl(frontendServer.port);
        yield* writeWebLogEffect(logger, "info", "Starting OpenDucktor TypeScript host...");
        const hostBackendExit = yield* Effect.exit(
          startWebLauncherHostBackendEffect({
            port: options.backendPort,
            frontendOrigin: frontendUrl,
            controlToken,
            appToken,
            onBackgroundFailure: defaultWebSignalProcessBoundary.reportFailure,
            providedToolPaths,
            runtimeDistribution,
            logger,
            ...hostDiscoveryOptions,
          }),
        );
        if (hostBackendExit._tag === "Failure") {
          return yield* preserveLauncherFailureAfterStop(
            causeToWebBoundaryError(hostBackendExit.cause),
            owner.stop(),
            logger,
          );
        }
        const hostBackend = hostBackendExit.value;
        yield* owner.registerHost(hostBackend);
        const backendUrl = buildBackendUrl(hostBackend.port);
        yield* Effect.sync(() => {
          runtimeConfigState.publish(buildBrowserRuntimeConfigJson(backendUrl, appToken));
        });
        return yield* runStartedLauncherEffect({
          appToken,
          backendUrl,
          developmentInstanceId,
          frontendServer,
          hostBackend,
          logger,
          owner,
          readinessTimeoutMs,
        });
      }),
    );
  });

export const runLauncher = (options: LauncherOptions, logger: WebLogger): Promise<number> =>
  runWebBoundary(runLauncherEffect(options, logger));
