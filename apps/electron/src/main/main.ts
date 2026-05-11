import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInMemoryHostEventBus, HOST_EVENT_CHANNELS } from "@openducktor/host";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import {
  ELECTRON_HOST_EVENT_CHANNEL,
  ELECTRON_HOST_INVOKE_CHANNEL,
  ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL,
  ELECTRON_OPEN_EXTERNAL_URL_CHANNEL,
  type ElectronHostEventEnvelope,
  type ElectronHostInvokeRequest,
} from "../shared/electron-bridge-contract";
import { createElectronHostCommandRouter } from "./electron-host";
import { installApplicationMenu, registerWindowContextMenu } from "./main-menu";

const rendererDevUrl = process.env.VITE_DEV_SERVER_URL;
const isDevelopment = Boolean(rendererDevUrl);
const hostEventBus = createInMemoryHostEventBus();
const hostCommandRouter = createElectronHostCommandRouter({ eventBus: hostEventBus });
const distDirectory = path.dirname(fileURLToPath(import.meta.url));

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

const createMainWindow = async (): Promise<BrowserWindow> => {
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

  if (rendererDevUrl) {
    await window.loadURL(rendererDevUrl);
    return window;
  }

  await window.loadFile(getRendererIndexPath());
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

app.whenReady().then(async () => {
  installApplicationMenu({ isDevelopment, appName: app.name || "OpenDucktor" });
  registerIpcHandlers();
  registerHostEventForwarding();
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (isDevelopment || process.platform !== "darwin") {
    app.quit();
  }
});
