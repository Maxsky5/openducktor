import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { BrowserService } from "@openducktor/host";
import { Effect } from "effect";
import electron, { type BrowserWindow, type IpcMain } from "electron";
import { ElectronOperationError } from "../../effect/electron-errors";
import type { ElectronBrowserPickFilesRequest } from "../../shared/electron-bridge-contract";
import { createElectronDevToolsEndpoint } from "./electron-browser-devtools-endpoint";
import { createElectronBrowserEngine } from "./electron-browser-engine";
import { fileDialogFilters } from "./electron-browser-file-dialog";
import {
  createElectronBrowserIpcController,
  type ElectronBrowserIpcController,
  registerElectronBrowserIpc,
} from "./electron-browser-ipc";
import { attachBrowserMainWindow } from "./electron-browser-main-window";

export type ElectronBrowserRuntimeInput = {
  reportFailure(operation: string, cause: unknown): void;
};

/**
 * The Electron browser feature: the `<webview>` engine, the webview hardening of each
 * OpenDucktor window, the browser IPC, and the DevTools endpoint.
 */
export const createElectronBrowserRuntime = ({ reportFailure }: ElectronBrowserRuntimeInput) => {
  const { app, BrowserWindow, dialog, nativeImage, session, shell, webContents } = electron;
  let ipcController: ElectronBrowserIpcController | null = null;

  const devTools = createElectronDevToolsEndpoint({
    hasLiveTab: (tabId) => engine.hasLiveTab(tabId),
    reportFailure,
  });
  const engine = createElectronBrowserEngine({
    platform: process.platform,
    findWebContents: (id) => webContents.fromId(id) ?? null,
    partitionSession: (partition) => session.fromPartition(partition),
    downloadsDirectory: () => app.getPath("downloads"),
    fileExists: existsSync,
    showItemInFolder: (filePath) => shell.showItemInFolder(filePath),
    notifyRenderer: (hostWebContentsId, message) =>
      ipcController?.sendToRenderer(hostWebContentsId, message),
    devToolsFrontendUrl: devTools.frontendUrl,
    decodePng: (png) => nativeImage.createFromBuffer(png),
    newId: randomUUID,
    reportFailure,
  });

  app.on(
    "certificate-error",
    (event, contents, url, error, _certificate, callback, isMainFrame) => {
      if (
        engine.handleCertificateError({
          webContentsId: contents.id,
          url,
          error,
          isMainFrame,
          callback,
        })
      ) {
        event.preventDefault();
      }
    },
  );

  const pickFiles = async (senderId: number, request: ElectronBrowserPickFilesRequest) => {
    const sender = webContents.fromId(senderId);
    const window = sender === undefined ? null : BrowserWindow.fromWebContents(sender);
    if (window === null) {
      throw new ElectronOperationError({
        operation: "electron.browser.pick_files",
        message: "The OpenDucktor window closed before the file dialog opened.",
      });
    }
    const result = await dialog.showOpenDialog(window, {
      properties: request.multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: fileDialogFilters(request.accept),
    });
    return result.canceled ? [] : result.filePaths;
  };

  return {
    engine,
    isMainWindow: (window: BrowserWindow): boolean => engine.isMainWindow(window.webContents.id),
    /** Adds an OpenDucktor window before it loads its renderer. */
    attachMainWindow: (window: BrowserWindow): void =>
      attachBrowserMainWindow(engine, window, reportFailure),
    /** Starts the DevTools endpoint and the browser IPC for the host browser service. */
    start: (ipcMain: Pick<IpcMain, "handle">, browserService: BrowserService) =>
      devTools.start(browserService).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            const controller = createElectronBrowserIpcController({
              browserService,
              reportDeliveryFailure: (senderId, cause) =>
                reportFailure(`electron.browser.deliver.${senderId}`, cause),
            });
            ipcController = controller;
            registerElectronBrowserIpc({
              ipcMain,
              controller,
              engine,
              pickFiles,
              reportLifecycleFailure: (senderId, cause) =>
                reportFailure(`electron.browser.cleanup.${senderId}`, cause),
            });
          }),
        ),
      ),
    stop: (): Effect.Effect<void> => devTools.stop(),
  };
};

export type ElectronBrowserRuntime = ReturnType<typeof createElectronBrowserRuntime>;
