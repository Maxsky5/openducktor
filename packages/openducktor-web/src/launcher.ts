import { randomUUID } from "node:crypto";
import path from "node:path";
import { Deferred, Effect } from "effect";
import type { ViteDevServer } from "vite";
import {
  causeToWebBoundaryError,
  errorMessage,
  runWebBoundary,
  WebDependencyError,
  type WebError,
  WebResourceError,
} from "./effect/web-errors";
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
    if (signalLogExit._tag === "Failure") {
      return yield* causeToWebBoundaryError(signalLogExit.cause);
    }
    if (stopExit._tag === "Failure") {
      return yield* causeToWebBoundaryError(stopExit.cause);
    }
  });

export const runWebSignalShutdown = async ({
  boundary = defaultWebSignalProcessBoundary,
  exitCode,
  logger,
  signal,
  stop,
}: {
  boundary?: WebSignalProcessBoundary;
  exitCode: number;
  logger: WebLogger;
  signal: NodeJS.Signals;
  stop: Effect.Effect<void, WebError>;
}): Promise<void> => {
  try {
    await runWebBoundary(
      keepProcessAliveDuringEffect(stopLauncherForSignalEffect(signal, logger, stop)),
    );
    await boundary.flush();
    boundary.exit(exitCode);
  } catch (cause) {
    if (cause instanceof WebResourceError && cause.resource === "persistent-log") {
      boundary.reportFailure(cause);
    } else {
      try {
        await logger.error(errorMessage(cause));
      } catch (loggingCause) {
        boundary.reportFailure(loggingCause);
      }
    }
    await boundary.flush();
    boundary.exit(1);
  }
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
            Effect.gen(function* () {
              yield* cleanupStartedFrontendServerEffect(server, logger);
              return yield* error;
            }),
          ),
          Effect.onInterrupt(() =>
            cleanupStartedFrontendServerEffect(server, logger).pipe(Effect.orDie),
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
    let frontendServer: FrontendServer | null = null;
    let frontendClosed = false;
    let servicesReleased = false;
    let stopEffectRef: (() => Effect.Effect<void, WebError>) | null = null;

    const closeFrontendOnceEffect = (
      server: FrontendServer | null,
    ): Effect.Effect<void, WebError> =>
      Effect.suspend(() => {
        if (!server || frontendClosed) {
          return Effect.void;
        }
        frontendClosed = true;
        return closeFrontendServerEffect(server);
      });

    return yield* Effect.acquireUseRelease(
      startTypescriptHostBackendEffect({
        port: options.backendPort,
        frontendOrigin: frontendUrl,
        controlToken,
        appToken,
        providedToolPaths,
        runtimeDistribution,
        logger,
      }),
      (hostBackend) =>
        Effect.gen(function* () {
          const stopDeferred = yield* Deferred.make<void, WebError>();
          let stopStarted = false;
          let terminationStarted = false;
          let duplicateTerminationNoticeLogged = false;
          let duplicateTerminationLogFailed = false;

          const stopServicesWithLogsEffect = (): Effect.Effect<void, WebError> =>
            Effect.gen(function* () {
              let loggingFailure: WebError | undefined;
              const frontendLogExit = yield* Effect.exit(
                writeWebLogEffect(logger, "info", "Stopping OpenDucktor frontend server..."),
              );
              if (frontendLogExit._tag === "Failure") {
                loggingFailure = causeToWebBoundaryError(frontendLogExit.cause);
              }
              if (loggingFailure === undefined) {
                const hostLogExit = yield* Effect.exit(
                  writeWebLogEffect(
                    logger,
                    "info",
                    "Stopping OpenDucktor TypeScript host services...",
                  ),
                );
                if (hostLogExit._tag === "Failure") {
                  loggingFailure = causeToWebBoundaryError(hostLogExit.cause);
                }
              }

              const stopExit = yield* Effect.exit(
                stopLauncherServicesEffect(
                  { frontendServer, hostBackend, logger },
                  {
                    closeServer: (server) => runWebBoundary(closeFrontendOnceEffect(server)),
                    stopHost: (backend) => backend.stop(),
                  },
                ),
              );
              if (loggingFailure !== undefined) {
                return yield* loggingFailure;
              }
              if (stopExit._tag === "Failure") {
                return yield* causeToWebBoundaryError(stopExit.cause);
              }
              yield* writeWebLogEffect(logger, "success", "OpenDucktor web stopped.");
            });

          const stopEffect = (): Effect.Effect<void, WebError> =>
            Effect.suspend(() => {
              if (stopStarted) {
                return Deferred.await(stopDeferred);
              }
              stopStarted = true;
              return Effect.gen(function* () {
                const stopExit = yield* Effect.exit(stopServicesWithLogsEffect());
                servicesReleased = true;
                yield* Deferred.done(stopDeferred, stopExit);
                return yield* Deferred.await(stopDeferred);
              });
            });
          stopEffectRef = stopEffect;

          const handleTerminationSignal = (signal: NodeJS.Signals, exitCode: number): void => {
            if (terminationStarted) {
              if (!duplicateTerminationNoticeLogged) {
                duplicateTerminationNoticeLogged = true;
                void runWebBoundary(
                  writeWebLogEffect(
                    logger,
                    "info",
                    "OpenDucktor web shutdown is already in progress; waiting for cleanup to finish.",
                  ),
                ).catch((error: unknown) => {
                  duplicateTerminationLogFailed = true;
                  console.error(`OpenDucktor web fatal boundary: ${errorMessage(error)}`);
                });
              }
              return;
            }
            terminationStarted = true;
            void runWebSignalShutdown({
              boundary: {
                exit: (resolvedExitCode) => {
                  process.exit(duplicateTerminationLogFailed ? 1 : resolvedExitCode);
                },
                flush: flushProcessOutput,
                reportFailure: defaultWebSignalProcessBoundary.reportFailure,
              },
              exitCode,
              logger,
              signal,
              stop: stopEffect(),
            }).catch((cause: unknown) => {
              console.error(`OpenDucktor web fatal boundary: ${errorMessage(cause)}`);
              process.exit(1);
            });
          };

          const handleSigint = (): void => handleTerminationSignal("SIGINT", 130);
          const handleSigterm = (): void => handleTerminationSignal("SIGTERM", 143);

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
                    return yield* Effect.acquireUseRelease(
                      startFrontendServerEffect(options, backendUrl, appToken, logger),
                      (server) =>
                        Effect.gen(function* () {
                          frontendServer = server;
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
                          if (stopStarted) {
                            yield* stopEffect();
                          } else {
                            yield* writeWebLogEffect(
                              logger,
                              "info",
                              "OpenDucktor TypeScript host exited; stopping frontend server...",
                            );
                            yield* closeFrontendOnceEffect(server);
                            yield* writeWebLogEffect(logger, "success", "OpenDucktor web stopped.");
                            servicesReleased = true;
                          }
                          return exitCode;
                        }),
                      (server) =>
                        Effect.gen(function* () {
                          const closeExit = yield* Effect.exit(closeFrontendOnceEffect(server));
                          if (closeExit._tag === "Failure") {
                            yield* writeWebLogEffect(
                              logger,
                              "error",
                              errorMessage(causeToWebBoundaryError(closeExit.cause)),
                            ).pipe(Effect.orDie);
                          }
                        }),
                    );
                  }),
                );

                if (launcherExit._tag === "Success") {
                  return launcherExit.value;
                }

                const stopExit = yield* Effect.exit(stopEffect());
                if (stopExit._tag === "Failure") {
                  yield* writeWebLogEffect(
                    logger,
                    "error",
                    errorMessage(causeToWebBoundaryError(stopExit.cause)),
                  );
                }
                return yield* causeToWebBoundaryError(launcherExit.cause);
              }),
            () =>
              Effect.gen(function* () {
                process.off("SIGINT", handleSigint);
                process.off("SIGTERM", handleSigterm);
                if (!servicesReleased) {
                  const stopExit = yield* Effect.exit(stopEffect());
                  if (stopExit._tag === "Failure") {
                    yield* writeWebLogEffect(
                      logger,
                      "error",
                      errorMessage(causeToWebBoundaryError(stopExit.cause)),
                    ).pipe(Effect.orDie);
                  }
                }
              }),
          );
        }),
      (hostBackend) =>
        Effect.gen(function* () {
          if (servicesReleased) {
            return;
          }
          const stopExit = yield* Effect.exit(
            stopEffectRef
              ? stopEffectRef()
              : stopLauncherServicesEffect({ frontendServer, hostBackend, logger }),
          );
          servicesReleased = true;
          if (stopExit._tag === "Failure") {
            yield* writeWebLogEffect(
              logger,
              "error",
              errorMessage(causeToWebBoundaryError(stopExit.cause)),
            ).pipe(Effect.orDie);
          }
        }),
    );
  });

export const runLauncher = (options: LauncherOptions, logger: WebLogger): Promise<number> =>
  runWebBoundary(runLauncherEffect(options, logger));
