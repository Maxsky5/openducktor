import type { BrowserServerMessage } from "@openducktor/contracts";
import {
  answerOnce,
  BrowserEngineError,
  type BrowserEngineEvent,
  type BrowserEnginePort,
  type BrowserEngineTabSpec,
} from "@openducktor/host";
import { Deferred, Effect } from "effect";
import { electronBrowserPartition } from "../../shared/electron-browser-partitions";
import { errorMessage } from "../../effect/electron-errors";
import { captureGuestScreenshot, type ElectronPngDecoder } from "./electron-browser-capture";
import type { EngineTab } from "./electron-browser-engine-tab";
import { createElectronPermissionRequests } from "./electron-browser-permission-requests";
import { createElectronBrowserWake } from "./electron-browser-wake";
import { createElectronMainWindows } from "./electron-browser-windows";
import { createBrowserDownloads } from "./electron-browser-downloads";
import {
  type ElectronBrowserGuest,
  type ElectronPopupWindow,
  openGuestCdpSession,
  prepareBrowserGuest,
} from "./electron-browser-guest";
import { refusedBrowserPageScheme } from "./electron-browser-policy";
import {
  configureBrowserPartitionSession,
  createBrowserPermissionGrants,
  type ElectronBrowserPartitionSession,
  permissionOrigin,
} from "./electron-browser-session";

export type ElectronBrowserEngineInput = {
  platform: string;
  findWebContents(webContentsId: number): ElectronBrowserGuest | null;
  partitionSession(partition: string): ElectronBrowserPartitionSession;
  downloadsDirectory(): string;
  fileExists(filePath: string): boolean;
  showItemInFolder(filePath: string): void;
  /** Sends a browser channel message to the browser clients of one OpenDucktor window. */
  notifyRenderer(hostWebContentsId: number, message: BrowserServerMessage): void;
  /** The DevTools frontend URL of a tab, or `null` while the DevTools endpoint is not running. */
  devToolsFrontendUrl(tabId: string): string | null;
  decodePng: ElectronPngDecoder;
  newId(): string;
  reportFailure(operation: string, cause: unknown): void;
};

export type ElectronCertificateError = {
  readonly webContentsId: number;
  readonly url: string;
  readonly error: string;
  readonly isMainFrame: boolean;
  readonly callback: (trusted: boolean) => void;
};

/** The engine part of the browser for one OpenDucktor window. */
export type ElectronBrowserEngine = BrowserEnginePort & {
  /** A new OpenDucktor window. Its loaded renderer makes the engine ready. */
  addMainWindow(webContentsId: number): void;
  setMainWindowLoaded(webContentsId: number, loaded: boolean): void;
  removeMainWindow(webContentsId: number): void;
  isMainWindow(webContentsId: number): boolean;
  /** Prepares the workspace partition before a browser `<webview>` attaches. */
  prepareWorkspace(workspaceId: string): void;
  /** Binds a mounted browser `<webview>` guest of an OpenDucktor window to its tab. */
  bindGuest(
    senderId: number,
    tabId: string,
    webContentsId: number,
  ): Effect.Effect<void, BrowserEngineError>;
  hasLiveTab(tabId: string): boolean;
  /** Handles the app `certificate-error` event. Returns true when the page belongs to a tab. */
  handleCertificateError(input: ElectronCertificateError): boolean;
};

const tabNotFound = (operation: string, tabId: string) =>
  new BrowserEngineError({
    code: "tab_not_found",
    operation,
    message: "The browser engine has no tab with this ID.",
    tabId,
  });

/**
 * The Electron `<webview>` engine. Each browser tab is a guest page of the OpenDucktor window, or
 * an OpenDucktor popup window. The host drives each page over the guest `webContents.debugger`.
 */
export const createElectronBrowserEngine = (
  input: ElectronBrowserEngineInput,
): ElectronBrowserEngine => {
  const tabs = new Map<string, EngineTab>();
  const tabByGuest = new Map<number, string>();
  const preparedWorkspaces = new Set<string>();
  const pendingBinds = new Map<number, Deferred.Deferred<void, BrowserEngineError>>();
  const listeners = new Set<(event: BrowserEngineEvent) => void>();
  const grants = createBrowserPermissionGrants();

  const emit = (event: BrowserEngineEvent): void => {
    for (const listener of Array.from(listeners)) {
      listener(event);
    }
  };

  const downloads = createBrowserDownloads({
    directory: input.downloadsDirectory,
    fileExists: input.fileExists,
    newId: input.newId,
    report: (tabId, download) => emit({ type: "download_updated", tabId, download }),
  });

  const windows = createElectronMainWindows((state) => emit({ type: "state_changed", state }));

  const permissionRequests = createElectronPermissionRequests({ tabs, emit });

  const prepareWorkspace = (workspaceId: string): void => {
    if (preparedWorkspaces.has(workspaceId)) {
      return;
    }
    preparedWorkspaces.add(workspaceId);
    configureBrowserPartitionSession({
      session: input.partitionSession(electronBrowserPartition(workspaceId)),
      workspaceId,
      grants,
      tabOf: (webContentsId) => tabByGuest.get(webContentsId) ?? null,
      askPermission: permissionRequests.ask,
      startDownload: downloads.start,
      onSchemeRefused: (tabId, scheme) => emit({ type: "scheme_refused", tabId, scheme }),
    });
  };

  const wake = createElectronBrowserWake({ tabs, notifyRenderer: input.notifyRenderer });

  const releaseBinding = (tab: EngineTab): void => {
    const binding = tab.binding;
    if (binding === null) {
      return;
    }
    tab.binding = null;
    tabByGuest.delete(binding.guest.id);
    binding.release();
    permissionRequests.end(tab, true);
    wake.release(tab, binding.host);
  };

  /** A tab without a popup window is a panel tab. */
  const addTab = (
    tabId: string,
    workspaceId: string,
    url: string,
    popupWindow: ElectronPopupWindow | null,
  ): EngineTab => {
    const tab: EngineTab = {
      tabId,
      workspaceId,
      surface: popupWindow === null ? "panel" : "popup_window",
      popupWindow,
      url,
      binding: null,
      wakeHolds: 0,
      permissionRequests: new Set(),
      allowUnloadOnce: false,
    };
    tabs.set(tabId, tab);
    return tab;
  };

  /** A popup in a popup window keeps `window.opener`. A panel popup has no opener link. */
  const openPopup = (opener: EngineTab, url: string, window: ElectronPopupWindow | null): void => {
    const tab = addTab(input.newId(), opener.workspaceId, url, window);
    emit({
      type: "popup_opened",
      openerTabId: opener.tabId,
      tabId: tab.tabId,
      url,
      surface: tab.surface,
      keepsOpener: window !== null,
    });
    if (window === null || tabs.get(tab.tabId) !== tab) {
      return;
    }
    Effect.runFork(
      attachGuest(tab, window.webContents).pipe(
        Effect.catch((cause) =>
          Effect.sync(() => {
            input.reportFailure("electron.browser.popup_window.attach", cause);
            // A popup window cannot attach again, for example after it closed during the attach,
            // so its tab ends here and frees its place in the tab limit.
            if (tabs.get(tab.tabId) === tab) {
              endPage(tab);
              emit({ type: "tab_ended", tabId: tab.tabId });
            } else if (!window.isDestroyed()) {
              window.destroy();
            }
          }),
        ),
      ),
    );
  };

  /** Takes control of a guest page and reports the tab as attached. */
  const attachGuest = (
    tab: EngineTab,
    guest: ElectronBrowserGuest,
  ): Effect.Effect<boolean, BrowserEngineError> =>
    Effect.gen(function* () {
      const binding = yield* Effect.tryPromise({
        try: () =>
          prepareBrowserGuest(
            guest,
            {
              forwardShortcuts: tab.surface === "panel",
              onSchemeRefused: (scheme) =>
                emit({ type: "scheme_refused", tabId: tab.tabId, scheme }),
              onShortcut: (shortcut) => {
                if (guest.hostWebContents !== null) {
                  input.notifyRenderer(guest.hostWebContents.id, { type: "shortcut", shortcut });
                }
              },
              consumeUnloadAllowance: () => {
                const allowed = tab.allowUnloadOnce;
                tab.allowUnloadOnce = false;
                return allowed;
              },
              onUnloadHeld: () => emit({ type: "navigation_held", tabId: tab.tabId, url: null }),
              onPanelPopup: (url) => openPopup(tab, url, null),
              onPopupWindow: (window, url) => openPopup(tab, url, window),
              onFrameDocumentEnded: (isMainFrame) => permissionRequests.end(tab, isMainFrame),
              onNavigated: (url) => {
                if (refusedBrowserPageScheme(url) === null) tab.url = url;
              },
              onNotification: ({ title, body }) => {
                const origin = permissionOrigin(guest.getURL());
                if (origin !== null && grants.isGranted(tab.workspaceId, origin, "notifications")) {
                  emit({ type: "page_notification", tabId: tab.tabId, origin, title, body });
                }
              },
              onDestroyed: () => {
                if (tabs.get(tab.tabId) !== tab) {
                  releaseBinding(tab);
                  return;
                }
                // A popup window cannot mount again, so its tab ends with its page.
                if (tab.surface === "popup_window") {
                  removeTab(tab);
                  emit({ type: "tab_ended", tabId: tab.tabId });
                  return;
                }
                releaseBinding(tab);
                emit({ type: "tab_detached", tabId: tab.tabId });
              },
            },
            input.platform,
          ),
        catch: (cause) =>
          new BrowserEngineError({
            code: "operation_failed",
            operation: "electron.browser.attach_guest",
            message: `OpenDucktor could not attach to the page: ${errorMessage(cause)}`,
            tabId: tab.tabId,
          }),
      });
      if (tabs.get(tab.tabId) !== tab) {
        binding.release();
        return false;
      }
      releaseBinding(tab);
      tab.binding = binding;
      tabByGuest.set(guest.id, tab.tabId);
      if (tab.wakeHolds > 0) {
        wake.apply(tab);
      }
      emit({ type: "tab_attached", tabId: tab.tabId });
      return true;
    });

  const bindNow = (senderId: number, tabId: string, webContentsId: number) =>
    Effect.gen(function* () {
      const operation = "electron.browser.bind_guest";
      const invalid = (message: string) =>
        new BrowserEngineError({ code: "operation_failed", operation, message, tabId });
      if (!windows.has(senderId)) {
        return yield* invalid("Only an OpenDucktor window can bind browser tabs.");
      }
      const tab = tabs.get(tabId);
      if (!tab) {
        return yield* tabNotFound(operation, tabId);
      }
      if (tab.surface !== "panel") {
        return yield* invalid("A popup window tab has no webview to bind.");
      }
      if (tab.binding?.guest.id === webContentsId) {
        return;
      }
      if (tabByGuest.has(webContentsId)) {
        return yield* invalid("This webview already shows another browser tab.");
      }
      const guest = input.findWebContents(webContentsId);
      if (guest === null || guest.isDestroyed() || guest.getType() !== "webview") {
        return yield* invalid("The webview of this tab does not exist.");
      }
      if (guest.hostWebContents?.id !== senderId) {
        return yield* invalid("The webview belongs to another window.");
      }
      if (guest.session !== input.partitionSession(electronBrowserPartition(tab.workspaceId))) {
        return yield* invalid("The webview does not use the browser partition of its workspace.");
      }
      prepareWorkspace(tab.workspaceId);
      if (tab.binding !== null) {
        // The renderer mounted a new webview for the tab, for example after a reload.
        releaseBinding(tab);
        emit({ type: "tab_detached", tabId });
      }
      const attached = yield* attachGuest(tab, guest);
      if (attached) {
        // Load errors show in the tab: the host reads them from its CDP session.
        guest.loadURL(tab.url).catch(() => undefined);
      }
    });

  /** The guest binding of a tab whose page runs. */
  const pageBinding = (tabId: string, operation: string) =>
    Effect.suspend(() => {
      const tab = tabs.get(tabId);
      if (!tab) return Effect.fail(tabNotFound(operation, tabId));
      const binding = tab.binding;
      if (binding === null || binding.guest.isDestroyed()) {
        return Effect.fail(
          new BrowserEngineError({
            code: "not_ready",
            operation,
            message: "The page of this tab is not ready yet. Try again in a moment.",
            tabId,
          }),
        );
      }
      return Effect.succeed(binding);
    });

  const removeTab = (tab: EngineTab): ElectronBrowserGuest | null => {
    const guest = tab.binding?.guest ?? null;
    tabs.delete(tab.tabId);
    releaseBinding(tab);
    downloads.forgetTab(tab.tabId);
    return guest;
  };

  const endPage = (tab: EngineTab): void => {
    const guest = removeTab(tab);
    if (tab.popupWindow !== null) {
      if (!tab.popupWindow.isDestroyed()) tab.popupWindow.destroy();
      return;
    }
    // `close()` without `waitForBeforeUnload` ends the page without `beforeunload`.
    if (guest !== null && !guest.isDestroyed()) guest.close();
  };

  return {
    kind: "electron_webview",
    installer: null,
    windows: {
      showPopupWindow: (tabId) =>
        Effect.suspend(() => {
          const operation = "electron.browser.show_popup_window";
          const tab = tabs.get(tabId);
          if (!tab) return Effect.fail(tabNotFound(operation, tabId));
          const window = tab.popupWindow;
          if (window === null || window.isDestroyed()) {
            return Effect.fail(
              new BrowserEngineError({
                code: "operation_failed",
                operation,
                message: "The popup window is closed.",
                tabId,
              }),
            );
          }
          window.show();
          window.focus();
          return Effect.void;
        }),
      revealDownload: (tabId, downloadId) =>
        Effect.suspend(() => {
          const filePath = downloads.path(tabId, downloadId);
          if (filePath === null) {
            return Effect.fail(
              new BrowserEngineError({
                code: "operation_failed",
                operation: "electron.browser.reveal_download",
                message: "This tab has no such download.",
                tabId,
              }),
            );
          }
          input.showItemInFolder(filePath);
          return Effect.void;
        }),
    },
    showsPagesToUser: true,
    devTools: {
      frontendUrl: (tabId) =>
        Effect.suspend(() => {
          const operation = "electron.browser.devtools_url";
          if (!tabs.has(tabId)) return Effect.fail(tabNotFound(operation, tabId));
          const url = input.devToolsFrontendUrl(tabId);
          return url === null
            ? Effect.fail(
                new BrowserEngineError({
                  code: "not_ready",
                  operation,
                  message: "The DevTools endpoint is not running.",
                  tabId,
                }),
              )
            : Effect.succeed(url);
        }),
    },
    state: windows.state,
    createTab: (spec: BrowserEngineTabSpec) =>
      Effect.suspend(() => {
        if (tabs.has(spec.tabId)) {
          return Effect.fail(
            new BrowserEngineError({
              code: "operation_failed",
              operation: "electron.browser.create_tab",
              message: "A browser tab with this ID already exists.",
              tabId: spec.tabId,
            }),
          );
        }
        addTab(spec.tabId, spec.workspaceId, spec.url, null);
        return Effect.void;
      }),
    closeTab: (tabId) =>
      Effect.suspend(() => {
        const tab = tabs.get(tabId);
        if (!tab) return Effect.fail(tabNotFound("electron.browser.close_tab", tabId));
        endPage(tab);
        return Effect.void;
      }),
    openSession: (tabId) =>
      Effect.gen(function* () {
        const operation = "electron.browser.open_session";
        const tab = tabs.get(tabId);
        if (!tab) {
          return yield* tabNotFound(operation, tabId);
        }
        const binding = tab.binding;
        if (binding === null) {
          return yield* new BrowserEngineError({
            code: "not_ready",
            operation,
            message: "The page of this tab is not attached yet.",
            tabId,
          });
        }
        return yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => openGuestCdpSession(binding),
            catch: (cause) =>
              new BrowserEngineError({
                code: "operation_failed",
                operation,
                message: `OpenDucktor could not open a CDP session on the page: ${errorMessage(cause)}`,
                tabId,
              }),
          }),
          (session) => Effect.promise(() => session.close()),
        );
      }),
    // A release ends only the hold that its acquire took, on the same tab. A hold on a tab that
    // does not exist yet, or a release after the tab closed, changes nothing.
    holdWake: (tabId) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const tab = tabs.get(tabId);
          if (tab) wake.change(tab, 1);
          return tab;
        }),
        (held) =>
          Effect.sync(() => {
            if (held !== undefined && tabs.get(tabId) === held) wake.change(held, -1);
          }),
      ),
    reloadPage: (tabId, ignoreCache) =>
      pageBinding(tabId, "electron.browser.reload_page").pipe(
        Effect.map(({ guest }) => {
          // CDP `Page.reload` of a `<webview>` guest reloads the window that holds it.
          if (ignoreCache) guest.reloadIgnoringCache();
          else guest.reload();
        }),
      ),
    captureScreenshot: (tabId, params) => {
      const operation = "electron.browser.capture_screenshot";
      return pageBinding(tabId, operation).pipe(
        Effect.flatMap(({ connection }) =>
          Effect.tryPromise({
            try: () => captureGuestScreenshot(connection, input.decodePng, params),
            catch: (cause) =>
              new BrowserEngineError({
                code: "operation_failed",
                operation,
                message: `OpenDucktor could not capture the page: ${errorMessage(cause)}`,
                tabId,
                cause,
              }),
          }),
        ),
      );
    },
    allowNextUnload: (tabId) =>
      Effect.suspend(() => {
        const tab = tabs.get(tabId);
        if (!tab) return Effect.fail(tabNotFound("electron.browser.allow_unload", tabId));
        tab.allowUnloadOnce = true;
        return Effect.void;
      }),
    revokeSitePermissions: (workspaceId, origin, permission) =>
      Effect.sync(() => grants.revoke(workspaceId, origin, permission)),
    deleteWorkspaceProfile: (workspaceId) =>
      Effect.tryPromise({
        try: async () => {
          const session = input.partitionSession(electronBrowserPartition(workspaceId));
          await session.clearData();
          await session.clearStorageData();
          await session.clearCache();
          grants.clearWorkspace(workspaceId);
        },
        catch: (cause) =>
          new BrowserEngineError({
            code: "operation_failed",
            operation: "electron.browser.delete_profile",
            message: `OpenDucktor could not delete the browser data of the workspace: ${errorMessage(cause)}`,
            cause,
          }),
      }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () =>
      Effect.sync(() => {
        for (const tab of Array.from(tabs.values())) {
          endPage(tab);
        }
        listeners.clear();
      }),
    addMainWindow: windows.add,
    setMainWindowLoaded: windows.setLoaded,
    removeMainWindow: windows.remove,
    isMainWindow: windows.has,
    prepareWorkspace,
    bindGuest: (senderId, tabId, webContentsId) =>
      Effect.gen(function* () {
        const running = pendingBinds.get(webContentsId);
        if (running) {
          return yield* Deferred.await(running);
        }
        const done = Deferred.makeUnsafe<void, BrowserEngineError>();
        pendingBinds.set(webContentsId, done);
        const exit = yield* Effect.exit(bindNow(senderId, tabId, webContentsId));
        pendingBinds.delete(webContentsId);
        yield* Deferred.done(done, exit);
        return yield* exit;
      }),
    hasLiveTab: (tabId) => (tabs.get(tabId)?.binding ?? null) !== null,
    handleCertificateError({ webContentsId, url, error, isMainFrame, callback }) {
      const tabId = tabByGuest.get(webContentsId);
      const tab = tabId === undefined ? undefined : tabs.get(tabId);
      if (!tab) {
        return false;
      }
      let host: string;
      try {
        host = new URL(url).hostname;
      } catch {
        callback(false);
        return true;
      }
      emit({
        type: "certificate_error",
        tabId: tab.tabId,
        url,
        host,
        error,
        mainFrame: isMainFrame,
        respond: answerOnce(callback),
      });
      return true;
    },
  };
};
