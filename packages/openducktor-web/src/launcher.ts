import { randomUUID } from "node:crypto";
import path from "node:path";
import type { McpBridgeDiscoveryMode } from "@openducktor/host";
import { Effect } from "effect";
import type { ViteDevServer } from "vite";
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
import { startTypescriptHostBackendEffect } from "./typescript-host-backend";
import { resolveWebRuntimeDistributionEffect } from "./web-runtime-distribution";
import { resolveWebProvidedToolPathsEffect } from "./web-tool-discovery";

export type LauncherOptions = {
  packageRoot: string;
  workspaceRoot?: string;
  workspaceMode: boolean;
  frontendPort: number;
  backendPort: number;
  readinessTimeoutMs?: number;
};

export const resolveWebMcpBridgeDiscoveryMode = (workspaceMode: boolean): McpBridgeDiscoveryMode =>
  workspaceMode ? "development" : "production";

const logFrontendAvailability = (port: number, logger: WebLogger): Effect.Effect<void, WebError> =>
  Effect.gen(function* () {
    yield* writeWebLogEffect(logger, "success", "OpenDucktor web is ready:");
    for (const url of buildFrontendDisplayUrls(port)) {
      yield* writeWebLogEffect(logger, "success", `  ➜  Local:   ${url}`);
    }
  });

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
  backendUrl: string,
  appToken: string,
  logger: WebLogger,
): Effect.Effect<ViteDevServer, WebError> =>
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
    const runtimeConfigJson = buildBrowserRuntimeConfigJson(backendUrl, appToken);

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
                      response.statusCode = 200;
                      response.setHeader("content-type", "application/json; charset=utf-8");
                      response.setHeader("cache-control", "no-store");
                      response.end(runtimeConfigJson);
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
            preserveLauncherFailureAfterStop(error, closeFrontendServerEffect(server), logger),
          ),
          Effect.onInterrupt(() =>
            cleanupStartedFrontendServerEffect(server, logger).pipe(
              Effect.catchAll((cause) =>
                Effect.sync(() => defaultWebSignalProcessBoundary.reportFailure(cause)),
              ),
            ),
          ),
        );
        return server;
      }),
    );
  });

const startStaticFrontendServerEffect = (
  options: LauncherOptions,
  backendUrl: string,
  appToken: string,
): Effect.Effect<FrontendServer, WebDependencyError | WebResourceError> =>
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

    const runtimeConfigJson = buildBrowserRuntimeConfigJson(backendUrl, appToken);
    return yield* Effect.uninterruptible(
      Effect.try({
        try: () =>
          Bun.serve({
            hostname: LOCALHOST,
            port: options.frontendPort,
            fetch(request) {
              const requestUrl = new URL(request.url);
              if (requestUrl.pathname === RUNTIME_CONFIG_PATH) {
                return new Response(runtimeConfigJson, {
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
        Effect.map((server) => ({
          async close() {
            server.stop(true);
          },
        })),
      ),
    );
  });

const startFrontendServerEffect = (
  options: LauncherOptions,
  backendUrl: string,
  appToken: string,
  logger: WebLogger,
): Effect.Effect<FrontendServer, WebError> =>
  options.workspaceMode
    ? startViteServerEffect(options, backendUrl, appToken, logger)
    : startStaticFrontendServerEffect(options, backendUrl, appToken);

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

export const runLauncherEffect = (
  options: LauncherOptions,
  logger: WebLogger,
): Effect.Effect<number, WebError> =>
  Effect.gen(function* () {
    const readinessTimeoutMs = options.readinessTimeoutMs ?? 60_000;
    const frontendUrl = buildFrontendUrl(options.frontendPort);
    const backendUrl = buildBackendUrl(options.backendPort);
    const controlToken = randomUUID();
    const appToken = randomUUID();
    const runtimeDistribution = yield* resolveWebRuntimeDistributionEffect({
      packageRoot: options.packageRoot,
      workspaceMode: options.workspaceMode,
      ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
    });
    const providedToolPaths = yield* resolveWebProvidedToolPathsEffect();
    let lifecycle: WebLauncherLifecycle | null = null;

    return yield* Effect.acquireUseRelease(
      startTypescriptHostBackendEffect({
        port: options.backendPort,
        frontendOrigin: frontendUrl,
        controlToken,
        appToken,
        onBackgroundFailure: defaultWebSignalProcessBoundary.reportFailure,
        providedToolPaths,
        runtimeDistribution,
        logger,
        mcpBridgeDiscoveryMode: resolveWebMcpBridgeDiscoveryMode(options.workspaceMode),
      }),
      (hostBackend) =>
        Effect.gen(function* () {
          const owner = yield* createWebLauncherLifecycle({
            closeFrontend: closeFrontendServerEffect,
            logger,
            onSignalShutdownFailure: (cause) => {
              console.error(`OpenDucktor web fatal boundary: ${errorMessage(cause)}`);
              process.exit(1);
            },
            reportFailure: defaultWebSignalProcessBoundary.reportFailure,
            runSignalShutdown: runWebSignalShutdown,
            stopResources: ({ closeFrontend, frontendServer }) =>
              stopLauncherServicesEffect(
                { frontendServer, hostBackend, logger },
                {
                  closeServer: (server) => runWebBoundary(closeFrontend(server)),
                  stopHost: (backend) => backend.stop(),
                },
              ),
          });
          lifecycle = owner;

          const handleSigint = (): void => owner.handleTermination("SIGINT", 130);
          const handleSigterm = (): void => owner.handleTermination("SIGTERM", 143);

          return yield* Effect.acquireUseRelease(
            Effect.sync(() => {
              process.on("SIGINT", handleSigint);
              process.on("SIGTERM", handleSigterm);
            }),
            () =>
              Effect.gen(function* () {
                const launcherExit = yield* Effect.exit(
                  Effect.gen(function* () {
                    yield* writeWebLogEffect(
                      logger,
                      "info",
                      "Starting OpenDucktor TypeScript host...",
                    );
                    yield* writeWebLogEffect(
                      logger,
                      "info",
                      "Waiting for OpenDucktor TypeScript host readiness...",
                    );
                    yield* waitForBackendEffect(
                      backendUrl,
                      appToken,
                      readinessTimeoutMs,
                      hostBackend,
                    );
                    yield* writeWebLogEffect(
                      logger,
                      "info",
                      "Starting OpenDucktor frontend server...",
                    );
                    const server = yield* startFrontendServerEffect(
                      options,
                      backendUrl,
                      appToken,
                      logger,
                    );
                    yield* owner.registerFrontend(server);
                    yield* logFrontendAvailability(options.frontendPort, logger);

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
              }),
            () =>
              Effect.gen(function* () {
                process.off("SIGINT", handleSigint);
                process.off("SIGTERM", handleSigterm);
                yield* owner.release();
              }),
          );
        }),
      (hostBackend) =>
        Effect.gen(function* () {
          if (lifecycle) {
            yield* lifecycle.release();
            return;
          }
          const stopExit = yield* Effect.exit(
            stopLauncherServicesEffect({ frontendServer: null, hostBackend, logger }),
          );
          if (stopExit._tag === "Failure") {
            yield* Effect.sync(() =>
              defaultWebSignalProcessBoundary.reportFailure(
                causeToWebBoundaryError(stopExit.cause),
              ),
            );
          }
        }),
    );
  });

export const runLauncher = (options: LauncherOptions, logger: WebLogger): Promise<number> =>
  runWebBoundary(runLauncherEffect(options, logger));
