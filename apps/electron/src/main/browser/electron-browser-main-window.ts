import type { ElectronBrowserEngine } from "./electron-browser-engine";
import {
  decideWebviewAttach,
  hardenWebviewPreferences,
  type WebviewPreferences,
} from "./electron-browser-policy";
import type { ElectronCancelableEvent } from "./electron-debugger-cdp-connection";

/** The Electron `BrowserWindow` API of an OpenDucktor window that the browser feature uses. */
export type ElectronBrowserMainWindow = {
  readonly webContents: {
    readonly id: number;
    on(
      event: "will-attach-webview",
      listener: (
        event: ElectronCancelableEvent,
        webPreferences: WebviewPreferences,
        params: { readonly src?: string; readonly partition?: string },
      ) => void,
    ): void;
    on(event: "did-navigate", listener: () => void): void;
    on(event: "render-process-gone", listener: () => void): void;
  };
  once(event: "closed", listener: () => void): void;
};

/**
 * Adds an OpenDucktor window to the browser engine before it loads its renderer. Each `<webview>`
 * attach loses its preload and gets the sandbox. Only a browser tab in the partition of its
 * workspace and the bundled DevTools frontend may attach. The window can show tabs once its
 * renderer connects the browser channel, and it stops at each new document and renderer loss.
 */
export const attachBrowserMainWindow = (
  engine: Pick<
    ElectronBrowserEngine,
    "addMainWindow" | "setMainWindowLoaded" | "removeMainWindow" | "prepareWorkspace"
  >,
  window: ElectronBrowserMainWindow,
  reportFailure: (operation: string, cause: Error) => void,
): void => {
  const contents = window.webContents;
  const id = contents.id;
  engine.addMainWindow(id);
  contents.on("will-attach-webview", (event, webPreferences, params) => {
    hardenWebviewPreferences(webPreferences);
    const decision = decideWebviewAttach({
      src: params.src ?? "",
      partition: params.partition ?? "",
    });
    if (!decision.allow) {
      event.preventDefault();
      reportFailure("electron.browser.webview_attach", new Error(decision.reason));
      return;
    }
    if (decision.kind === "browser") {
      engine.prepareWorkspace(decision.workspaceId);
    }
  });
  contents.on("did-navigate", () => engine.setMainWindowLoaded(id, false));
  contents.on("render-process-gone", () => engine.setMainWindowLoaded(id, false));
  window.once("closed", () => engine.removeMainWindow(id));
};
