import type { ServerOptions as ViteServerOptions } from "vite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { OPENDUCKTOR_DEV_INSTANCE_ENV } from "@openducktor/contracts";
import type { McpBridgeDiscoveryMode } from "@openducktor/host";
import { Effect } from "effect";
import { z } from "zod";
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
  WebValidationError,
} from "./effect/web-errors";
import { createWebLauncherLifecycle, type WebLauncherLifecycle } from "./launcher-lifecycle";
import {
  buildBrowserBackendUrl,
  buildBrowserRuntimeConfigJson,
  buildFrontendDisplayUrls,
  buildFrontendUrl,
  closeFrontendServerEffect,
  closeViteFrontendServer,
  type FrontendServer,
  indexStaticAssetPaths,
  keepProcessAliveDuringEffect,
  resolveIndexedStaticAssetPath,
  stopLauncherServicesEffect,
  waitForBackendEffect,
} from "./launcher-support";
import {
  allowedHostnamesFor,
  isIpLiteral,
  isLoopbackHost,
  isRemoteExternalOrigin,
  isRequestHostAllowed,
  LOCALHOST,
  portOfHttpOrigin,
} from "./http-origin";
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
  host?: string;
  externalUrl?: string;
  basePath?: string;
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
  externalUrl: string | undefined,
  bindHost: string,
  logger: WebLogger,
): Effect.Effect<void, WebError> =>
  Effect.gen(function* () {
    yield* writeWebLogEffect(logger, "success", "OpenDucktor web is ready:");
    for (const { kind, url } of buildFrontendDisplayUrls(port, externalUrl)) {
      const label = kind === "local" ? "Local:   " : "Network: ";
      yield* writeWebLogEffect(logger, "success", `  ➜  ${label}${url}`);
    }
    yield* writeWebLogEffect(logger, "success", `  ➜  Backend: ${backendUrl}`);
    if (developmentInstanceId) {
      yield* writeWebLogEffect(logger, "success", `  ➜  Instance: ${developmentInstanceId}`);
    }
    if (isRemoteExternalOrigin(externalUrl) && !isLoopbackHost(bindHost)) {
      yield* writeWebLogEffect(
        logger,
        "info",
        "OpenDucktor web is reachable outside this machine. Restrict access with a firewall or a Tailscale ACL before using it.",
      );
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

export const viteServerOptions = (options: LauncherOptions): ViteServerOptions => {
  const serverOptions: ViteServerOptions = {
    host: options.host ?? LOCALHOST,
    port: options.frontendPort,
    strictPort: true,
    fs: {
      allow: [options.packageRoot, path.join(options.packageRoot, "../frontend/src")],
    },
  };
  const externalUrl = options.externalUrl?.trim();
  if (externalUrl && isRemoteExternalOrigin(externalUrl)) {
    const hostname = new URL(externalUrl).hostname;
    if (!isIpLiteral(hostname)) {
      serverOptions.allowedHosts = ["localhost", ".localhost", hostname];
    }
  }
  return serverOptions;
};

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
                ...viteServerOptions(options),
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
          httpServer.closeAllConnections === undefined
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
        const address = z.object({ port: z.number() }).safeParse(httpServer.address());
        if (!address.success) {
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
          port: address.data.port,
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

    const allowedHostnames = allowedHostnamesFor({
      bindHost: options.host ?? LOCALHOST,
      externalUrl: options.externalUrl?.trim() || undefined,
    });

    return yield* Effect.uninterruptible(
      Effect.try({
        try: () =>
          Bun.serve({
            hostname: options.host ?? LOCALHOST,
            port: options.frontendPort,
            async fetch(request) {
              if (!isRequestHostAllowed(request, allowedHostnames)) {
                return new Response("Host not allowed.", { status: 403 });
              }
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
  bindHost,
  developmentInstanceId,
  externalUrl,
  frontendServer,
  hostBackend,
  logger,
  owner,
  readinessTimeoutMs,
  readinessUrl,
}: {
  appToken: string;
  backendUrl: string;
  bindHost: string;
  developmentInstanceId: string | undefined;
  externalUrl: string | undefined;
  frontendServer: StartedFrontendServer;
  hostBackend: TypescriptHostBackend;
  logger: WebLogger;
  owner: WebLauncherLifecycle;
  readinessTimeoutMs: number;
  readinessUrl: string;
}): Effect.Effect<number, WebError> =>
  Effect.gen(function* () {
    const launcherExit = yield* Effect.exit(
      Effect.gen(function* () {
        yield* writeWebLogEffect(
          logger,
          "info",
          "Waiting for OpenDucktor TypeScript host readiness...",
        );
        yield* waitForBackendEffect(readinessUrl, appToken, readinessTimeoutMs, hostBackend);
        yield* logFrontendAvailability(
          frontendServer.port,
          backendUrl,
          developmentInstanceId,
          externalUrl,
          bindHost,
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

export const validateLauncherNetworkOptionsEffect = (options: {
  basePath: string | undefined;
  bindHost: string;
  externalUrl: string | undefined;
}): Effect.Effect<void, WebValidationError> =>
  Effect.gen(function* () {
    const remoteExternalUrl = isRemoteExternalOrigin(options.externalUrl);
    if (!isLoopbackHost(options.bindHost) && !remoteExternalUrl) {
      return yield* new WebValidationError({
        field: "externalUrl",
        message:
          "OpenDucktor web binds a non-loopback host without a remote --external-url. Browsers cannot reach a loopback backend URL from another machine; set --external-url to the URL browsers will use.",
        details: { host: options.bindHost },
      });
    }
    if (options.basePath !== undefined && options.externalUrl === undefined) {
      return yield* new WebValidationError({
        field: "basePath",
        message:
          "OpenDucktor web serves the TypeScript host under --base-path without --external-url. The base path is only reachable through a reverse proxy; set --external-url to the URL browsers will use.",
        details: { basePath: options.basePath },
      });
    }
  });

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
    const bindHost = options.host?.trim() || LOCALHOST;
    const externalUrl = options.externalUrl?.trim() || undefined;
    yield* validateLauncherNetworkOptionsEffect({
      basePath: options.basePath,
      bindHost,
      externalUrl,
    });
    const runtimeDistributionInput: Parameters<typeof resolveWebRuntimeDistributionEffect>[0] = {
      packageRoot: options.packageRoot,
      workspaceMode: options.workspaceMode,
    };
    if (options.workspaceRoot) {
      runtimeDistributionInput.workspaceRoot = options.workspaceRoot;
    }
    const runtimeDistribution =
      yield* resolveWebRuntimeDistributionEffect(runtimeDistributionInput);
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
        const frontendUrl = externalUrl ?? buildFrontendUrl(frontendServer.port, bindHost);
        const parsedExternalUrl = externalUrl === undefined ? undefined : new URL(externalUrl);
        if (
          parsedExternalUrl !== undefined &&
          portOfHttpOrigin(parsedExternalUrl) !== String(frontendServer.port)
        ) {
          yield* writeWebLogEffect(
            logger,
            "info",
            `The --external-url port does not match the frontend port ${frontendServer.port}. Browsers reach the frontend only through --external-url. Set --port to match, or map the port in the proxy.`,
          );
        }
        if (parsedExternalUrl?.protocol === "https:" && options.basePath === undefined) {
          yield* writeWebLogEffect(
            logger,
            "info",
            `The --external-url origin is https without --base-path. The browser reaches the TypeScript host at https://${parsedExternalUrl.hostname}:${options.backendPort}. Terminate TLS for that port in the proxy.`,
          );
        }
        yield* writeWebLogEffect(logger, "info", "Starting OpenDucktor TypeScript host...");
        const hostBackendExit = yield* Effect.exit(
          startWebLauncherHostBackendEffect({
            port: options.backendPort,
            host: bindHost,
            ...(options.basePath !== undefined && {
              basePath: options.basePath,
            }),
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
        const { browserUrl, directUrl } = buildBrowserBackendUrl(
          options.basePath,
          frontendUrl,
          externalUrl,
          bindHost,
          hostBackend.port,
        );
        yield* Effect.sync(() => {
          runtimeConfigState.publish(buildBrowserRuntimeConfigJson(browserUrl, appToken));
        });
        return yield* runStartedLauncherEffect({
          appToken,
          backendUrl: browserUrl,
          bindHost,
          developmentInstanceId,
          externalUrl,
          frontendServer,
          hostBackend,
          logger,
          owner,
          readinessTimeoutMs,
          readinessUrl: directUrl,
        });
      }),
    );
  });

export const runLauncher = (options: LauncherOptions, logger: WebLogger): Promise<number> =>
  runWebBoundary(runLauncherEffect(options, logger));
