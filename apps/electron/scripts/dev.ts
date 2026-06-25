import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Exit } from "effect";
import { createServer, type ViteDevServer } from "vite";
import { runElectronEffect } from "../src/effect/electron-boundary";
import { resolveRendererDevPort as resolveRendererDevPortFromConfig } from "../src/effect/electron-config";
import {
  causeToElectronBoundaryError,
  ElectronOperationError,
  errorMessage,
  toElectronOperationError,
} from "../src/effect/electron-errors";
import {
  copySqliteTaskStoreMigrationsEffect,
  resolveSqliteTaskStoreMigrationCopyPlan,
} from "./build";

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

export const buildElectronBundlesEffect = (): Effect.Effect<void, ElectronOperationError> =>
  Effect.gen(function* () {
    yield* runStepEffect("Electron main build", ["bun", "run", "build:main"]);
    yield* runStepEffect("Electron preload build", ["bun", "run", "build:preload"]);
    yield* copySqliteTaskStoreMigrationsEffect(
      resolveSqliteTaskStoreMigrationCopyPlan({
        electronPackageRoot: packageRoot,
        workspaceRoot,
      }),
    );
  });

const resolveRendererDevUrlEffect = (
  server: ViteDevServer,
): Effect.Effect<string, ElectronOperationError> =>
  Effect.try({
    try: () => resolveRendererDevUrl(server),
    catch: (cause) => toElectronOperationError(cause, "electron.dev.resolve-renderer-url"),
  });

const resolveElectronDevExecutablePathEffect = (): Effect.Effect<string, ElectronOperationError> =>
  Effect.tryPromise({
    try: resolveElectronDevExecutablePath,
    catch: (cause) => toElectronOperationError(cause, "electron.dev.resolve-executable-path"),
  });

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

type StartElectronProcess = (
  rendererDevUrl: string,
  electronExecutablePath: string,
) => ManagedElectronProcess;

type ElectronDevLifecycleOptions = {
  buildBundles?: () => Effect.Effect<void, ElectronOperationError>;
  electronExecutablePath: string;
  rendererDevUrl: string;
  rendererServer: ViteDevServer;
  startElectronProcess?: StartElectronProcess;
};

export const runElectronDevLifecycleEffect = ({
  buildBundles = buildElectronBundlesEffect,
  electronExecutablePath,
  rendererDevUrl,
  rendererServer,
  startElectronProcess = startElectron,
}: ElectronDevLifecycleOptions): Effect.Effect<number, ElectronOperationError> =>
  Effect.async<number, ElectronOperationError>((resume) => {
    let electron: ManagedElectronProcess | null = null;
    let shutdownStarted = false;
    let restarting = false;
    let restartQueued = false;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const settle = (effect: Effect.Effect<number, ElectronOperationError>): void => {
      if (settled) {
        return;
      }
      settled = true;
      resume(effect);
    };

    const completeFailure = (cause: unknown): void => {
      settle(Effect.fail(toElectronOperationError(cause, "electron.dev.lifecycle")));
    };

    const shutdownEffect = (exitCode: number): Effect.Effect<void, ElectronOperationError> =>
      Effect.gen(function* () {
        if (shutdownStarted) {
          return;
        }
        shutdownStarted = true;
        if (restartTimer) {
          clearTimeout(restartTimer);
          restartTimer = null;
        }
        yield* stopElectronEffect(electron);
        yield* closeRendererServerEffect(rendererServer);
        yield* Effect.sync(() => {
          settle(Effect.succeed(exitCode));
        });
      });

    const runShutdown = (exitCode: number): void => {
      void Effect.runPromiseExit(shutdownEffect(exitCode)).then((exit) => {
        if (Exit.isFailure(exit)) {
          completeFailure(causeToElectronBoundaryError(exit.cause));
        }
      });
    };

    const runLifecycleTask = (effect: Effect.Effect<void, ElectronOperationError>): void => {
      void Effect.runPromiseExit(effect).then((exit) => {
        if (Exit.isFailure(exit)) {
          const error = causeToElectronBoundaryError(exit.cause);
          console.error(error);
          runShutdown(1);
        }
      });
    };

    const launchElectronEffect = (): Effect.Effect<void, ElectronOperationError> =>
      Effect.gen(function* () {
        yield* buildBundles();
        const nextElectron = yield* Effect.sync(() =>
          startElectronProcess(rendererDevUrl, electronExecutablePath),
        );
        electron = nextElectron;
        void nextElectron.exited.then((exitCode) => {
          if (electron === nextElectron) {
            electron = null;
          }
          if (!shutdownStarted && !restarting) {
            runShutdown(exitCode);
          }
        });
      });

    const restartElectronEffect = (): Effect.Effect<void, ElectronOperationError> =>
      Effect.gen(function* () {
        if (shutdownStarted) {
          return;
        }
        if (restarting) {
          restartQueued = true;
          return;
        }

        restarting = true;
        const restartExit = yield* Effect.exit(
          Effect.gen(function* () {
            console.log(
              "[electron:dev] Restarting Electron after main-process dependency change...",
            );
            yield* stopElectronEffect(electron);
            yield* launchElectronEffect();
          }),
        );
        yield* Effect.sync(() => {
          restarting = false;
        });
        if (Exit.isFailure(restartExit)) {
          return yield* Effect.fail(
            toElectronOperationError(
              causeToElectronBoundaryError(restartExit.cause),
              "electron.dev.restart-electron",
            ),
          );
        }

        if (restartQueued) {
          restartQueued = false;
          yield* restartElectronEffect();
        }
      });

    const scheduleRestart = (): void => {
      if (shutdownStarted) {
        return;
      }
      if (restartTimer) {
        clearTimeout(restartTimer);
      }
      restartTimer = setTimeout(() => {
        restartTimer = null;
        runLifecycleTask(restartElectronEffect());
      }, ELECTRON_RESTART_DEBOUNCE_MS);
    };

    const handleWatchedFileChange = (filePath: string): void => {
      if (shouldRestartElectronForChange(filePath)) {
        scheduleRestart();
      }
    };

    const registerWatcherEffect = (): Effect.Effect<void, ElectronOperationError> =>
      Effect.try({
        try: () => {
          rendererServer.watcher.add([...ELECTRON_RESTART_WATCH_ROOTS]);
          rendererServer.watcher.on("add", handleWatchedFileChange);
          rendererServer.watcher.on("change", handleWatchedFileChange);
          rendererServer.watcher.on("unlink", handleWatchedFileChange);
        },
        catch: (cause) =>
          new ElectronOperationError({
            operation: "electron.dev.register-watcher",
            message: errorMessage(cause),
            cause,
          }),
      });

    const registerProcessHandlersEffect = (): Effect.Effect<void, never> =>
      Effect.sync(() => {
        process.once("SIGINT", () => {
          console.log("[electron:dev] Received SIGINT, shutting down...");
          runShutdown(130);
        });
        process.once("SIGTERM", () => {
          console.log("[electron:dev] Received SIGTERM, shutting down...");
          runShutdown(143);
        });
        process.once("exit", () => {
          if (electron) {
            electron.kill();
          }
        });
      });

    runLifecycleTask(
      Effect.gen(function* () {
        yield* registerWatcherEffect();
        yield* registerProcessHandlersEffect();
        yield* launchElectronEffect();
      }),
    );
  });

export const mainEffect = (): Effect.Effect<number, ElectronOperationError> =>
  Effect.gen(function* () {
    const rendererPort = resolveRendererDevPort(process.env.ELECTRON_RENDERER_DEV_PORT);
    const electronExecutablePath = yield* resolveElectronDevExecutablePathEffect();
    const rendererServer = yield* createRendererDevServerEffect(rendererPort);
    const lifecycleExit = yield* Effect.exit(
      Effect.gen(function* () {
        const rendererDevUrl = yield* resolveRendererDevUrlEffect(rendererServer);
        return yield* runElectronDevLifecycleEffect({
          electronExecutablePath,
          rendererDevUrl,
          rendererServer,
        });
      }),
    );
    if (Exit.isSuccess(lifecycleExit)) {
      return lifecycleExit.value;
    }

    yield* closeRendererServerEffect(rendererServer);
    return yield* Effect.fail(
      toElectronOperationError(
        causeToElectronBoundaryError(lifecycleExit.cause),
        "electron.dev.main",
      ),
    );
  });

if (import.meta.main) {
  const exitCode = await runElectronEffect(mainEffect()).catch((error: unknown) => {
    console.error(error);
    return 1;
  });
  process.exit(exitCode);
}
