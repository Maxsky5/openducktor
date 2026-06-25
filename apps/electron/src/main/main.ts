import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHostEventBus,
  type EffectHostCommandRouter,
  HOST_EVENT_CHANNELS,
  type HostRuntimeDistribution,
} from "@openducktor/host";
import { Effect } from "effect";
import type {
  BrowserWindow as ElectronBrowserWindow,
  NativeImage as ElectronNativeImage,
  Session as ElectronSession,
} from "electron";
import electron from "electron";
import { runElectronEffect } from "../effect/electron-boundary";
import {
  ElectronLifecycleError,
  ElectronOperationError,
  ElectronValidationError,
  errorMessage,
  isElectronError,
} from "../effect/electron-errors";
import {
  ELECTRON_HOST_EVENT_CHANNEL,
  ELECTRON_HOST_INVOKE_CHANNEL,
  ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL,
  ELECTRON_OPEN_EXTERNAL_URL_CHANNEL,
  type ElectronHostEventEnvelope,
  type ElectronHostInvokeRequest,
} from "../shared/electron-bridge-contract";
import { configureElectronAppIdentity } from "./electron-app-identity";
import { createElectronEffectHostCommandRouter } from "./electron-host";
import {
  createElectronLocalAttachmentPreviewUrl,
  ELECTRON_LOCAL_ATTACHMENT_PREVIEW_PROTOCOL,
  readLocalAttachmentPreviewPath,
  readLocalAttachmentPreviewPathEffect,
  registerElectronLocalAttachmentPreviewProtocol,
} from "./electron-local-attachment-preview";
import {
  configureElectronLoopbackCorsPolicy,
  resolveElectronLoopbackCorsOrigin,
} from "./electron-loopback-cors-policy";
import {
  composeElectronMainStartupEffect,
  createElectronMainShutdownController,
  runElectronMainStartupBoundary,
} from "./electron-main-lifecycle";
import { electronMainLogger } from "./electron-main-logger";
import { resolveElectronRuntimeDistribution } from "./electron-runtime-distribution";
import { disableElectronKeychainStorage } from "./electron-storage-policy";
import { installApplicationMenu, registerWindowContextMenu } from "./main-menu";

const { app, BrowserWindow, ipcMain, nativeImage, net, protocol, session, shell } = electron;
const APPLICATION_NAME = "OpenDucktor";
const ELECTRON_RENDERER_SESSION_PARTITION = "persist:openducktor";
const ELECTRON_RENDERER_START_PATH = "/kanban";
const rendererDevUrl = process.env.VITE_DEV_SERVER_URL;
const isDevelopment = Boolean(rendererDevUrl);
const distDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(distDirectory, "../../..");

const hostEventBus = createHostEventBus();
let activeHostCommandRouter: EffectHostCommandRouter | null = null;

const shutdownController = createElectronMainShutdownController({
  disposeHost: (reason) => disposeActiveHostEffect(reason),
  exitProcess: (exitCode) => {
    process.exit(exitCode);
  },
  logger: electronMainLogger,
  quitApp: () => {
    app.quit();
  },
});

type ElectronPreReadyRuntime = {
  hostCommandRouter: EffectHostCommandRouter;
};

type ElectronReadyRuntime = ElectronPreReadyRuntime & {
  rendererSession: ElectronSession;
};

const mapStartupPreparationError = (
  cause: unknown,
  operation: string,
  message: string,
): ElectronLifecycleError | ElectronOperationError | ElectronValidationError =>
  isElectronError(cause)
    ? cause
    : new ElectronLifecycleError({
        operation,
        message,
        cause,
      });

const registerPrivilegedProtocolSchemes = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ELECTRON_LOCAL_ATTACHMENT_PREVIEW_PROTOCOL,
      privileges: {
        secure: true,
        standard: true,
        stream: true,
        supportFetchAPI: true,
      },
    },
  ]);
};

const createElectronHostCommandRouter = (
  runtimeDistribution: HostRuntimeDistribution,
): EffectHostCommandRouter =>
  createElectronEffectHostCommandRouter({
    clientVersion: app.getVersion(),
    eventBus: hostEventBus,
    lifecycleLogger: electronMainLogger,
    runtimeDistribution,
  });

const resolveRuntimeDistributionEffect = (): Effect.Effect<
  HostRuntimeDistribution,
  ElectronLifecycleError
> =>
  Effect.try({
    try: () =>
      resolveElectronRuntimeDistribution({
        platform: process.platform,
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        workspaceRoot,
      }),
    catch: (cause) =>
      new ElectronLifecycleError({
        operation: "electron.main.resolve-runtime-distribution",
        message: errorMessage(cause),
        cause,
      }),
  });

const prepareElectronPreReadyRuntimeEffect = (): Effect.Effect<
  ElectronPreReadyRuntime,
  ElectronLifecycleError | ElectronOperationError | ElectronValidationError
> =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => configureElectronAppIdentity(app, { appName: APPLICATION_NAME }),
      catch: (cause) =>
        mapStartupPreparationError(
          cause,
          "electron.main.configure-app-identity",
          errorMessage(cause),
        ),
    });
    yield* Effect.try({
      try: () => disableElectronKeychainStorage(app.commandLine),
      catch: (cause) =>
        mapStartupPreparationError(
          cause,
          "electron.main.disable-keychain-storage",
          errorMessage(cause),
        ),
    });
    yield* Effect.try({
      try: registerPrivilegedProtocolSchemes,
      catch: (cause) =>
        mapStartupPreparationError(
          cause,
          "electron.main.register-privileged-protocols",
          errorMessage(cause),
        ),
    });
    const runtimeDistribution = yield* resolveRuntimeDistributionEffect();
    const hostCommandRouter = yield* Effect.try({
      try: () => createElectronHostCommandRouter(runtimeDistribution),
      catch: (cause) =>
        mapStartupPreparationError(cause, "electron.main.create-host-router", errorMessage(cause)),
    });
    activeHostCommandRouter = hostCommandRouter;
    return { hostCommandRouter };
  });

const getPreloadPath = (): string => path.join(distDirectory, "preload.cjs");

const getRendererIndexPath = (): string => path.join(distDirectory, "renderer", "index.html");

const resolveElectronIconDirectory = (): string =>
  app.isPackaged ? process.resourcesPath : path.resolve(distDirectory, "..", "resources");

const resolveElectronWindowIconPath = (): string => {
  const iconFileName = process.platform === "win32" ? "icon.ico" : "icon.png";
  return path.join(resolveElectronIconDirectory(), iconFileName);
};

const createElectronIconImage = (iconPath: string, label: string): ElectronNativeImage => {
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    throw new ElectronOperationError({
      operation: "electron.main.load-icon",
      message: `Electron ${label} icon is missing or invalid: ${iconPath}`,
      path: iconPath,
      details: { label },
    });
  }
  return icon;
};

const resolveElectronWindowIcon = (): ElectronNativeImage =>
  createElectronIconImage(resolveElectronWindowIconPath(), "window");

const configureElectronDockIcon = (): void => {
  if (!app.dock) {
    return;
  }

  app.dock.setIcon(
    createElectronIconImage(path.join(resolveElectronIconDirectory(), "icon.png"), "dock"),
  );
};

const validateExternalUrl = (url: string): string => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.trim());
  } catch {
    throw new ElectronValidationError({
      operation: "electron.ipc.open-external-url.validate",
      message: "OpenDucktor Electron can only open absolute http or https URLs.",
      field: "url",
      details: { url },
    });
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new ElectronValidationError({
      operation: "electron.ipc.open-external-url.validate",
      message: "OpenDucktor Electron can only open http or https URLs.",
      field: "url",
      details: { url, protocol: parsedUrl.protocol },
    });
  }

  return parsedUrl.href;
};

const openExternalUrlEffect = (
  url: string,
): Effect.Effect<void, ElectronOperationError | ElectronValidationError> =>
  Effect.gen(function* () {
    const externalUrl = yield* Effect.try({
      try: () => validateExternalUrl(url),
      catch: (cause) =>
        cause instanceof ElectronValidationError
          ? cause
          : new ElectronValidationError({
              operation: "electron.ipc.open-external-url.validate",
              message: errorMessage(cause),
              field: "url",
              cause,
              details: { url },
            }),
    });
    yield* Effect.tryPromise({
      try: () => shell.openExternal(externalUrl),
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.ipc.open-external-url",
          message: errorMessage(cause),
          cause,
          details: { url: externalUrl },
        }),
    });
  });

const createMainWindowEffect = (
  rendererSession: ElectronSession,
): Effect.Effect<ElectronBrowserWindow, ElectronOperationError> =>
  Effect.gen(function* () {
    const window = yield* Effect.try({
      try: () =>
        new BrowserWindow({
          width: 1440,
          height: 960,
          minWidth: 1024,
          minHeight: 720,
          autoHideMenuBar: process.platform !== "darwin",
          title: "OpenDucktor",
          icon: resolveElectronWindowIcon(),
          webPreferences: {
            contextIsolation: true,
            devTools: isDevelopment,
            nodeIntegration: false,
            preload: getPreloadPath(),
            sandbox: true,
            session: rendererSession,
          },
        }),
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.main.create-window",
          message: errorMessage(cause),
          cause,
        }),
    });
    registerWindowContextMenu(window, { isDevelopment });
    window.on("close", (event) => {
      if (shutdownController.isHostShutdownComplete()) {
        return;
      }
      event.preventDefault();
      hideWindowsForShutdown();
      if (shutdownController.isHostShutdownStarted()) {
        return;
      }
      void shutdownController.shutdownHostAndQuit({ reason: "window-close" });
    });

    if (rendererDevUrl) {
      yield* Effect.tryPromise({
        try: () => window.loadURL(rendererDevUrl),
        catch: (cause) =>
          new ElectronOperationError({
            operation: "electron.main.load-renderer-url",
            message: errorMessage(cause),
            cause,
            details: { rendererDevUrl },
          }),
      });
      return window;
    }

    const rendererIndexPath = getRendererIndexPath();
    yield* Effect.tryPromise({
      try: () => window.loadFile(rendererIndexPath, { hash: ELECTRON_RENDERER_START_PATH }),
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.main.load-renderer-file",
          message: errorMessage(cause),
          path: rendererIndexPath,
          cause,
        }),
    });
    return window;
  });

const createMainWindow = (rendererSession: ElectronSession): Promise<ElectronBrowserWindow> =>
  runElectronEffect(createMainWindowEffect(rendererSession));

const registerHostEventForwarding = (): void => {
  for (const channel of HOST_EVENT_CHANNELS) {
    hostEventBus.subscribe(channel, (payload) => {
      const envelope: ElectronHostEventEnvelope = { channel, payload };
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(ELECTRON_HOST_EVENT_CHANNEL, envelope);
      }
    });
  }
};

const resolveLocalAttachmentPathForPreviewEffect = (
  hostCommandRouter: EffectHostCommandRouter,
  filePath: string,
) =>
  Effect.gen(function* () {
    const resolved = yield* hostCommandRouter.invoke("workspace_resolve_local_attachment_path", {
      path: filePath,
    });
    if (typeof resolved !== "object" || resolved === null || !("path" in resolved)) {
      return yield* new ElectronValidationError({
        operation: "electron.preview.resolve-host-path",
        message: "Local attachment preview resolver returned an invalid response.",
        field: "path",
        details: { filePath },
      });
    }

    return yield* readLocalAttachmentPreviewPathEffect(resolved.path).pipe(
      Effect.mapError(
        (cause) =>
          new ElectronValidationError({
            operation: "electron.preview.validate-host-path",
            message: cause.message,
            field: "path",
            cause,
            details: { filePath },
          }),
      ),
    );
  });

const resolveLocalAttachmentPathForPreview = (
  hostCommandRouter: EffectHostCommandRouter,
  filePath: string,
): Promise<string> =>
  runElectronEffect(resolveLocalAttachmentPathForPreviewEffect(hostCommandRouter, filePath));

const registerIpcHandlers = (hostCommandRouter: EffectHostCommandRouter): void => {
  ipcMain.handle(ELECTRON_HOST_INVOKE_CHANNEL, async (_event, request: ElectronHostInvokeRequest) =>
    runElectronEffect(hostCommandRouter.invoke(request.command, request.args)),
  );

  ipcMain.handle(ELECTRON_OPEN_EXTERNAL_URL_CHANNEL, async (_event, url: string) => {
    await runElectronEffect(openExternalUrlEffect(url));
  });

  ipcMain.handle(ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL, async (_event, filePath: unknown) => {
    const resolvedPath = await resolveLocalAttachmentPathForPreview(
      hostCommandRouter,
      readLocalAttachmentPreviewPath(filePath),
    );
    return createElectronLocalAttachmentPreviewUrl(resolvedPath);
  });
};

const disposeHostEffect = (hostCommandRouter: EffectHostCommandRouter, reason: string) =>
  hostCommandRouter.dispose().pipe(
    Effect.mapError(
      (cause) =>
        new ElectronLifecycleError({
          operation: "electron.main.dispose-host",
          message: errorMessage(cause),
          reason,
          cause,
        }),
    ),
  );

const disposeActiveHostEffect = (reason: string): Effect.Effect<void, ElectronLifecycleError> => {
  if (!activeHostCommandRouter) {
    return Effect.void;
  }
  return disposeHostEffect(activeHostCommandRouter, reason);
};

const initializeHostEffect = (hostCommandRouter: EffectHostCommandRouter) =>
  hostCommandRouter.initialize().pipe(
    Effect.mapError(
      (cause) =>
        new ElectronLifecycleError({
          operation: "electron.main.initialize-host",
          message: errorMessage(cause),
          cause,
        }),
    ),
  );

const shutdownHostForSignal = (signal: NodeJS.Signals): void => {
  void shutdownController.shutdownHostAndQuit({ exitAfterShutdown: true, reason: signal });
};

const hideWindowsForShutdown = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.hide();
  }
};

const waitForElectronReadyEffect = (): Effect.Effect<void, ElectronLifecycleError> =>
  Effect.tryPromise({
    try: async () => {
      await app.whenReady();
    },
    catch: (cause) =>
      new ElectronLifecycleError({
        operation: "electron.main.wait-ready",
        message: errorMessage(cause),
        cause,
      }),
  });

const configureElectronReadyRuntimeEffect = ({
  hostCommandRouter,
}: ElectronPreReadyRuntime): Effect.Effect<
  ElectronReadyRuntime,
  ElectronLifecycleError | ElectronOperationError | ElectronValidationError
> =>
  Effect.try({
    try: () => {
      const rendererSession = session.fromPartition(ELECTRON_RENDERER_SESSION_PARTITION);
      configureElectronLoopbackCorsPolicy(
        rendererSession,
        resolveElectronLoopbackCorsOrigin(rendererDevUrl),
      );
      registerElectronLocalAttachmentPreviewProtocol({
        net,
        resolveLocalAttachmentPath: (filePath) =>
          resolveLocalAttachmentPathForPreview(hostCommandRouter, filePath),
        session: rendererSession,
      });
      installApplicationMenu({ isDevelopment, appName: app.name || APPLICATION_NAME });
      registerIpcHandlers(hostCommandRouter);
      registerHostEventForwarding();
      configureElectronDockIcon();
      return { hostCommandRouter, rendererSession };
    },
    catch: (cause) =>
      mapStartupPreparationError(
        cause,
        "electron.main.configure-ready-runtime",
        errorMessage(cause),
      ),
  });

const startupEffect = composeElectronMainStartupEffect({
  configureReady: configureElectronReadyRuntimeEffect,
  createMainWindow: ({ rendererSession }) =>
    createMainWindowEffect(rendererSession).pipe(Effect.asVoid),
  initializeHost: ({ hostCommandRouter }) => initializeHostEffect(hostCommandRouter),
  preparePreReady: prepareElectronPreReadyRuntimeEffect,
  registerActivateHandler: ({ rendererSession }) => {
    app.on("activate", () => {
      if (shutdownController.isHostShutdownStarted()) {
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow(rendererSession);
      }
    });
  },
  waitUntilReady: waitForElectronReadyEffect,
});

void runElectronMainStartupBoundary({
  cleanupAfterFailure: () => disposeActiveHostEffect("startup-failure"),
  exitProcess: (exitCode) => {
    process.exit(exitCode);
  },
  logger: electronMainLogger,
  markShutdownComplete: shutdownController.markHostShutdownComplete,
  markShutdownStarted: shutdownController.markHostShutdownStarted,
  startupEffect,
});

app.on("window-all-closed", () => {
  void shutdownController.shutdownHostAndQuit({ reason: "window-all-closed" });
});

app.on("before-quit", (event) => {
  if (shutdownController.isHostShutdownComplete()) {
    return;
  }
  event.preventDefault();
  hideWindowsForShutdown();
  void shutdownController.shutdownHostAndQuit({ reason: "before-quit" });
});

process.once("SIGINT", shutdownHostForSignal);
process.once("SIGTERM", shutdownHostForSignal);
process.once("SIGHUP", shutdownHostForSignal);
