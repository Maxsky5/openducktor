import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { createServer, type ViteDevServer } from "vite";
import { runElectronEffect } from "../src/effect/electron-boundary";
import { resolveRendererDevPort as resolveRendererDevPortFromConfig } from "../src/effect/electron-config";
import { ElectronOperationError, errorMessage } from "../src/effect/electron-errors";
import { copySqliteTaskStoreMigrations, resolveSqliteTaskStoreMigrationCopyPlan } from "./build";

type ManagedElectronProcess = Bun.Subprocess<"ignore", "inherit", "inherit">;
type ForceCloseableHttpServer = {
  closeAllConnections?: () => void;
  closeIdleConnections?: () => void;
};
type ViteDevServerWithHttpConnections = ViteDevServer & {
  httpServer?: ForceCloseableHttpServer | null;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const nodeRequire = createRequire(import.meta.url);

const APPLICATION_NAME = "OpenDucktor";
const MACOS_DEV_BUNDLE_IDENTIFIER = "com.openducktor.app.dev";
const MACOS_DEV_ICON_FILE_NAME = "openducktor-dev-rounded.icns";
const RENDERER_DEV_HOST = "127.0.0.1";
const ELECTRON_RESTART_DEBOUNCE_MS = 100;
const RENDERER_CLOSE_TIMEOUT_MS = 3_000;
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

const runStepEffect = (
  label: string,
  command: string[],
): Effect.Effect<void, ElectronOperationError> =>
  Effect.tryPromise({
    try: async () => {
      const process = Bun.spawn(command, {
        cwd: packageRoot,
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await process.exited;
      if (exitCode !== 0) {
        throw new Error(`${label} failed with exit code ${exitCode}.`);
      }
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.dev.run-step",
        message: errorMessage(cause),
        cause,
        details: { command, label },
      }),
  });

const runStep = (label: string, command: string[]): Promise<void> =>
  runElectronEffect(runStepEffect(label, command));

const nodeErrorCode = (cause: unknown): string | null =>
  typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : null;

const readFileIfExistsEffect = (
  filePath: string,
): Effect.Effect<string | null, ElectronOperationError> =>
  Effect.tryPromise({
    try: () => readFile(filePath, "utf8"),
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.dev.read-file",
        message: errorMessage(cause),
        path: filePath,
        cause,
        details: { code: nodeErrorCode(cause) },
      }),
  }).pipe(
    Effect.catchAll((error) =>
      error.details?.code === "ENOENT" ? Effect.succeed(null) : Effect.fail(error),
    ),
  );

const readFileIfExists = (filePath: string): Promise<string | null> =>
  runElectronEffect(readFileIfExistsEffect(filePath));

const fileExistsEffect = (filePath: string): Effect.Effect<boolean, ElectronOperationError> =>
  Effect.tryPromise({
    try: async () => {
      await stat(filePath);
      return true;
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.dev.stat-file",
        message: errorMessage(cause),
        path: filePath,
        cause,
        details: { code: nodeErrorCode(cause) },
      }),
  }).pipe(
    Effect.catchAll((error) =>
      error.details?.code === "ENOENT" ? Effect.succeed(false) : Effect.fail(error),
    ),
  );

const fileExists = (filePath: string): Promise<boolean> =>
  runElectronEffect(fileExistsEffect(filePath));

const assertFileExistsEffect = (
  filePath: string,
  label: string,
): Effect.Effect<void, ElectronOperationError> =>
  Effect.tryPromise({
    try: async () => {
      const metadata = await stat(filePath);
      if (!metadata.isFile()) {
        throw new Error(`${label} must be a file: ${filePath}`);
      }
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.dev.assert-file-exists",
        message:
          nodeErrorCode(cause) === "ENOENT"
            ? `${label} was not found: ${filePath}`
            : errorMessage(cause),
        path: filePath,
        cause,
      }),
  });

const assertFileExists = (filePath: string, label: string): Promise<void> =>
  runElectronEffect(assertFileExistsEffect(filePath, label));

const fileSignatureEffect = (
  filePath: string,
): Effect.Effect<{ mtimeMs: number; size: number }, ElectronOperationError> =>
  Effect.tryPromise({
    try: async () => {
      const metadata = await stat(filePath);
      return {
        mtimeMs: metadata.mtimeMs,
        size: metadata.size,
      };
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.dev.file-signature",
        message: errorMessage(cause),
        path: filePath,
        cause,
      }),
  });

const fileSignature = (filePath: string): Promise<{ mtimeMs: number; size: number }> =>
  runElectronEffect(fileSignatureEffect(filePath));

const normalizePath = (filePath: string): string => path.resolve(filePath);

const isWithinDirectory = (directory: string, candidate: string): boolean => {
  const relative = path.relative(normalizePath(directory), normalizePath(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export const resolveRendererDevPort = (rawPort: string | undefined): number => {
  return resolveRendererDevPortFromConfig(rawPort, "electron.dev.resolve-renderer-dev-port");
};

export const shouldRestartElectronForChange = (
  filePath: string,
  watchRoots: readonly string[] = ELECTRON_RESTART_WATCH_ROOTS,
): boolean =>
  ELECTRON_RESTART_EXTENSIONS.has(path.extname(filePath)) &&
  watchRoots.some((root) => isWithinDirectory(root, filePath));

export const resolveMacosAppBundlePath = (electronExecutablePath: string): string | null => {
  const appBundleMarker = "/Contents/MacOS/";
  const markerIndex = electronExecutablePath.lastIndexOf(appBundleMarker);
  if (markerIndex === -1) {
    return null;
  }

  const appBundlePath = electronExecutablePath.slice(0, markerIndex);
  if (!appBundlePath.endsWith(".app")) {
    return null;
  }

  return appBundlePath;
};

export const resolveRequiredMacosAppBundlePath = (electronExecutablePath: string): string => {
  const sourceAppPath = resolveMacosAppBundlePath(electronExecutablePath);
  if (!sourceAppPath) {
    throw new ElectronOperationError({
      operation: "electron.dev.resolve-macos-app-bundle",
      message: `Electron macOS dev executable is not inside an app bundle: ${electronExecutablePath}`,
      path: electronExecutablePath,
    });
  }

  return sourceAppPath;
};

export const resolveMacosDevAppPath = (): string =>
  path.join(packageRoot, ".electron-dev", `${APPLICATION_NAME}.app`);

export const resolveMacosDevExecutablePath = (devAppPath: string, executableName: string): string =>
  path.posix.join(devAppPath, "Contents", "MacOS", executableName);

const resolveElectronExecutablePath = (): string => String(nodeRequire("electron"));

const replacePlistString = async (
  infoPlistPath: string,
  key: string,
  value: string,
): Promise<void> => {
  await runStep(`Electron dev app ${key}`, [
    "/usr/bin/plutil",
    "-replace",
    key,
    "-string",
    value,
    infoPlistPath,
  ]);
};

const buildMacosDevAppSignature = async ({
  devAppPath,
  iconPath,
  sourceAppPath,
  sourceExecutablePath,
}: {
  devAppPath: string;
  iconPath: string;
  sourceAppPath: string;
  sourceExecutablePath: string;
}): Promise<string> =>
  `${JSON.stringify(
    {
      appName: APPLICATION_NAME,
      bundleIdentifier: MACOS_DEV_BUNDLE_IDENTIFIER,
      devAppPath,
      icon: await fileSignature(iconPath),
      iconFileName: MACOS_DEV_ICON_FILE_NAME,
      sourceAppPath,
      sourceExecutablePath,
      sourceExecutable: await fileSignature(sourceExecutablePath),
      sourceInfoPlist: await fileSignature(path.join(sourceAppPath, "Contents", "Info.plist")),
    },
    null,
    2,
  )}\n`;

const prepareMacosDevElectronBundle = async (sourceExecutablePath: string): Promise<string> => {
  const sourceAppPath = resolveRequiredMacosAppBundlePath(sourceExecutablePath);

  const devRoot = path.join(packageRoot, ".electron-dev");
  const devAppPath = resolveMacosDevAppPath();
  const executableName = path.basename(sourceExecutablePath);
  const devExecutablePath = resolveMacosDevExecutablePath(devAppPath, executableName);
  const iconPath = path.join(packageRoot, "resources", "icon.icns");
  const infoPlistPath = path.join(devAppPath, "Contents", "Info.plist");
  const markerPath = path.join(devRoot, "app-source.json");
  await assertFileExists(iconPath, "Electron macOS dev icon");
  const signature = await buildMacosDevAppSignature({
    devAppPath,
    iconPath,
    sourceAppPath,
    sourceExecutablePath,
  });
  const existingSignature = await readFileIfExists(markerPath);
  const shouldCopyBundle =
    existingSignature !== signature || !(await fileExists(devExecutablePath));

  await mkdir(devRoot, { recursive: true });
  if (shouldCopyBundle) {
    await rm(markerPath, { force: true });
    await rm(devAppPath, { force: true, recursive: true });
    await runStep("Electron macOS dev app copy", ["/bin/cp", "-cR", sourceAppPath, devAppPath]);
  }

  await copyFile(
    iconPath,
    path.join(devAppPath, "Contents", "Resources", MACOS_DEV_ICON_FILE_NAME),
  );
  await copyFile(iconPath, path.join(devAppPath, "Contents", "Resources", "icon.icns"));
  await copyFile(iconPath, path.join(devAppPath, "Contents", "Resources", "electron.icns"));
  await replacePlistString(infoPlistPath, "CFBundleDisplayName", APPLICATION_NAME);
  await replacePlistString(infoPlistPath, "CFBundleName", APPLICATION_NAME);
  await replacePlistString(infoPlistPath, "CFBundleIdentifier", MACOS_DEV_BUNDLE_IDENTIFIER);
  await replacePlistString(infoPlistPath, "CFBundleIconFile", MACOS_DEV_ICON_FILE_NAME);
  await writeFile(markerPath, signature, "utf8");

  return devExecutablePath;
};

const resolveElectronDevExecutablePath = async (): Promise<string> => {
  const electronExecutablePath = resolveElectronExecutablePath();
  if (process.platform !== "darwin") {
    return electronExecutablePath;
  }

  return prepareMacosDevElectronBundle(electronExecutablePath);
};

const buildElectronBundles = async (): Promise<void> => {
  await runStep("Electron main build", ["bun", "run", "build:main"]);
  await runStep("Electron preload build", ["bun", "run", "build:preload"]);
  await copySqliteTaskStoreMigrations(
    resolveSqliteTaskStoreMigrationCopyPlan({
      electronPackageRoot: packageRoot,
      workspaceRoot,
    }),
  );
};

const createRendererDevServer = async (port: number): Promise<ViteDevServer> => {
  return runElectronEffect(createRendererDevServerEffect(port));
};

const createRendererDevServerEffect = (
  port: number,
): Effect.Effect<ViteDevServer, ElectronOperationError> =>
  Effect.tryPromise({
    try: async () => {
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
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.dev.create-renderer-server",
        message: errorMessage(cause),
        cause,
        details: { port },
      }),
  });

const resolveRendererDevUrl = (server: ViteDevServer): string => {
  const localUrl = server.resolvedUrls?.local.find((url) => url.includes(RENDERER_DEV_HOST));
  if (localUrl) {
    return localUrl.replace(/\/$/u, "");
  }

  const configuredPort = server.config.server.port;
  if (!configuredPort) {
    throw new ElectronOperationError({
      operation: "electron.dev.resolve-renderer-url",
      message: "Vite renderer dev server did not expose a configured port.",
    });
  }

  return `http://${RENDERER_DEV_HOST}:${configuredPort}`;
};

export const electronRuntimeEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...runtimeEnv } = env;
  return runtimeEnv;
};

export const electronGracefulShutdownSignal = (platform: NodeJS.Platform): NodeJS.Signals =>
  platform === "win32" ? "SIGINT" : "SIGTERM";

const startElectron = (
  rendererDevUrl: string,
  electronExecutablePath: string,
): ManagedElectronProcess =>
  Bun.spawn([electronExecutablePath, "dist/main.js"], {
    cwd: packageRoot,
    detached: process.platform !== "win32",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...electronRuntimeEnv(process.env),
      VITE_DEV_SERVER_URL: rendererDevUrl,
    },
  });

const forceCloseRendererConnections = (server: ViteDevServer): void => {
  const httpServer = (server as ViteDevServerWithHttpConnections).httpServer;
  httpServer?.closeIdleConnections?.();
  httpServer?.closeAllConnections?.();
};

export const stopElectronEffect = (
  electron: ManagedElectronProcess | null,
  stopSleep: (durationMs: number) => Promise<unknown> = sleep,
): Effect.Effect<void, ElectronOperationError> =>
  Effect.tryPromise({
    try: async () => {
      if (!electron) {
        return;
      }

      let exited = false;
      const exitedPromise = electron.exited.then(() => {
        exited = true;
      });

      const gracefulSignal = electronGracefulShutdownSignal(process.platform);
      console.log(`[electron:dev] Requesting Electron shutdown with ${gracefulSignal}...`);
      electron.kill(gracefulSignal);
      await Promise.race([exitedPromise, stopSleep(ELECTRON_STOP_TIMEOUT_MS)]);
      if (!exited) {
        console.error(
          `[electron:dev] Electron did not exit within ${ELECTRON_STOP_TIMEOUT_MS}ms; forcing shutdown...`,
        );
        electron.kill(9);
        await Promise.race([exitedPromise, stopSleep(ELECTRON_STOP_TIMEOUT_MS)]);
        if (!exited) {
          throw new Error(
            `[electron:dev] Electron did not exit after forced shutdown within ${ELECTRON_STOP_TIMEOUT_MS}ms.`,
          );
        }
      }
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.dev.stop-electron",
        message: errorMessage(cause),
        cause,
      }),
  });

const stopElectron = (electron: ManagedElectronProcess | null): Promise<void> =>
  runElectronEffect(stopElectronEffect(electron));

export const closeRendererServer = async (
  server: ViteDevServer | null,
  closeSleep: (durationMs: number) => Promise<unknown> = sleep,
): Promise<void> => {
  await runElectronEffect(closeRendererServerEffect(server, closeSleep));
};

export const closeRendererServerEffect = (
  server: ViteDevServer | null,
  closeSleep: (durationMs: number) => Promise<unknown> = sleep,
): Effect.Effect<void, ElectronOperationError> => {
  if (!server) {
    return Effect.void;
  }

  return Effect.gen(function* () {
    const closePromise = yield* Effect.try({
      try: () => {
        try {
          return server.close();
        } finally {
          forceCloseRendererConnections(server);
        }
      },
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.dev.close-renderer-server",
          message: errorMessage(cause),
          cause,
        }),
    });
    yield* Effect.tryPromise({
      try: async () => {
        await Promise.race([closePromise, closeSleep(RENDERER_CLOSE_TIMEOUT_MS)]);
      },
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.dev.close-renderer-server",
          message: errorMessage(cause),
          cause,
        }),
    });
  });
};

const main = async (): Promise<number> => {
  const rendererPort = resolveRendererDevPort(process.env.ELECTRON_RENDERER_DEV_PORT);
  const electronExecutablePath = await resolveElectronDevExecutablePath();
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
    const nextElectron = startElectron(rendererDevUrl, electronExecutablePath);
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
      console.log("[electron:dev] Received SIGINT, shutting down...");
      void shutdown(130);
    });
    process.once("SIGTERM", () => {
      console.log("[electron:dev] Received SIGTERM, shutting down...");
      void shutdown(143);
    });
    process.once("exit", () => {
      if (electron) {
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
