import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { ViteDevServer } from "vite";
import {
  buildBackendUrl,
  buildBrowserRuntimeConfigJson,
  buildFrontendDisplayUrls,
  buildFrontendUrl,
  closeFrontendServer,
  type FrontendServer,
  keepProcessAliveDuring,
  LOCALHOST,
  resolveStaticAssetPath,
  stopLauncherServices,
  waitForBackend,
} from "./launcher-support";
import { logError, logInfo, logSuccess } from "./logger";
import { RUNTIME_CONFIG_PATH } from "./runtime-config";
import { startTypescriptHostBackend } from "./typescript-host-backend";
import { resolveWebRuntimeDistribution } from "./web-runtime-distribution";
import { resolveWebProvidedToolPaths } from "./web-tool-discovery";

export type LauncherOptions = {
  packageRoot: string;
  workspaceRoot?: string;
  workspaceMode: boolean;
  frontendPort: number;
  backendPort: number;
  readinessTimeoutMs?: number;
};

const logFrontendAvailability = (port: number): void => {
  logSuccess("OpenDucktor web is ready:");
  for (const url of buildFrontendDisplayUrls(port)) {
    logSuccess(`  ➜  Local:   ${url}`);
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
  const runtimeDistribution = resolveWebRuntimeDistribution({
    packageRoot: options.packageRoot,
    workspaceMode: options.workspaceMode,
    ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
  });
  const providedToolPaths = resolveWebProvidedToolPaths();
  const hostBackend = await startTypescriptHostBackend({
    port: options.backendPort,
    frontendOrigin: frontendUrl,
    controlToken,
    appToken,
    providedToolPaths,
    runtimeDistribution,
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
