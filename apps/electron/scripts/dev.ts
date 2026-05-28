import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";

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
const DEFAULT_RENDERER_DEV_PORT = 1430;
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

const waitForProcessExit = async (
  subprocess: Pick<ManagedElectronProcess, "exited">,
  timeoutMs: number,
): Promise<boolean> => {
  let exited = false;
  await Promise.race([
    subprocess.exited.then(() => {
      exited = true;
    }),
    sleep(timeoutMs),
  ]);
  return exited;
};

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

const readFileIfExists = async (filePath: string): Promise<string | null> => {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const assertFileExists = async (filePath: string, label: string): Promise<void> => {
  let metadata: Awaited<ReturnType<typeof stat>>;
  try {
    metadata = await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${label} was not found: ${filePath}`);
    }
    throw error;
  }

  if (!metadata.isFile()) {
    throw new Error(`${label} must be a file: ${filePath}`);
  }
};

const fileSignature = async (filePath: string): Promise<{ mtimeMs: number; size: number }> => {
  const metadata = await stat(filePath);
  return {
    mtimeMs: metadata.mtimeMs,
    size: metadata.size,
  };
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

export const resolveMacosAppBundlePath = (electronExecutablePath: string): string | null => {
  const appBundleMarker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
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

export const resolveMacosDevAppPath = (): string =>
  path.join(packageRoot, ".electron-dev", `${APPLICATION_NAME}.app`);

export const resolveMacosDevExecutablePath = (devAppPath: string, executableName: string): string =>
  path.join(devAppPath, "Contents", "MacOS", executableName);

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
      sourceInfoPlist: await fileSignature(path.join(sourceAppPath, "Contents", "Info.plist")),
    },
    null,
    2,
  )}\n`;

const prepareMacosDevElectronBundle = async (sourceExecutablePath: string): Promise<string> => {
  const sourceAppPath = resolveMacosAppBundlePath(sourceExecutablePath);
  if (!sourceAppPath) {
    throw new Error(
      `Electron macOS dev executable is not inside an app bundle: ${sourceExecutablePath}`,
    );
  }

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

const stopElectron = async (electron: ManagedElectronProcess | null): Promise<void> => {
  if (!electron) {
    return;
  }

  electron.kill();
  if (await waitForProcessExit(electron, ELECTRON_STOP_TIMEOUT_MS)) {
    return;
  }

  electron.kill(9);
  await waitForProcessExit(electron, ELECTRON_STOP_TIMEOUT_MS);
};

export const closeRendererServer = async (
  server: ViteDevServer | null,
  closeSleep: (durationMs: number) => Promise<unknown> = sleep,
): Promise<void> => {
  if (server) {
    let closePromise: Promise<void>;
    try {
      closePromise = server.close();
    } finally {
      forceCloseRendererConnections(server);
    }
    await Promise.race([closePromise, closeSleep(RENDERER_CLOSE_TIMEOUT_MS)]);
  }
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
      void shutdown(130);
    });
    process.once("SIGTERM", () => {
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
