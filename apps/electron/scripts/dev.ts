import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";

type ManagedElectronProcess = Bun.Subprocess<"ignore", "inherit", "inherit">;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(packageRoot, "../..");

const RENDERER_DEV_HOST = "127.0.0.1";
const DEFAULT_RENDERER_DEV_PORT = 1430;
const ELECTRON_RESTART_DEBOUNCE_MS = 100;
const ELECTRON_STOP_TIMEOUT_MS = 30_000;

export const ELECTRON_RESTART_WATCH_ROOTS = [
  path.join(packageRoot, "src/main"),
  path.join(packageRoot, "src/preload"),
  path.join(packageRoot, "src/shared"),
  path.join(workspaceRoot, "packages/contracts/src"),
  path.join(workspaceRoot, "packages/core/src"),
  path.join(workspaceRoot, "packages/host/src"),
] as const;

const ELECTRON_RESTART_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".json",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

const runStep = async (label: string, command: string[]): Promise<void> => {
  const process = Bun.spawn(command, {
    cwd: packageRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}.`);
  }
};

const normalizePath = (filePath: string): string => path.resolve(filePath);

const isWithinDirectory = (directory: string, candidate: string): boolean => {
  const relative = path.relative(normalizePath(directory), normalizePath(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export const resolveRendererDevPort = (rawPort: string | undefined): number => {
  const trimmedPort = rawPort?.trim();
  if (!trimmedPort) {
    return DEFAULT_RENDERER_DEV_PORT;
  }

  if (!/^\d+$/.test(trimmedPort)) {
    throw new Error(
      `ELECTRON_RENDERER_DEV_PORT must be a TCP port between 1 and 65535: ${rawPort}`,
    );
  }

  const port = Number(trimmedPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(
      `ELECTRON_RENDERER_DEV_PORT must be a TCP port between 1 and 65535: ${rawPort}`,
    );
  }

  return port;
};

export const shouldRestartElectronForChange = (
  filePath: string,
  watchRoots: readonly string[] = ELECTRON_RESTART_WATCH_ROOTS,
): boolean =>
  ELECTRON_RESTART_EXTENSIONS.has(path.extname(filePath)) &&
  watchRoots.some((root) => isWithinDirectory(root, filePath));

const buildElectronBundles = async (): Promise<void> => {
  await runStep("Electron main build", ["bun", "run", "build:main"]);
  await runStep("Electron preload build", ["bun", "run", "build:preload"]);
};

const createRendererDevServer = async (port: number): Promise<ViteDevServer> => {
  const server = await createServer({
    root: packageRoot,
    configFile: path.join(packageRoot, "vite.config.ts"),
    server: {
      host: RENDERER_DEV_HOST,
      port,
      strictPort: true,
    },
  });
  await server.listen(port);
  server.printUrls();
  return server;
};

const resolveRendererDevUrl = (server: ViteDevServer): string => {
  const localUrl = server.resolvedUrls?.local.find((url) => url.includes(RENDERER_DEV_HOST));
  if (localUrl) {
    return localUrl.replace(/\/$/u, "");
  }

  const configuredPort = server.config.server.port;
  if (!configuredPort) {
    throw new Error("Vite renderer dev server did not expose a configured port.");
  }

  return `http://${RENDERER_DEV_HOST}:${configuredPort}`;
};

export const electronRuntimeEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...runtimeEnv } = env;
  return runtimeEnv;
};

const startElectron = (rendererDevUrl: string): ManagedElectronProcess =>
  Bun.spawn(["electron", "dist/main.js"], {
    cwd: packageRoot,
    detached: process.platform !== "win32",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...electronRuntimeEnv(process.env),
      VITE_DEV_SERVER_URL: rendererDevUrl,
    },
  });

const stopElectron = async (electron: ManagedElectronProcess | null): Promise<void> => {
  if (!electron) {
    return;
  }

  let exited = false;
  const exitedPromise = electron.exited.then(() => {
    exited = true;
  });

  electron.kill();
  await Promise.race([exitedPromise, sleep(ELECTRON_STOP_TIMEOUT_MS)]);
  if (!exited) {
    electron.kill(9);
    await Promise.race([exitedPromise, sleep(ELECTRON_STOP_TIMEOUT_MS)]);
  }
};

const closeRendererServer = async (server: ViteDevServer | null): Promise<void> => {
  if (server) {
    await server.close();
  }
};

const main = async (): Promise<number> => {
  const rendererPort = resolveRendererDevPort(process.env.ELECTRON_RENDERER_DEV_PORT);
  const rendererServer = await createRendererDevServer(rendererPort);
  const rendererDevUrl = resolveRendererDevUrl(rendererServer);
  let electron: ManagedElectronProcess | null = null;
  let shutdownStarted = false;
  let restarting = false;
  let restartQueued = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveExit: (exitCode: number) => void = () => {};
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });

  const shutdown = async (exitCode: number): Promise<void> => {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    await stopElectron(electron);
    await closeRendererServer(rendererServer);
    resolveExit(exitCode);
  };

  const launchElectron = async (): Promise<void> => {
    await buildElectronBundles();
    const nextElectron = startElectron(rendererDevUrl);
    electron = nextElectron;
    void nextElectron.exited.then((exitCode) => {
      if (electron === nextElectron) {
        electron = null;
      }
      if (!shutdownStarted && !restarting) {
        void shutdown(exitCode);
      }
    });
  };

  const restartElectron = async (): Promise<void> => {
    if (shutdownStarted) {
      return;
    }
    if (restarting) {
      restartQueued = true;
      return;
    }

    restarting = true;
    try {
      console.log("[electron:dev] Restarting Electron after main-process dependency change...");
      await stopElectron(electron);
      await launchElectron();
    } finally {
      restarting = false;
    }

    if (restartQueued) {
      restartQueued = false;
      await restartElectron();
    }
  };

  const scheduleRestart = (): void => {
    if (shutdownStarted) {
      return;
    }
    if (restartTimer) {
      clearTimeout(restartTimer);
    }
    restartTimer = setTimeout(() => {
      restartTimer = null;
      void restartElectron().catch((error: unknown) => {
        console.error(error);
        void shutdown(1);
      });
    }, ELECTRON_RESTART_DEBOUNCE_MS);
  };

  const handleWatchedFileChange = (filePath: string): void => {
    if (shouldRestartElectronForChange(filePath)) {
      scheduleRestart();
    }
  };

  try {
    rendererServer.watcher.add([...ELECTRON_RESTART_WATCH_ROOTS]);
    rendererServer.watcher.on("add", handleWatchedFileChange);
    rendererServer.watcher.on("change", handleWatchedFileChange);
    rendererServer.watcher.on("unlink", handleWatchedFileChange);

    process.once("SIGINT", () => {
      void shutdown(130);
    });
    process.once("SIGTERM", () => {
      void shutdown(143);
    });
    process.once("exit", () => {
      if (electron && !electron.killed) {
        electron.kill();
      }
    });

    await launchElectron();
    return exited;
  } catch (error) {
    await closeRendererServer(rendererServer);
    throw error;
  }
};

if (import.meta.main) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(error);
    return 1;
  });
  process.exit(exitCode);
}
