import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signAsync, type SignOptions } from "@electron/osx-sign";
import { resolveDevelopmentInstanceId } from "@openducktor/host";
import { Effect, Exit } from "effect";
import { z } from "zod";
import {
  createElectronRendererDevServerEffect,
  type ElectronRendererDevServer,
} from "../src/development/electron-renderer-dev-server";
import { runElectronEffect } from "../src/effect/electron-boundary";
import {
  resolveRendererDevPortEffect,
  resolveRendererDevPort as resolveRendererDevPortFromConfig,
} from "../src/effect/electron-config";
import {
  causeToElectronBoundaryError,
  ElectronOperationError,
  type ElectronOperationErrorAggregate,
  ElectronValidationError,
  type ElectronValidationErrorAggregate,
  errorMessage,
  toElectronOperationError,
} from "../src/effect/electron-errors";
import {
  copySqliteTaskStoreMigrationsEffect,
  resolveSqliteTaskStoreMigrationCopyPlan,
} from "./build";
import {
  DEVTOOLS_ACTIVE_PORT_RECOVERY_STEP,
  prepareDevToolsActivePortFileEffect,
  resolveDevToolsActivePortPath,
  waitForDevToolsActivePort,
} from "./devtools-active-port";

export type ManagedElectronProcess = {
  readonly exited: Promise<number>;
  kill(signal?: NodeJS.Signals | number): void;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const nodeRequire = createRequire(import.meta.url);

const APPLICATION_NAME = "OpenDucktor";
const MACOS_DEV_BUNDLE_IDENTIFIER_PREFIX = "com.openducktor.app.dev";
const MACOS_DEV_ICON_FILE_NAME = "openducktor-dev-rounded.icns";
const ELECTRON_RESTART_DEBOUNCE_MS = 100;
const ELECTRON_STOP_TIMEOUT_MS = 30_000;
const nodeErrorSchema = z.object({ code: z.string() });

type DevFileOperationDetails = { readonly targetPath: string };
type ElectronDevCommandErrorDetails = { readonly command: string[]; readonly label: string };
type ElectronNodeErrorDetails = { readonly code: string | null };

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
): Effect.Effect<void, ElectronOperationError<ElectronDevCommandErrorDetails>> =>
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

const nodeErrorCode = (cause: unknown): string | null => {
  const parsedCause = nodeErrorSchema.safeParse(cause);
  return parsedCause.success ? parsedCause.data.code : null;
};

const readFileIfExistsEffect = (
  filePath: string,
): Effect.Effect<string | null, ElectronOperationError<ElectronNodeErrorDetails>> =>
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

const fileExistsEffect = (
  filePath: string,
): Effect.Effect<boolean, ElectronOperationError<ElectronNodeErrorDetails>> =>
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

const assertFileExistsEffect = (
  filePath: string,
  label: string,
): Effect.Effect<void, ElectronOperationError<ElectronDevCommandErrorDetails>> =>
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

const normalizePath = (filePath: string): string => path.resolve(filePath);

const isWithinDirectory = (directory: string, candidate: string): boolean => {
  const relative = path.relative(normalizePath(directory), normalizePath(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export const resolveRendererDevPort = (rawPort: string | undefined): number => {
  return resolveRendererDevPortFromConfig(rawPort, "electron.dev.resolve-renderer-dev-port");
};

export const shouldEnableRemoteDebugging = (argv: readonly string[]): boolean =>
  argv.includes("--cdp");

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

export const resolveMacosDevBundleIdentifier = (developmentInstanceId: string): string =>
  `${MACOS_DEV_BUNDLE_IDENTIFIER_PREFIX}.${developmentInstanceId}`;

export const macosDevSignOptions = (devAppPath: string): SignOptions => ({
  app: devAppPath,
  identity: "-",
  identityValidation: false,
  optionsForFile: () => ({ hardenedRuntime: false, timestamp: "none" }),
  platform: "darwin",
});

export const macosDevAppRegistrationCommand = (devAppPath: string): string[] => [
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
  "-f",
  devAppPath,
];

const resolveElectronExecutablePath = (): string => String(nodeRequire("electron"));

const signMacosDevAppEffect = (
  devAppPath: string,
): Effect.Effect<void, ElectronOperationError<ElectronDevCommandErrorDetails>> =>
  Effect.tryPromise({
    try: () => signAsync(macosDevSignOptions(devAppPath)),
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.dev.sign-macos-app",
        message: errorMessage(cause),
        path: devAppPath,
        cause,
        details: {
          command: ["@electron/osx-sign", devAppPath],
          label: "Electron macOS dev app signing",
        },
      }),
  });

const runDevFileOperationEffect = (
  operation: string,
  filePath: string,
  action: () => Promise<void>,
  details?: DevFileOperationDetails,
): Effect.Effect<void, ElectronOperationError<DevFileOperationDetails>> =>
  Effect.tryPromise({
    try: async () => {
      await action();
    },
    catch: (cause) => {
      const message = errorMessage(cause);
      if (details === undefined) {
        return new ElectronOperationError<DevFileOperationDetails>({
          operation,
          message,
          path: filePath,
          cause,
        });
      }
      return new ElectronOperationError<DevFileOperationDetails>({
        operation,
        message,
        path: filePath,
        cause,
        details,
      });
    },
  });

const replacePlistStringEffect = (
  infoPlistPath: string,
  key: string,
  value: string,
): Effect.Effect<void, ElectronOperationError<ElectronDevCommandErrorDetails>> =>
  runStepEffect(`Electron dev app ${key}`, [
    "/usr/bin/plutil",
    "-replace",
    key,
    "-string",
    value,
    infoPlistPath,
  ]);

const buildMacosDevAppSignatureEffect = ({
  bundleIdentifier,
  devAppPath,
  iconPath,
  sourceAppPath,
  sourceExecutablePath,
}: {
  bundleIdentifier: string;
  devAppPath: string;
  iconPath: string;
  sourceAppPath: string;
  sourceExecutablePath: string;
}): Effect.Effect<string, ElectronOperationError> =>
  Effect.gen(function* () {
    const icon = yield* fileSignatureEffect(iconPath);
    const sourceExecutable = yield* fileSignatureEffect(sourceExecutablePath);
    const sourceInfoPlist = yield* fileSignatureEffect(
      path.join(sourceAppPath, "Contents", "Info.plist"),
    );

    return `${JSON.stringify(
      {
        appName: APPLICATION_NAME,
        bundleIdentifier,
        devAppPath,
        icon,
        iconFileName: MACOS_DEV_ICON_FILE_NAME,
        sourceAppPath,
        sourceExecutablePath,
        sourceExecutable,
        sourceInfoPlist,
      },
      null,
      2,
    )}\n`;
  });

const resolveRequiredMacosAppBundlePathEffect = (
  sourceExecutablePath: string,
): Effect.Effect<string, ElectronOperationErrorAggregate> =>
  Effect.try({
    try: () => resolveRequiredMacosAppBundlePath(sourceExecutablePath),
    catch: (cause) => toElectronOperationError(cause, "electron.dev.resolve-macos-app-bundle"),
  });

const prepareMacosDevElectronBundleEffect = (
  sourceExecutablePath: string,
  developmentInstanceId: string,
): Effect.Effect<string, ElectronOperationErrorAggregate> =>
  Effect.gen(function* () {
    const sourceAppPath = yield* resolveRequiredMacosAppBundlePathEffect(sourceExecutablePath);
    const bundleIdentifier = resolveMacosDevBundleIdentifier(developmentInstanceId);

    const devRoot = path.join(packageRoot, ".electron-dev");
    const devAppPath = resolveMacosDevAppPath();
    const executableName = path.basename(sourceExecutablePath);
    const devExecutablePath = resolveMacosDevExecutablePath(devAppPath, executableName);
    const iconPath = path.join(packageRoot, "resources", "icon.icns");
    const infoPlistPath = path.join(devAppPath, "Contents", "Info.plist");
    const markerPath = path.join(devRoot, "app-source.json");
    yield* assertFileExistsEffect(iconPath, "Electron macOS dev icon");
    const signature = yield* buildMacosDevAppSignatureEffect({
      bundleIdentifier,
      devAppPath,
      iconPath,
      sourceAppPath,
      sourceExecutablePath,
    });
    const existingSignature = yield* readFileIfExistsEffect(markerPath);
    const devExecutableExists = yield* fileExistsEffect(devExecutablePath);
    const shouldCopyBundle = existingSignature !== signature || !devExecutableExists;
    const resolveResourcePath = (fileName: string): string =>
      path.join(devAppPath, "Contents", "Resources", fileName);
    const copyIconResourceEffect = (
      targetFileName: string,
    ): Effect.Effect<void, ElectronOperationError<DevFileOperationDetails>> => {
      const targetPath = resolveResourcePath(targetFileName);
      return runDevFileOperationEffect(
        "electron.dev.copy-macos-dev-icon",
        iconPath,
        () => copyFile(iconPath, targetPath),
        { targetPath },
      );
    };

    yield* runDevFileOperationEffect("electron.dev.create-macos-dev-root", devRoot, async () => {
      await mkdir(devRoot, { recursive: true });
    });
    if (shouldCopyBundle) {
      yield* runDevFileOperationEffect("electron.dev.remove-macos-dev-marker", markerPath, () =>
        rm(markerPath, { force: true }),
      );
      yield* runDevFileOperationEffect("electron.dev.remove-macos-dev-app", devAppPath, () =>
        rm(devAppPath, { force: true, recursive: true }),
      );
      yield* runStepEffect("Electron macOS dev app copy", [
        "/bin/cp",
        "-cR",
        sourceAppPath,
        devAppPath,
      ]);
      yield* copyIconResourceEffect(MACOS_DEV_ICON_FILE_NAME);
      yield* copyIconResourceEffect("icon.icns");
      yield* copyIconResourceEffect("electron.icns");
      yield* replacePlistStringEffect(infoPlistPath, "CFBundleDisplayName", APPLICATION_NAME);
      yield* replacePlistStringEffect(infoPlistPath, "CFBundleName", APPLICATION_NAME);
      yield* replacePlistStringEffect(infoPlistPath, "CFBundleIdentifier", bundleIdentifier);
      yield* replacePlistStringEffect(infoPlistPath, "CFBundleIconFile", MACOS_DEV_ICON_FILE_NAME);
      yield* signMacosDevAppEffect(devAppPath);
      yield* runDevFileOperationEffect("electron.dev.write-macos-dev-marker", markerPath, () =>
        writeFile(markerPath, signature, "utf8"),
      );
    }

    yield* runStepEffect(
      "Electron macOS dev app LaunchServices registration",
      macosDevAppRegistrationCommand(devAppPath),
    );

    return devExecutablePath;
  });

export const buildElectronBundlesEffect = (): Effect.Effect<
  void,
  ElectronOperationErrorAggregate
> =>
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

const resolveElectronDevExecutablePathEffect = (
  developmentInstanceId: string,
): Effect.Effect<string, ElectronOperationErrorAggregate> =>
  Effect.gen(function* () {
    const electronExecutablePath = yield* Effect.try({
      try: resolveElectronExecutablePath,
      catch: (cause) => toElectronOperationError(cause, "electron.dev.resolve-executable-path"),
    });
    if (process.platform !== "darwin") {
      return electronExecutablePath;
    }

    return yield* prepareMacosDevElectronBundleEffect(
      electronExecutablePath,
      developmentInstanceId,
    );
  });

export const electronDevServerLogLines = (
  developmentInstanceId: string,
  rendererDevUrl: string,
): string[] => [
  `[electron:dev] Development instance: ${developmentInstanceId}`,
  `[electron:dev] Renderer URL: ${rendererDevUrl}`,
];

export const electronDebugEndpointLogLine = (cdpPort: number): string =>
  `[electron:dev] CDP endpoint: http://127.0.0.1:${cdpPort}`;

export const electronLaunchArgs = (
  electronExecutablePath: string,
  remoteDebugging: boolean,
): string[] => [
  electronExecutablePath,
  ...(remoteDebugging ? ["--remote-debugging-port=0"] : []),
  "dist/main.js",
];

export const electronRuntimeEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...runtimeEnv } = env;
  return runtimeEnv;
};

export const electronGracefulShutdownSignal = (platform: NodeJS.Platform): NodeJS.Signals =>
  platform === "win32" ? "SIGINT" : "SIGTERM";

const startElectron = (
  rendererDevUrl: string,
  electronExecutablePath: string,
  remoteDebugging: boolean,
): ManagedElectronProcess =>
  Bun.spawn(electronLaunchArgs(electronExecutablePath, remoteDebugging), {
    cwd: packageRoot,
    detached: process.platform !== "win32",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...electronRuntimeEnv(process.env),
      VITE_DEV_SERVER_URL: rendererDevUrl,
    },
  });

export const stopElectronEffect = (
  electron: ManagedElectronProcess | null,
  stopSleep: (durationMs: number) => Promise<void> = sleep,
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

type StartElectronProcess = (
  rendererDevUrl: string,
  electronExecutablePath: string,
  remoteDebugging: boolean,
) => ManagedElectronProcess;

type ElectronDevProcessEvent = "SIGINT" | "SIGTERM" | "SIGHUP" | "exit";

export type ElectronDevProcessHandlers = {
  off(event: ElectronDevProcessEvent, listener: () => void): void;
  once(event: ElectronDevProcessEvent, listener: () => void): void;
};

const defaultElectronDevProcessHandlers: ElectronDevProcessHandlers = {
  off(event, listener) {
    process.off(event, listener);
  },
  once(event, listener) {
    process.once(event, listener);
  },
};

type ElectronDevLifecycleOptions = {
  buildBundles?: () => Effect.Effect<void, ElectronOperationErrorAggregate>;
  devToolsActivePortPath?: string | null;
  electronExecutablePath: string;
  prepareDevToolsPortFile?: (
    activePortPath: string,
  ) => Effect.Effect<void, ElectronOperationErrorAggregate>;
  processHandlers?: ElectronDevProcessHandlers;
  renderer: ElectronRendererDevServer;
  startElectronProcess?: StartElectronProcess;
};

type DevToolsPortWait = {
  readonly controller: AbortController;
  readonly promise: Promise<number | null>;
  exitCodeBeforePublish: number | null;
};

export const runElectronDevLifecycleEffect = ({
  buildBundles = buildElectronBundlesEffect,
  devToolsActivePortPath = null,
  electronExecutablePath,
  prepareDevToolsPortFile = prepareDevToolsActivePortFileEffect,
  processHandlers = defaultElectronDevProcessHandlers,
  renderer,
  startElectronProcess = startElectron,
}: ElectronDevLifecycleOptions): Effect.Effect<number, ElectronOperationErrorAggregate> =>
  Effect.async<number, ElectronOperationErrorAggregate>((resume) => {
    let devToolsPortWait: DevToolsPortWait | null = null;
    let pendingElectronExitCode: number | null = null;
    let electron: ManagedElectronProcess | null = null;
    let shutdownStarted = false;
    let restarting = false;
    let restartQueued = false;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    let launchGeneration = 0;
    const registeredProcessHandlers: Array<{
      event: ElectronDevProcessEvent;
      listener: () => void;
    }> = [];
    let settled = false;
    let shutdownPromise: Promise<void> | null = null;

    const removeRegisteredProcessHandlers = ({
      keepExitHandler,
    }: {
      keepExitHandler: boolean;
    }): void => {
      const retainedProcessHandlers: Array<{
        event: ElectronDevProcessEvent;
        listener: () => void;
      }> = [];
      while (registeredProcessHandlers.length > 0) {
        const registered = registeredProcessHandlers.pop();
        if (!registered) {
          continue;
        }
        if (keepExitHandler && registered.event === "exit") {
          retainedProcessHandlers.push(registered);
          continue;
        }
        processHandlers.off(registered.event, registered.listener);
      }
      registeredProcessHandlers.push(...retainedProcessHandlers.reverse());
    };

    const settle = (
      effect: Effect.Effect<number, ElectronOperationErrorAggregate>,
      options: { keepExitHandler?: boolean } = {},
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      removeRegisteredProcessHandlers({ keepExitHandler: options.keepExitHandler ?? false });
      resume(effect);
    };

    const registerProcessHandler = (event: ElectronDevProcessEvent, listener: () => void): void => {
      processHandlers.once(event, listener);
      registeredProcessHandlers.push({ event, listener });
    };

    const completeFailure = (cause: unknown): void => {
      settle(Effect.fail(toElectronOperationError(cause, "electron.dev.lifecycle")), {
        keepExitHandler: true,
      });
    };

    const failLifecycleAfterStoppingElectron = (cause: unknown): void => {
      const failure = toElectronOperationError(cause, "electron.dev.lifecycle");
      void Effect.runPromiseExit(stopElectronEffect(electron)).then((stopExit) => {
        if (Exit.isFailure(stopExit)) {
          console.error(
            "[electron:dev] Electron shutdown after lifecycle failure failed.",
            causeToElectronBoundaryError(stopExit.cause),
          );
        }
        settle(Effect.fail(failure), { keepExitHandler: true });
      });
    };

    const abortDevToolsPortWait = (): void => {
      devToolsPortWait?.controller.abort();
      devToolsPortWait = null;
    };

    const shutdownEffect = (
      exitCode: number,
    ): Effect.Effect<void, ElectronOperationErrorAggregate> =>
      Effect.gen(function* () {
        if (shutdownStarted) {
          return;
        }
        shutdownStarted = true;
        abortDevToolsPortWait();
        if (restartTimer) {
          clearTimeout(restartTimer);
          restartTimer = null;
        }
        yield* stopElectronEffect(electron);
        yield* renderer.close();
        yield* Effect.sync(() => {
          settle(Effect.succeed(exitCode));
        });
      });

    const runShutdown = (exitCode: number): Promise<void> => {
      shutdownPromise ??= Effect.runPromiseExit(shutdownEffect(exitCode)).then((exit) => {
        if (Exit.isFailure(exit)) {
          const cause = causeToElectronBoundaryError(exit.cause);
          completeFailure(cause);
        }
      });
      return shutdownPromise;
    };

    const shutdownAfterLifecycleFailure = (cause: unknown): void => {
      console.error(cause);
      void runShutdown(1);
    };

    const runLifecycleTask = (
      effect: Effect.Effect<void, ElectronOperationErrorAggregate>,
      onFailure: (cause: unknown) => void,
    ): void => {
      void Effect.runPromiseExit(effect).then((exit) => {
        if (Exit.isFailure(exit)) {
          onFailure(causeToElectronBoundaryError(exit.cause));
        }
      });
    };

    const launchElectronEffect = (): Effect.Effect<void, ElectronOperationErrorAggregate> =>
      Effect.gen(function* () {
        if (shutdownStarted || settled) {
          return;
        }
        const generation = launchGeneration + 1;
        launchGeneration = generation;
        yield* buildBundles();
        if (generation !== launchGeneration || shutdownStarted || settled) {
          return;
        }
        abortDevToolsPortWait();
        const activePortPath = devToolsActivePortPath;
        if (activePortPath !== null) {
          yield* prepareDevToolsPortFile(activePortPath);
          if (generation !== launchGeneration || shutdownStarted || settled) {
            return;
          }
          const controller = new AbortController();
          devToolsPortWait = {
            controller,
            exitCodeBeforePublish: null,
            promise: waitForDevToolsActivePort(activePortPath, controller.signal),
          };
        }
        const nextElectron = yield* Effect.sync(() =>
          startElectronProcess(renderer.url, electronExecutablePath, devToolsPortWait !== null),
        );
        electron = nextElectron;
        void nextElectron.exited.then((exitCode) => {
          if (electron !== nextElectron) {
            return;
          }
          electron = null;
          pendingElectronExitCode = exitCode;
          const pendingWait = devToolsPortWait;
          if (pendingWait !== null) {
            pendingWait.exitCodeBeforePublish = exitCode;
            abortDevToolsPortWait();
          }
          if (shutdownStarted || restarting || pendingWait !== null) {
            return;
          }
          void runShutdown(exitCode);
        });
        const portWait = devToolsPortWait;
        if (portWait === null) {
          return;
        }
        const cdpPort = yield* Effect.tryPromise({
          try: () => portWait.promise,
          catch: (cause) =>
            new ElectronOperationError({
              operation: "electron.dev.wait-for-cdp-port",
              message: errorMessage(cause),
              cause,
            }),
        });
        if (generation !== launchGeneration || shutdownStarted || settled) {
          return;
        }
        if (cdpPort === null) {
          const exitCodeBeforePublish = portWait.exitCodeBeforePublish;
          if (exitCodeBeforePublish !== null && !shutdownStarted && !settled) {
            return yield* Effect.fail(
              toElectronOperationError(
                new Error(
                  `Electron exited with code ${exitCodeBeforePublish} before it published the CDP port. ${DEVTOOLS_ACTIVE_PORT_RECOVERY_STEP}`,
                ),
                "electron.dev.wait-for-cdp-port",
              ),
            );
          }
          return;
        }
        devToolsPortWait = null;
        yield* Effect.sync(() => {
          console.log(electronDebugEndpointLogLine(cdpPort));
        });
        if (
          generation === launchGeneration &&
          !shutdownStarted &&
          electron === null &&
          pendingElectronExitCode !== null
        ) {
          void runShutdown(pendingElectronExitCode);
        }
      });

    const restartElectronEffect = (): Effect.Effect<void, ElectronOperationErrorAggregate> =>
      Effect.gen(function* () {
        if (shutdownStarted) {
          return;
        }
        if (restarting) {
          restartQueued = true;
          return;
        }

        restarting = true;
        while (!shutdownStarted) {
          restartQueued = false;
          const restartExit = yield* Effect.exit(
            Effect.gen(function* () {
              console.log(
                "[electron:dev] Restarting Electron after main-process dependency change...",
              );
              abortDevToolsPortWait();
              yield* stopElectronEffect(electron);
              yield* launchElectronEffect();
            }),
          );
          if (Exit.isFailure(restartExit)) {
            yield* Effect.sync(() => {
              restarting = false;
            });
            return yield* Effect.fail(
              toElectronOperationError(
                causeToElectronBoundaryError(restartExit.cause),
                "electron.dev.restart-electron",
              ),
            );
          }
          if (!restartQueued) {
            break;
          }
        }
        yield* Effect.sync(() => {
          restarting = false;
        });
        if (!shutdownStarted && electron === null && pendingElectronExitCode !== null) {
          void runShutdown(pendingElectronExitCode);
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
        runLifecycleTask(restartElectronEffect(), shutdownAfterLifecycleFailure);
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
          renderer.watcher.add([...ELECTRON_RESTART_WATCH_ROOTS]);
          renderer.watcher.on("add", handleWatchedFileChange);
          renderer.watcher.on("change", handleWatchedFileChange);
          renderer.watcher.on("unlink", handleWatchedFileChange);
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
        registerProcessHandler("SIGINT", () => {
          console.log("[electron:dev] Received SIGINT, shutting down...");
          void runShutdown(130);
        });
        registerProcessHandler("SIGTERM", () => {
          console.log("[electron:dev] Received SIGTERM, shutting down...");
          void runShutdown(143);
        });
        // A closed terminal sends SIGHUP. Electron runs in its own process group, so only this
        // script can stop it and let the host stop the runtimes.
        registerProcessHandler("SIGHUP", () => {
          console.log("[electron:dev] Received SIGHUP, shutting down...");
          void runShutdown(129);
        });
        registerProcessHandler("exit", () => {
          if (electron) {
            electron.kill();
          }
        });
      });

    const interruptCleanupEffect = (): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        if (settled || shutdownStarted) {
          return;
        }

        shutdownStarted = true;
        abortDevToolsPortWait();
        if (restartTimer) {
          clearTimeout(restartTimer);
          restartTimer = null;
        }
        removeRegisteredProcessHandlers({ keepExitHandler: true });

        const stopExit = yield* Effect.exit(stopElectronEffect(electron));
        if (Exit.isFailure(stopExit)) {
          yield* Effect.sync(() => {
            console.error(
              "[electron:dev] Electron shutdown after lifecycle interruption failed.",
              causeToElectronBoundaryError(stopExit.cause),
            );
          });
        }

        const closeExit = yield* Effect.exit(renderer.close());
        if (Exit.isFailure(closeExit)) {
          yield* Effect.sync(() => {
            console.error(
              "[electron:dev] Renderer shutdown after lifecycle interruption failed.",
              causeToElectronBoundaryError(closeExit.cause),
            );
          });
        }

        yield* Effect.sync(() => {
          removeRegisteredProcessHandlers({ keepExitHandler: false });
        });
      });

    runLifecycleTask(
      Effect.gen(function* () {
        yield* registerWatcherEffect();
        yield* registerProcessHandlersEffect();
        yield* launchElectronEffect();
      }),
      failLifecycleAfterStoppingElectron,
    );

    return interruptCleanupEffect();
  });

export const mainEffect = (): Effect.Effect<
  number,
  ElectronOperationErrorAggregate | ElectronValidationErrorAggregate
> =>
  Effect.gen(function* () {
    const rendererPort = yield* resolveRendererDevPortEffect(
      process.env.ELECTRON_RENDERER_DEV_PORT,
      "electron.dev.resolve-renderer-dev-port",
    );
    const developmentInstanceId = yield* Effect.try({
      try: () => resolveDevelopmentInstanceId("electron", workspaceRoot),
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.dev.resolve-development-instance",
          message: errorMessage(cause),
          cause,
          path: workspaceRoot,
        }),
    });
    const devToolsActivePortPath = shouldEnableRemoteDebugging(process.argv)
      ? yield* Effect.try({
          try: () => resolveDevToolsActivePortPath(developmentInstanceId),
          catch: (cause) =>
            new ElectronValidationError({
              operation: "electron.dev.resolve-devtools-active-port-path",
              message: errorMessage(cause),
              cause,
            }),
        })
      : null;
    const electronExecutablePath =
      yield* resolveElectronDevExecutablePathEffect(developmentInstanceId);
    const renderer = yield* createElectronRendererDevServerEffect({
      packageRoot,
      port: rendererPort,
    });
    return yield* Effect.gen(function* () {
      const lifecycleExit = yield* Effect.exit(
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            for (const line of electronDevServerLogLines(developmentInstanceId, renderer.url)) {
              console.log(line);
            }
          });
          return yield* runElectronDevLifecycleEffect({
            devToolsActivePortPath,
            electronExecutablePath,
            renderer,
          });
        }),
      );
      if (Exit.isSuccess(lifecycleExit)) {
        return lifecycleExit.value;
      }

      const closeExit = yield* Effect.exit(renderer.close());
      if (Exit.isFailure(closeExit)) {
        yield* Effect.sync(() => {
          console.error(
            "[electron:dev] Renderer shutdown after lifecycle failure failed.",
            causeToElectronBoundaryError(closeExit.cause),
          );
        });
      }
      return yield* Effect.fail(
        toElectronOperationError(
          causeToElectronBoundaryError(lifecycleExit.cause),
          "electron.dev.main",
        ),
      );
    });
  });

if (import.meta.main) {
  const exitCode = await runElectronEffect(mainEffect()).catch((cause: unknown) => {
    console.error(cause);
    return 1;
  });
  process.exit(exitCode);
}
