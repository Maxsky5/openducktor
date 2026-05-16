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

type ManagedProcess = Bun.Subprocess;
type ManagedHost = Pick<Bun.Subprocess, "exited"> | TypescriptHostBackend;
type BackendReadinessDependencies = {
  fetch: typeof fetch;
  sleep: (durationMs: number) => Promise<unknown>;
};
type HostTerminationDependencies = {
  platform: NodeJS.Platform;
  killProcess: typeof process.kill;
  terminateWindowsProcessTree: (pid: number) => Promise<void>;
  sleep: (durationMs: number) => Promise<unknown>;
};
type FrontendServer = {
  close(): Promise<void>;
};

const LOCALHOST = "127.0.0.1";
const CONTROL_TOKEN_HEADER = "x-openducktor-control-token";
const APP_TOKEN_HEADER = "x-openducktor-app-token";
const VITE_CLOSE_TIMEOUT_MS = 3_000;
const HOST_GRACEFUL_EXIT_TIMEOUT_MS = 2_000;
const FORCE_EXIT_SIGNAL_GRACE_MS = 1_500;
const HOST_FORCE_TERMINATION_GRACE_MS = 3_000;
const HOST_FORCE_KILL_WAIT_MS = 1_000;

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

const requestHostShutdown = async (
  backendUrl: string,
  controlToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetchImpl(`${backendUrl}/shutdown`, {
      method: "POST",
      headers: {
        [CONTROL_TOKEN_HEADER]: controlToken,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenDucktor web host shutdown failed with status ${response.status}.`);
    }
  } finally {
    clearTimeout(timeout);
  }
};

const verifyBackendReadiness = async (
  backendUrl: string,
  appToken: string,
  fetchImpl: typeof fetch,
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

const defaultHostTerminationDependencies: HostTerminationDependencies = {
  platform: process.platform,
  killProcess: process.kill,
  terminateWindowsProcessTree: async (pid: number) => {
    const taskkill = Bun.spawn({
      cmd: ["taskkill", "/PID", String(pid), "/T", "/F"],
      stdout: "ignore",
      stderr: "ignore",
    });
    await Promise.race([taskkill.exited, Bun.sleep(HOST_FORCE_TERMINATION_GRACE_MS)]);
  },
  sleep: Bun.sleep,
};

const waitForHostExit = async (
  child: ManagedProcess,
  durationMs: number,
  sleep: HostTerminationDependencies["sleep"],
): Promise<number | null> => {
  return Promise.race([child.exited, sleep(durationMs).then(() => null)]);
};

const waitForGracefulHostExitCode = async (
  child: ManagedHost,
  sleep: HostTerminationDependencies["sleep"] = Bun.sleep,
): Promise<number | null> => {
  return Promise.race([
    child.exited.then((exitCode) => exitCode),
    sleep(HOST_GRACEFUL_EXIT_TIMEOUT_MS).then(() => null),
  ]);
};

const terminateHostProcess = async (
  child: ManagedProcess | null,
  dependencies: HostTerminationDependencies = defaultHostTerminationDependencies,
): Promise<void> => {
  if (!child) {
    return;
  }

  const pid = child.pid;
  const hasProcessGroupPid = typeof pid === "number" && pid > 0;

  if (dependencies.platform === "win32") {
    if (hasProcessGroupPid) {
      await dependencies.terminateWindowsProcessTree(pid);
    } else {
      child.kill();
    }
    const exitCode = await waitForHostExit(child, HOST_FORCE_KILL_WAIT_MS, dependencies.sleep);
    if (exitCode === null) {
      throw new Error(`Timed out waiting for OpenDucktor web host process ${pid} to exit.`);
    }
    return;
  }

  if (hasProcessGroupPid) {
    dependencies.killProcess(-pid, "SIGTERM");
  }

  child.kill();
  await dependencies.sleep(HOST_FORCE_TERMINATION_GRACE_MS);

  if (hasProcessGroupPid) {
    try {
      dependencies.killProcess(-pid, 0);
    } catch {
      child.kill(9);
      const exitCode = await waitForHostExit(child, HOST_FORCE_KILL_WAIT_MS, dependencies.sleep);
      if (exitCode === null) {
        throw new Error(`Timed out waiting for OpenDucktor web host process ${pid} to exit.`);
      }
      return;
    }
    dependencies.killProcess(-pid, "SIGKILL");
  }

  child.kill(9);
  const exitCode = await waitForHostExit(child, HOST_FORCE_KILL_WAIT_MS, dependencies.sleep);
  if (exitCode === null) {
    throw new Error(
      `Timed out waiting for OpenDucktor web host process ${pid ?? "unknown"} to exit.`,
    );
  }
};

const closeFrontendServer = async (server: FrontendServer | null): Promise<void> => {
  if (!server) {
    return;
  }

  await Promise.race([server.close(), Bun.sleep(VITE_CLOSE_TIMEOUT_MS)]);
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

const shouldForceExitForRepeatedSignal = (
  firstSignalReceivedAt: number,
  now: number,
  graceMs = FORCE_EXIT_SIGNAL_GRACE_MS,
): boolean => now - firstSignalReceivedAt >= graceMs;

export const __launcherTestInternals = {
  buildFrontendDisplayUrls,
  buildBrowserRuntimeConfigJson,
  resolveStaticAssetPath,
  requestHostShutdown,
  shouldForceExitForRepeatedSignal,
  terminateHostProcess,
  verifyBackendReadiness,
  waitForBackend,
  waitForGracefulHostExitCode,
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
  let stopping = false;
  let stopPromise: Promise<void> | null = null;
  let firstShutdownSignalReceivedAt: number | null = null;
  let duplicateSignalNoticeLogged = false;

  const stop = async (): Promise<void> => {
    if (stopPromise) {
      return stopPromise;
    }
    stopping = true;

    stopPromise = (async () => {
      logInfo("Stopping OpenDucktor frontend server...");
      logInfo("Stopping OpenDucktor TypeScript host services...");

      const shutdownResults = await Promise.allSettled([
        requestHostShutdown(backendUrl, controlToken),
        closeFrontendServer(frontendServer),
      ]);

      const shutdownError = shutdownResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (shutdownError) {
        logError(
          shutdownError.reason instanceof Error
            ? shutdownError.reason.message
            : shutdownError.reason,
        );
        throw shutdownError.reason;
      }

      let hostExitCode = await waitForGracefulHostExitCode(hostBackend);
      if (hostExitCode === null) {
        logInfo("Ensuring OpenDucktor TypeScript host has stopped...");
        await hostBackend.stop();
        hostExitCode = await hostBackend.exited;
      }
      if (hostExitCode !== 0) {
        throw new Error(
          `OpenDucktor TypeScript host shutdown failed with exit code ${hostExitCode}.`,
        );
      }
      logSuccess("OpenDucktor web stopped.");
    })();

    return stopPromise;
  };

  const handleShutdownSignal = (signal: NodeJS.Signals, exitCode: number): void => {
    const now = Date.now();
    if (firstShutdownSignalReceivedAt !== null) {
      if (!shouldForceExitForRepeatedSignal(firstShutdownSignalReceivedAt, now)) {
        if (!duplicateSignalNoticeLogged) {
          duplicateSignalNoticeLogged = true;
          logInfo(
            `Received duplicate ${signal} while graceful shutdown is starting; continuing shutdown. Press Ctrl+C again if it hangs.`,
          );
        }
        return;
      }

      logError(`OpenDucktor web shutdown is already in progress after ${signal}; forcing exit.`);
      process.exit(exitCode);
    }

    firstShutdownSignalReceivedAt = now;
    logInfo(`Stopping OpenDucktor web after ${signal}...`);

    void stop().finally(() => {
      process.exit(exitCode);
    });
  };

  process.on("SIGINT", () => handleShutdownSignal("SIGINT", 130));
  process.on("SIGTERM", () => handleShutdownSignal("SIGTERM", 143));

  try {
    logInfo("Starting OpenDucktor TypeScript host...");
    logInfo("Waiting for OpenDucktor TypeScript host readiness...");
    await waitForBackend(backendUrl, appToken, readinessTimeoutMs, hostBackend);
    logInfo("Starting OpenDucktor frontend server...");
    frontendServer = await startFrontendServer(options, backendUrl, appToken);
    logFrontendAvailability(options.frontendPort);

    const exitCode = await hostBackend.exited;
    if (stopping) {
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
