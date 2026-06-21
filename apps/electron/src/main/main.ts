import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHostEventBus, HOST_EVENT_CHANNELS } from "@openducktor/host";
import type {
  BrowserWindow as ElectronBrowserWindow,
  NativeImage as ElectronNativeImage,
  Session as ElectronSession,
} from "electron";
import electron from "electron";
import {
  ELECTRON_HOST_EVENT_CHANNEL,
  ELECTRON_HOST_INVOKE_CHANNEL,
  ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL,
  ELECTRON_OPEN_EXTERNAL_URL_CHANNEL,
  type ElectronHostEventEnvelope,
  type ElectronHostInvokeRequest,
} from "../shared/electron-bridge-contract";
import { configureElectronAppIdentity } from "./electron-app-identity";
import { createElectronHostCommandRouter } from "./electron-host";
import {
  createElectronLocalAttachmentPreviewUrl,
  ELECTRON_LOCAL_ATTACHMENT_PREVIEW_PROTOCOL,
  readLocalAttachmentPreviewPath,
  registerElectronLocalAttachmentPreviewProtocol,
} from "./electron-local-attachment-preview";
import {
  configureElectronLoopbackCorsPolicy,
  resolveElectronLoopbackCorsOrigin,
} from "./electron-loopback-cors-policy";
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

configureElectronAppIdentity(app, { appName: APPLICATION_NAME });
disableElectronKeychainStorage(app.commandLine);
const runtimeDistribution = resolveElectronRuntimeDistribution({
  platform: process.platform,
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  workspaceRoot,
});

const hostEventBus = createHostEventBus();
const hostCommandRouter = createElectronHostCommandRouter({
  clientVersion: app.getVersion(),
  eventBus: hostEventBus,
  lifecycleLogger: electronMainLogger,
  runtimeDistribution,
});
let hostShutdownStarted = false;
let hostShutdownComplete = false;

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
    throw new Error(`Electron ${label} icon is missing or invalid: ${iconPath}`);
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
    throw new Error("OpenDucktor Electron can only open absolute http or https URLs.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("OpenDucktor Electron can only open http or https URLs.");
  }

  return parsedUrl.href;
};

const createMainWindow = async (
  rendererSession: ElectronSession,
): Promise<ElectronBrowserWindow> => {
  const window = new BrowserWindow({
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
  });
  registerWindowContextMenu(window, { isDevelopment });
  window.on("close", (event) => {
    if (hostShutdownComplete) {
      return;
    }
    event.preventDefault();
    hideWindowsForShutdown();
    if (hostShutdownStarted) {
      return;
    }
    void shutdownHostAndQuit({ reason: "window-close" });
  });

  if (rendererDevUrl) {
    await window.loadURL(rendererDevUrl);
    return window;
  }

  await window.loadFile(getRendererIndexPath(), { hash: ELECTRON_RENDERER_START_PATH });
  return window;
};

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

const resolveLocalAttachmentPathForPreview = async (filePath: string): Promise<string> => {
  const resolved = await hostCommandRouter.invoke("workspace_resolve_local_attachment_path", {
    path: filePath,
  });
  if (typeof resolved !== "object" || resolved === null || !("path" in resolved)) {
    throw new Error("Local attachment preview resolver returned an invalid response.");
  }

  return readLocalAttachmentPreviewPath(resolved.path);
};

const registerIpcHandlers = (): void => {
  ipcMain.handle(ELECTRON_HOST_INVOKE_CHANNEL, async (_event, request: ElectronHostInvokeRequest) =>
    hostCommandRouter.invoke(request.command, request.args),
  );

  ipcMain.handle(ELECTRON_OPEN_EXTERNAL_URL_CHANNEL, async (_event, url: string) => {
    await shell.openExternal(validateExternalUrl(url));
  });

  ipcMain.handle(ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL, async (_event, filePath: unknown) => {
    const resolvedPath = await resolveLocalAttachmentPathForPreview(
      readLocalAttachmentPreviewPath(filePath),
    );
    return createElectronLocalAttachmentPreviewUrl(resolvedPath);
  });
};

type HostShutdownOptions = {
  exitAfterShutdown?: boolean;
  reason: string;
};

const shutdownHostAndQuit = async ({
  exitAfterShutdown = false,
  reason,
}: HostShutdownOptions): Promise<void> => {
  if (hostShutdownStarted) {
    return;
  }

  hostShutdownStarted = true;
  let exitCode = 0;
  electronMainLogger.info(`OpenDucktor host shutdown started (${reason})`);
  try {
    await hostCommandRouter.dispose();
    electronMainLogger.info("OpenDucktor host shutdown complete");
  } catch (error) {
    exitCode = 1;
    electronMainLogger.error("OpenDucktor host shutdown failed", error);
  } finally {
    hostShutdownComplete = true;
    if (exitAfterShutdown) {
      process.exit(exitCode);
    } else {
      app.quit();
    }
  }
};

const shutdownHostForSignal = (signal: NodeJS.Signals): void => {
  void shutdownHostAndQuit({ exitAfterShutdown: true, reason: signal });
};

const hideWindowsForShutdown = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.hide();
  }
};

app
  .whenReady()
  .then(async () => {
    const rendererSession = session.fromPartition(ELECTRON_RENDERER_SESSION_PARTITION);
    configureElectronLoopbackCorsPolicy(
      rendererSession,
      resolveElectronLoopbackCorsOrigin(rendererDevUrl),
    );
    registerElectronLocalAttachmentPreviewProtocol({
      net,
      resolveLocalAttachmentPath: resolveLocalAttachmentPathForPreview,
      session: rendererSession,
    });
    installApplicationMenu({ isDevelopment, appName: app.name || APPLICATION_NAME });
    registerIpcHandlers();
    registerHostEventForwarding();
    configureElectronDockIcon();
    await hostCommandRouter.initialize();
    await createMainWindow(rendererSession);

    app.on("activate", () => {
      if (hostShutdownStarted) {
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow(rendererSession);
      }
    });
  })
  .catch((error: unknown) => {
    electronMainLogger.error("OpenDucktor Electron startup failed", error);
    hostShutdownStarted = true;
    void hostCommandRouter
      .dispose()
      .catch((disposeError: unknown) => {
        electronMainLogger.error(
          "OpenDucktor host cleanup after startup failure failed",
          disposeError,
        );
      })
      .finally(() => {
        hostShutdownComplete = true;
        process.exit(1);
      });
  });

app.on("window-all-closed", () => {
  void shutdownHostAndQuit({ reason: "window-all-closed" });
});

app.on("before-quit", (event) => {
  if (hostShutdownComplete) {
    return;
  }
  event.preventDefault();
  hideWindowsForShutdown();
  void shutdownHostAndQuit({ reason: "before-quit" });
});

process.once("SIGINT", shutdownHostForSignal);
process.once("SIGTERM", shutdownHostForSignal);
process.once("SIGHUP", shutdownHostForSignal);
