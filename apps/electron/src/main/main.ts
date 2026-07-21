import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AppUpdateCommandResult,
  type AppUpdateOperation,
  type AppUpdateState,
  appUpdateCheckInputSchema,
  appUpdateCommandResultSchema,
  appUpdateStateSchema,
} from "@openducktor/contracts";
import {
  createHostEventBus,
  type EffectHostCommandRouter,
  type EffectNodeHostCommandRouter,
  HOST_EVENT_CHANNELS,
  type HostRuntimeDistribution,
} from "@openducktor/host";
import { Effect, Either } from "effect";
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
  ELECTRON_APP_UPDATE_CHECK_CHANNEL,
  ELECTRON_APP_UPDATE_DOWNLOAD_CHANNEL,
  ELECTRON_APP_UPDATE_GET_STATE_CHANNEL,
  ELECTRON_APP_UPDATE_INSTALL_CHANNEL,
  ELECTRON_APP_UPDATE_STATE_CHANGED_CHANNEL,
  ELECTRON_HOST_EVENT_CHANNEL,
  ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL,
  ELECTRON_OPEN_EXTERNAL_URL_CHANNEL,
  ELECTRON_TERMINAL_DISCONNECT_CHANNEL,
  ELECTRON_TERMINAL_SEND_CHANNEL,
  type ElectronAppUpdateCheckInput,
  type ElectronHostEventEnvelope,
} from "../shared/electron-bridge-contract";
import {
  createElectronAppUpdateService,
  type ElectronAppUpdateService,
} from "./app-updates/electron-app-update-service";
import { createElectronUpdaterAdapter } from "./app-updates/electron-updater-adapter";
import { createGitHubReleaseSource } from "./app-updates/github-release-source";
import { configureElectronAppIdentity, resolveElectronProfileKind } from "./electron-app-identity";
import { createElectronEffectHostCommandRouter } from "./electron-host";
import { runElectronHostInvoke } from "./electron-host-invoke";
import { registerElectronHostInvokeHandler } from "./electron-host-invoke-handler";
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
import { createElectronMainLogger, initializeElectronMainLogger } from "./electron-main-logger";
import { createElectronMainRuntimeBindings } from "./electron-main-runtime-bindings";
import { resolveElectronRuntimeDistribution } from "./electron-runtime-distribution";
import { disableElectronKeychainStorage } from "./electron-storage-policy";
import { installApplicationMenu, registerWindowContextMenu } from "./main-menu";
import {
  createElectronTerminalIpcController,
  shouldDetachTerminalSenderForNavigation,
} from "./terminals/electron-terminal-ipc";
import { createNodePtyPort } from "./terminals/node-pty-adapter";

const { app, BrowserWindow, ipcMain, nativeImage, net, protocol, session, shell } = electron;
const APPLICATION_NAME = "OpenDucktor";
const ELECTRON_RENDERER_SESSION_PARTITION = "persist:openducktor";
const ELECTRON_RENDERER_START_PATH = "/kanban";
const rendererDevUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;
const isDevelopment = Boolean(rendererDevUrl);
const distDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(distDirectory, "../../..");

const reportElectronMainFailure = (cause: unknown): void => {
  process.stderr.write(`OpenDucktor Electron fatal boundary: ${errorMessage(cause)}\n`);
};
const electronMainLogger = await initializeElectronMainLogger({
  exitProcess: (exitCode) => process.exit(exitCode),
  loggerEffect: createElectronMainLogger(),
  reportFailure: reportElectronMainFailure,
});
const electronMainRuntimeBindings = createElectronMainRuntimeBindings(electronMainLogger);
const electronAppUpdateLogger = electronMainRuntimeBindings.appUpdateLogger;
const electronLifecycleLogger = electronMainRuntimeBindings.lifecycleLogger;
const hostEventBus = createHostEventBus();
let activeHostCommandRouter: EffectHostCommandRouter | null = null;
let activeAppUpdateService: ElectronAppUpdateService | null = null;

const isTaggedHostValidationError = (
  cause: unknown,
): cause is {
  readonly field?: string;
  readonly message: string;
  readonly _tag: "HostValidationError";
} =>
  typeof cause === "object" &&
  cause !== null &&
  "_tag" in cause &&
  cause._tag === "HostValidationError" &&
  "message" in cause &&
  typeof cause.message === "string";

const shutdownController = createElectronMainShutdownController({
  disposeHost: (reason) => disposeActiveElectronRuntimeForShutdownEffect(reason),
  drainHostCommands: electronMainRuntimeBindings.drainHostCommands,
  exitProcess: (exitCode) => {
    process.exit(exitCode);
  },
  logger: electronLifecycleLogger,
  quitApp: () => {
    app.quit();
  },
  reportFailure: reportElectronMainFailure,
});

const reportElectronMainFatalFailure = (cause: unknown): void => {
  reportElectronMainFailure(cause);
  shutdownController.markHostShutdownFailed();
  if (shutdownController.isHostShutdownComplete()) {
    process.exit(1);
    return;
  }
  if (shutdownController.isHostShutdownStarted()) {
    return;
  }
  void shutdownController
    .shutdownHostAndQuit({ exitAfterShutdown: true, reason: "fatal-boundary" })
    .catch((shutdownCause: unknown) => {
      reportElectronMainFailure(shutdownCause);
      process.exit(1);
    });
};

const runElectronMainTask = electronMainRuntimeBindings.createTaskRunner(
  reportElectronMainFatalFailure,
);

const runElectronMainOperation = async <Result>(operation: Promise<Result>): Promise<Result> => {
  try {
    return await operation;
  } catch (cause) {
    reportElectronMainFatalFailure(cause);
    throw cause;
  }
};

type ElectronPreReadyRuntime = {
  hostCommandRouter: EffectNodeHostCommandRouter;
};

type ElectronReadyRuntime = ElectronPreReadyRuntime & {
  appUpdateService: ElectronAppUpdateService;
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
): EffectNodeHostCommandRouter =>
  createElectronEffectHostCommandRouter({
    clientVersion: app.getVersion(),
    eventBus: hostEventBus,
    isPackaged: app.isPackaged,
    lifecycleLogger: electronLifecycleLogger,
    onBackgroundFailure: (failure) =>
      Effect.sync(() => {
        reportElectronMainFatalFailure(failure);
      }),
    runtimeDistribution,
    terminalPty: createNodePtyPort(),
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
      try: () =>
        configureElectronAppIdentity(app, {
          appName: APPLICATION_NAME,
          profileKind: resolveElectronProfileKind(app.isPackaged),
        }),
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
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => {
      event.preventDefault();
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
      runElectronMainTask(() => shutdownController.shutdownHostAndQuit({ reason: "window-close" }));
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
        if (window.isDestroyed() || window.webContents.isDestroyed()) {
          continue;
        }
        window.webContents.send(ELECTRON_HOST_EVENT_CHANNEL, envelope);
      }
    });
  }
};

const registerAppUpdateStateForwarding = (appUpdateService: ElectronAppUpdateService): void => {
  appUpdateService.subscribe((state) => {
    let parsedState: AppUpdateState;
    try {
      parsedState = readAppUpdateStateForIpc(state);
    } catch (cause) {
      runElectronMainTask(() =>
        runElectronEffect(
          electronMainLogger.error("OpenDucktor update state forwarding failed", cause),
        ),
      );
      return;
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        continue;
      }
      try {
        window.webContents.send(ELECTRON_APP_UPDATE_STATE_CHANGED_CHANNEL, parsedState);
      } catch (cause) {
        runElectronMainTask(() =>
          runElectronEffect(
            electronMainLogger.error("OpenDucktor update state forwarding failed", cause),
          ),
        );
      }
    }
  });
};

const resolveLocalAttachmentPathForPreviewEffect = (
  hostCommandRouter: EffectHostCommandRouter,
  filePath: string,
) =>
  Effect.gen(function* () {
    const resolved = yield* hostCommandRouter
      .invoke("workspace_resolve_local_attachment_path", {
        path: filePath,
      })
      .pipe(
        Effect.mapError((cause) => {
          if (isElectronError(cause)) {
            return cause;
          }
          if (isTaggedHostValidationError(cause)) {
            return new ElectronValidationError({
              operation: "electron.preview.resolve-host-path",
              message: cause.message,
              field: cause.field ?? "path",
              cause,
              details: { filePath },
            });
          }
          return new ElectronOperationError({
            operation: "electron.preview.resolve-host-path",
            message: errorMessage(cause),
            path: filePath,
            cause,
          });
        }),
      );
    if (typeof resolved !== "object" || resolved === null || !("path" in resolved)) {
      return yield* Effect.fail(
        new ElectronValidationError({
          operation: "electron.preview.resolve-host-path",
          message: "Local attachment preview resolver returned an invalid response.",
          field: "path",
          details: { filePath },
        }),
      );
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

const readElectronAppUpdateCheckInput = (input: unknown): ElectronAppUpdateCheckInput => {
  const parsed = appUpdateCheckInputSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  throw new ElectronValidationError({
    operation: "electron.ipc.app-update-check.validate",
    message: "Expected update check initiator to be settings or menu.",
    field: "initiator",
    details: { issues: parsed.error.issues },
  });
};

const readAppUpdateStateForIpc = (state: AppUpdateState): AppUpdateState => {
  const parsed = appUpdateStateSchema.safeParse(state);
  if (parsed.success) {
    return parsed.data;
  }

  throw new ElectronValidationError({
    operation: "electron.ipc.app-update-state.validate",
    message: "Electron app update state failed contract validation.",
    field: "state",
    details: { issues: parsed.error.issues },
  });
};

const readAppUpdateCommandResultForIpc = (
  result: AppUpdateCommandResult,
  operation: AppUpdateOperation,
): AppUpdateCommandResult => {
  const parsed = appUpdateCommandResultSchema.safeParse(result);
  if (parsed.success) {
    return parsed.data;
  }

  throw new ElectronValidationError({
    operation: `electron.ipc.app-update-${operation}.validate-result`,
    message: "Electron app update command result failed contract validation.",
    field: "result",
    details: { issues: parsed.error.issues },
  });
};

const createRejectedAppUpdateCommandResult = (
  appUpdateService: ElectronAppUpdateService,
  operation: AppUpdateOperation,
  cause: unknown,
): AppUpdateCommandResult => ({
  accepted: false,
  rejection: {
    code: "invalid_state",
    message: errorMessage(cause),
    operation,
  },
  state: appUpdateService.getState(),
});

const registerIpcHandlers = (
  hostCommandRouter: EffectNodeHostCommandRouter,
  appUpdateService: ElectronAppUpdateService,
): void => {
  const terminalIpc = createElectronTerminalIpcController(hostCommandRouter.terminalService);
  const boundTerminalSenders = new WeakSet<Electron.WebContents>();
  const bindTerminalSenderCleanup = (sender: Electron.WebContents): void => {
    if (boundTerminalSenders.has(sender)) return;
    boundTerminalSenders.add(sender);
    const detach = () => {
      void runElectronEffect(terminalIpc.detachSender(sender.id));
    };
    sender.once("destroyed", detach);
    sender.on("did-start-navigation", (details) => {
      if (shouldDetachTerminalSenderForNavigation(details)) detach();
    });
  };
  registerElectronHostInvokeHandler(ipcMain, {
    isHostShutdownStarted: shutdownController.isHostShutdownStarted,
    invoke: (command, args) => {
      const operation = hostCommandRouter.invoke(command, args);
      return runElectronHostInvoke(operation, (effect) =>
        electronMainRuntimeBindings.runHostCommand(command, effect),
      );
    },
  });

  ipcMain.handle(ELECTRON_TERMINAL_SEND_CHANNEL, async (event, request: unknown) => {
    bindTerminalSenderCleanup(event.sender);
    const clientId =
      typeof request === "object" && request !== null && "clientId" in request
        ? request.clientId
        : undefined;
    const frame =
      typeof request === "object" && request !== null && "frame" in request
        ? request.frame
        : undefined;
    await runElectronEffect(terminalIpc.handleFrame(event.sender, clientId, frame));
  });

  ipcMain.handle(ELECTRON_TERMINAL_DISCONNECT_CHANNEL, async (event, clientId: unknown) => {
    bindTerminalSenderCleanup(event.sender);
    await runElectronEffect(terminalIpc.detachClient(event.sender.id, clientId));
  });

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

  ipcMain.handle(ELECTRON_APP_UPDATE_GET_STATE_CHANNEL, () =>
    readAppUpdateStateForIpc(appUpdateService.getState()),
  );

  ipcMain.handle(ELECTRON_APP_UPDATE_CHECK_CHANNEL, async (_event, input: unknown) => {
    let checkInput: ElectronAppUpdateCheckInput;
    try {
      checkInput = readElectronAppUpdateCheckInput(input);
    } catch (cause) {
      return readAppUpdateCommandResultForIpc(
        createRejectedAppUpdateCommandResult(appUpdateService, "check", cause),
        "check",
      );
    }
    return readAppUpdateCommandResultForIpc(
      await runElectronMainOperation(appUpdateService.check(checkInput)),
      "check",
    );
  });

  ipcMain.handle(ELECTRON_APP_UPDATE_DOWNLOAD_CHANNEL, async () =>
    readAppUpdateCommandResultForIpc(
      await runElectronMainOperation(appUpdateService.download()),
      "download",
    ),
  );

  ipcMain.handle(ELECTRON_APP_UPDATE_INSTALL_CHANNEL, async () =>
    readAppUpdateCommandResultForIpc(
      await runElectronMainOperation(appUpdateService.install()),
      "install",
    ),
  );
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

const disposeActiveAppUpdateService = async (): Promise<void> => {
  const service = activeAppUpdateService;
  activeAppUpdateService = null;
  await service?.dispose();
};

const disposeActiveElectronRuntimeEffect = (
  reason: string,
): Effect.Effect<void, ElectronLifecycleError> =>
  Effect.gen(function* () {
    const updaterResult = yield* Effect.either(
      Effect.tryPromise({
        try: disposeActiveAppUpdateService,
        catch: (cause) =>
          new ElectronLifecycleError({
            operation: "electron.main.dispose-app-updater",
            message: errorMessage(cause),
            reason,
            cause,
          }),
      }),
    );
    const hostResult = yield* Effect.either(disposeActiveHostEffect(reason));
    if (Either.isLeft(updaterResult)) {
      return yield* Effect.fail(updaterResult.left);
    }
    if (Either.isLeft(hostResult)) {
      return yield* Effect.fail(hostResult.left);
    }
  });

const disposeActiveElectronRuntimeForShutdownEffect = (
  reason: string,
): Effect.Effect<void, ElectronLifecycleError> => {
  if (reason === "update-install") {
    return disposeActiveHostEffect(reason);
  }
  return disposeActiveElectronRuntimeEffect(reason);
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
  runElectronMainTask(() =>
    shutdownController.shutdownHostAndQuit({ exitAfterShutdown: true, reason: signal }),
  );
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
      if (activeAppUpdateService) {
        throw new ElectronLifecycleError({
          operation: "electron.main.configure-app-updater",
          message: "Electron app updater is already configured.",
        });
      }
      const currentVersion = app.getVersion();
      const releaseSource = createGitHubReleaseSource({
        fetch: globalThis.fetch,
        owner: "Maxsky5",
        repo: "openducktor",
      });
      const appUpdateAdapter = createElectronUpdaterAdapter({ currentVersion, releaseSource });
      const appUpdateService = createElectronAppUpdateService({
        adapter: appUpdateAdapter,
        appImagePath: process.env.APPIMAGE,
        currentVersion,
        installDownloadedUpdate: (runInstall) =>
          shutdownController.shutdownHostAndRun({
            reason: "update-install",
            runAfterShutdown: runInstall,
          }),
        isPackaged: app.isPackaged,
        logger: electronAppUpdateLogger,
        onFatalError: reportElectronMainFatalFailure,
        platform: process.platform,
        resourcesPath: process.resourcesPath,
      });
      activeAppUpdateService = appUpdateService;
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
      installApplicationMenu({
        isDevelopment,
        appName: app.name || APPLICATION_NAME,
        onCheckForUpdates: () => {
          runElectronMainTask(() => appUpdateService.check({ initiator: "menu" }).then(() => {}));
        },
      });
      registerIpcHandlers(hostCommandRouter, appUpdateService);
      registerHostEventForwarding();
      registerAppUpdateStateForwarding(appUpdateService);
      configureElectronDockIcon();
      return { appUpdateService, hostCommandRouter, rendererSession };
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
  createMainWindow: ({ appUpdateService, rendererSession }) =>
    createMainWindowEffect(rendererSession).pipe(
      Effect.tap(() => Effect.sync(() => appUpdateService.startBackgroundChecks())),
      Effect.asVoid,
    ),
  initializeHost: ({ hostCommandRouter }) => initializeHostEffect(hostCommandRouter),
  preparePreReady: prepareElectronPreReadyRuntimeEffect,
  registerActivateHandler: ({ rendererSession }) => {
    app.on("activate", () => {
      if (shutdownController.isHostShutdownStarted()) {
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) {
        runElectronMainTask(() => createMainWindow(rendererSession).then(() => {}));
      }
    });
  },
  shouldContinueStartup: () => !shutdownController.isHostShutdownStarted(),
  waitUntilReady: waitForElectronReadyEffect,
});

runElectronMainTask(() =>
  runElectronMainStartupBoundary({
    cleanupAfterFailure: () => disposeActiveElectronRuntimeEffect("startup-failure"),
    exitProcess: (exitCode) => {
      process.exit(exitCode);
    },
    logger: electronLifecycleLogger,
    markShutdownComplete: shutdownController.markHostShutdownComplete,
    markShutdownStarted: shutdownController.markHostShutdownStarted,
    reportFailure: reportElectronMainFailure,
    startupEffect,
  }),
);

app.on("window-all-closed", () => {
  runElectronMainTask(() =>
    shutdownController.shutdownHostAndQuit({ reason: "window-all-closed" }),
  );
});

app.on("before-quit", (event) => {
  if (shutdownController.isHostShutdownComplete()) {
    return;
  }
  event.preventDefault();
  hideWindowsForShutdown();
  runElectronMainTask(() => shutdownController.shutdownHostAndQuit({ reason: "before-quit" }));
});

process.once("SIGINT", shutdownHostForSignal);
process.once("SIGTERM", shutdownHostForSignal);
process.once("SIGHUP", shutdownHostForSignal);
