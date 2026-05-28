import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { ViteDevServer } from "vite";
import { logError, logInfo, logSuccess } from "./logger";
import { RUNTIME_CONFIG_PATH } from "./runtime-config";
import { startTypescriptHostBackend, type TypescriptHostBackend } from "./typescript-host-backend";

export type LauncherOptions = {
  packageRoot: string;
  workspaceRoot?: string;
  workspaceMode: boolean;
  frontendPort: number;
  backendPort: number;
  readinessTimeoutMs?: number;
};

type ManagedHost = Pick<Bun.Subprocess, "exited"> | TypescriptHostBackend;
type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SleepFunction = (durationMs: number) => Promise<unknown>;
type BackendReadinessDependencies = {
  fetch: FetchFunction;
  sleep: SleepFunction;
};
type FrontendServer = {
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

const LOCALHOST = "127.0.0.1";
const APP_TOKEN_HEADER = "x-openducktor-app-token";
const SHUTDOWN_KEEP_ALIVE_INTERVAL_MS = 1_000;

const buildFrontendUrl = (port: number): string => `http://${LOCALHOST}:${port}`;
const buildBackendUrl = (port: number): string => `http://${LOCALHOST}:${port}`;

const buildFrontendDisplayUrls = (port: number): string[] => [
  `http://localhost:${port}/`,
  `http://${LOCALHOST}:${port}/`,
];

const logFrontendAvailability = (port: number): void => {
  logSuccess("OpenDucktor web is ready:");
  for (const url of buildFrontendDisplayUrls(port)) {
    logSuccess(`  ➜  Local:   ${url}`);
  }
};

const verifyBackendReadiness = async (
  backendUrl: string,
  appToken: string,
  fetchImpl: FetchFunction,
): Promise<void> => {
  const healthResponse = await fetchImpl(`${backendUrl}/health`);
  if (!healthResponse.ok) {
    throw new Error(`Health endpoint returned ${healthResponse.status}.`);
  }

  const sessionResponse = await fetchImpl(`${backendUrl}/session`, {
    method: "POST",
    headers: {
      [APP_TOKEN_HEADER]: appToken,
    },
  });
  if (!sessionResponse.ok) {
    throw new Error(
      `Session endpoint rejected the launcher app token with status ${sessionResponse.status}.`,
    );
  }
};

const forceCloseFrontendConnections = (server: FrontendServer): void => {
  const httpServer = (server as FrontendServerWithHttpConnections).httpServer;
  httpServer?.closeIdleConnections?.();
  httpServer?.closeAllConnections?.();
};

const closeFrontendServer = async (server: FrontendServer | null): Promise<void> => {
  if (!server) {
    return;
  }

  const closePromise = server.close();
  forceCloseFrontendConnections(server);
  await closePromise;
};

const waitForBackend = async (
  backendUrl: string,
  appToken: string,
  timeoutMs: number,
  hostProcess: ManagedHost,
  dependencies: BackendReadinessDependencies = { fetch, sleep: Bun.sleep },
): Promise<void> => {
  const startedAt = Date.now();
  let lastError: unknown;
  let earlyExitCode: number | null = null;

  void hostProcess.exited.then((exitCode) => {
    earlyExitCode = exitCode;
  });

  while (Date.now() - startedAt < timeoutMs) {
    if (earlyExitCode !== null) {
      throw new Error(
        `OpenDucktor web host exited before startup completed with code ${earlyExitCode}.`,
      );
    }

    try {
      await verifyBackendReadiness(backendUrl, appToken, dependencies.fetch);
      return;
    } catch (error) {
      lastError = error;
    }

    await dependencies.sleep(250);
  }

  if (earlyExitCode !== null) {
    throw new Error(
      `OpenDucktor web host exited before startup completed with code ${earlyExitCode}.`,
    );
  }

  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for OpenDucktor web host at ${backendUrl}.${detail}`);
};

const buildBrowserRuntimeConfigJson = (backendUrl: string, appToken: string): string =>
  `${JSON.stringify({ backendUrl, appToken })}\n`;

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

const resolveStaticAssetPath = (staticRoot: string, requestPath: string): string | null => {
  const decodedPath = decodeURIComponent(requestPath);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }

  return path.join(staticRoot, normalized);
};

const throwLauncherShutdownFailures = (failures: unknown[]): void => {
  if (failures.length === 0) {
    return;
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  throw new AggregateError(failures, "OpenDucktor web shutdown failed.");
};

const defaultLauncherShutdownDependencies: LauncherShutdownDependencies = {
  closeServer: closeFrontendServer,
  stopHost: (hostBackend) => hostBackend.stop(),
};

const stopLauncherServices = async (
  { frontendServer, hostBackend }: StopLauncherServicesInput,
  { closeServer, stopHost }: LauncherShutdownDependencies = defaultLauncherShutdownDependencies,
): Promise<void> => {
  const [frontendCloseResult, hostStopResult] = await Promise.allSettled([
    closeServer(frontendServer),
    stopHost(hostBackend),
  ]);
  const shutdownFailures = [frontendCloseResult, hostStopResult]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  for (const failure of shutdownFailures) {
    logError(failure instanceof Error ? failure.message : failure);
  }
  if (hostStopResult.status === "rejected") {
    throwLauncherShutdownFailures(shutdownFailures);
    return;
  }

  const hostExitCode = await hostBackend.exited;
  if (hostExitCode !== 0) {
    shutdownFailures.push(
      new Error(`OpenDucktor TypeScript host shutdown failed with exit code ${hostExitCode}.`),
    );
  }

  throwLauncherShutdownFailures(shutdownFailures);
};

const keepProcessAliveDuring = async <T>(
  operation: Promise<T>,
  dependencies: ProcessKeepAliveDependencies = {
    clearInterval,
    setInterval,
  },
): Promise<T> => {
  const timer = dependencies.setInterval(() => {}, SHUTDOWN_KEEP_ALIVE_INTERVAL_MS);
  try {
    return await operation;
  } finally {
    dependencies.clearInterval(timer);
  }
};

export const __launcherTestInternals = {
  buildFrontendDisplayUrls,
  buildBrowserRuntimeConfigJson,
  closeFrontendServer,
  keepProcessAliveDuring,
  resolveStaticAssetPath,
  stopLauncherServices,
  verifyBackendReadiness,
  waitForBackend,
};

const startViteServer = async (
  options: LauncherOptions,
  backendUrl: string,
  appToken: string,
): Promise<ViteDevServer> => {
  const { createServer } = await import("vite");
  const runtimeConfigJson = buildBrowserRuntimeConfigJson(backendUrl, appToken);
  const server = await createServer({
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
  });

  await server.listen(options.frontendPort);
  return server;
};

const startStaticFrontendServer = async (
  options: LauncherOptions,
  backendUrl: string,
  appToken: string,
): Promise<FrontendServer> => {
  const staticRoot = path.join(options.packageRoot, "dist/web-shell");
  const indexPath = path.join(staticRoot, "index.html");
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    throw new Error(
      `OpenDucktor web shell assets were not found at ${staticRoot}. Reinstall @openducktor/web or run the package build before starting.`,
    );
  }

  const runtimeConfigJson = buildBrowserRuntimeConfigJson(backendUrl, appToken);
  const server = Bun.serve({
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

      const assetPath = resolveStaticAssetPath(staticRoot, requestUrl.pathname);
      if (!assetPath) {
        return new Response("Not found", { status: 404 });
      }

      const assetExists = existsSync(assetPath) && statSync(assetPath).isFile();
      if (!assetExists && path.extname(requestUrl.pathname)) {
        return new Response("Not found", { status: 404 });
      }

      const responsePath = assetExists ? assetPath : indexPath;
      return new Response(Bun.file(responsePath), {
        headers: {
          "content-type": contentTypeForPath(responsePath),
        },
      });
    },
  });

  return {
    async close() {
      server.stop(true);
    },
  };
};

const startFrontendServer = async (
  options: LauncherOptions,
  backendUrl: string,
  appToken: string,
): Promise<FrontendServer> => {
  if (options.workspaceMode) {
    return startViteServer(options, backendUrl, appToken);
  }

  return startStaticFrontendServer(options, backendUrl, appToken);
};

export const runLauncher = async (options: LauncherOptions): Promise<number> => {
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 60_000;
  const frontendUrl = buildFrontendUrl(options.frontendPort);
  const backendUrl = buildBackendUrl(options.backendPort);
  const controlToken = randomUUID();
  const appToken = randomUUID();
  const hostBackend = await startTypescriptHostBackend({
    port: options.backendPort,
    frontendOrigin: frontendUrl,
    controlToken,
    appToken,
  });
  let frontendServer: FrontendServer | null = null;
  let stopPromise: Promise<void> | null = null;
  let terminationStarted = false;
  let duplicateTerminationNoticeLogged = false;

  const stop = async (): Promise<void> => {
    if (stopPromise) {
      return stopPromise;
    }

    stopPromise = (async () => {
      logInfo("Stopping OpenDucktor frontend server...");
      logInfo("Stopping OpenDucktor TypeScript host services...");

      await stopLauncherServices({ frontendServer, hostBackend });
      logSuccess("OpenDucktor web stopped.");
    })();

    return stopPromise;
  };

  const handleTerminationSignal = (signal: NodeJS.Signals, exitCode: number): void => {
    if (terminationStarted) {
      if (!duplicateTerminationNoticeLogged) {
        duplicateTerminationNoticeLogged = true;
        logInfo("OpenDucktor web shutdown is already in progress; waiting for cleanup to finish.");
      }
      return;
    }
    terminationStarted = true;
    logInfo(`Stopping OpenDucktor web after ${signal}...`);

    void keepProcessAliveDuring(stop()).then(
      () => {
        process.exit(exitCode);
      },
      (error: unknown) => {
        logError(error instanceof Error ? error.message : String(error));
        process.exit(1);
      },
    );
  };

  process.on("SIGINT", () => handleTerminationSignal("SIGINT", 130));
  process.on("SIGTERM", () => handleTerminationSignal("SIGTERM", 143));

  try {
    logInfo("Starting OpenDucktor TypeScript host...");
    logInfo("Waiting for OpenDucktor TypeScript host readiness...");
    await waitForBackend(backendUrl, appToken, readinessTimeoutMs, hostBackend);
    logInfo("Starting OpenDucktor frontend server...");
    frontendServer = await startFrontendServer(options, backendUrl, appToken);
    logFrontendAvailability(options.frontendPort);

    const exitCode = await hostBackend.exited;
    if (stopPromise) {
      await stop();
    } else {
      await closeFrontendServer(frontendServer);
    }
    return exitCode;
  } catch (error) {
    await stop();
    throw error;
  }
};
