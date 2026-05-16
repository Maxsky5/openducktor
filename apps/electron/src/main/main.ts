import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHostEventBus, HOST_EVENT_CHANNELS } from "@openducktor/host";
import type { BrowserWindow as ElectronBrowserWindow } from "electron";
import electron from "electron";
import {
  ELECTRON_HOST_EVENT_CHANNEL,
  ELECTRON_HOST_INVOKE_CHANNEL,
  ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL,
  ELECTRON_OPEN_EXTERNAL_URL_CHANNEL,
  type ElectronHostEventEnvelope,
  type ElectronHostInvokeRequest,
} from "../shared/electron-bridge-contract";
import { createElectronHostCommandRouter } from "./electron-host";
import {
  configureElectronLoopbackCorsPolicy,
  resolveElectronLoopbackCorsOrigin,
} from "./electron-loopback-cors-policy";
import { electronMainLogger } from "./electron-main-logger";
import { configureElectronProcessEnvironment } from "./electron-process-environment";
import { disableElectronKeychainStorage } from "./electron-storage-policy";
import { installApplicationMenu, registerWindowContextMenu } from "./main-menu";

const { app, BrowserWindow, ipcMain, session, shell } = electron;
const APPLICATION_NAME = "OpenDucktor";
const ELECTRON_RENDERER_START_PATH = "/kanban";
const rendererDevUrl = process.env.VITE_DEV_SERVER_URL;
const isDevelopment = Boolean(rendererDevUrl);
const distDirectory = path.dirname(fileURLToPath(import.meta.url));

disableElectronKeychainStorage(app.commandLine);
configureElectronProcessEnvironment({
  env: process.env,
  platform: process.platform,
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
});

const hostEventBus = createHostEventBus();
const hostCommandRouter = createElectronHostCommandRouter({
  clientVersion: app.getVersion(),
  eventBus: hostEventBus,
  lifecycleLogger: electronMainLogger,
});
let hostShutdownStarted = false;
let hostShutdownComplete = false;

app.setName(APPLICATION_NAME);

const getPreloadPath = (): string => path.join(distDirectory, "preload.cjs");

const getRendererIndexPath = (): string => path.join(distDirectory, "renderer", "index.html");

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

const createMainWindow = async (): Promise<ElectronBrowserWindow> => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    title: "OpenDucktor",
    webPreferences: {
      contextIsolation: true,
      devTools: isDevelopment,
      nodeIntegration: false,
      preload: getPreloadPath(),
      sandbox: true,
    },
  });
  registerWindowContextMenu(window, { isDevelopment });
  window.on("close", (event) => {
    if (hostShutdownComplete) {
      return;
    }
    event.preventDefault();
    void shutdownHostAndQuit({ reason: "window-close" });
    window.destroy();
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

const registerIpcHandlers = (): void => {
  ipcMain.handle(ELECTRON_HOST_INVOKE_CHANNEL, async (_event, request: ElectronHostInvokeRequest) =>
    hostCommandRouter.invoke(request.command, request.args),
  );

  ipcMain.handle(ELECTRON_OPEN_EXTERNAL_URL_CHANNEL, async (_event, url: string) => {
    await shell.openExternal(validateExternalUrl(url));
  });

  ipcMain.handle(ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL, (_event, filePath: string) => {
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new Error("Local attachment preview path must be a non-empty string.");
    }

    return pathToFileURL(filePath).href;
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
    configureElectronLoopbackCorsPolicy(
      session.defaultSession,
      resolveElectronLoopbackCorsOrigin(rendererDevUrl),
    );
    installApplicationMenu({ isDevelopment, appName: app.name || APPLICATION_NAME });
    registerIpcHandlers();
    registerHostEventForwarding();
    await hostCommandRouter.initialize();
    await createMainWindow();

    app.on("activate", () => {
      if (hostShutdownStarted) {
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow();
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
