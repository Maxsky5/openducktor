import { BROWSER_BLANK_URL, type BrowserServerMessage } from "@openducktor/contracts";
import {
  answerOnce,
  BrowserEngineError,
  type BrowserEngineEvent,
  type BrowserEnginePort,
  type BrowserEngineTabSpec,
} from "@openducktor/host";
import { Effect } from "effect";
import { electronBrowserPartition } from "../../shared/electron-browser-partitions";
import { errorMessage } from "../../effect/electron-errors";
import {
  captureGuestScreenshot,
  capturePageImage,
  type ElectronPngDecoder,
} from "./electron-browser-capture";
import type { EngineTab } from "./electron-browser-engine-tab";
import { createElectronPermissionRequests } from "./electron-browser-permission-requests";
import { createElectronMainWindows } from "./electron-browser-windows";
import { createBrowserDownloads } from "./electron-browser-downloads";
import {
  type ElectronBrowserGuest,
  type ElectronPopupWindow,
  openGuestCdpSession,
  prepareBrowserGuest,
} from "./electron-browser-guest";
import {
  DEFAULT_VIEW_BOX,
  type ElectronBrowserViewPort,
  type ElectronViewBox,
} from "./electron-browser-view-port";
import { refusedBrowserPageScheme } from "./electron-browser-policy";
import {
  configureBrowserPartitionSession,
  createBrowserPermissionGrants,
  type ElectronBrowserPartitionSession,
  permissionOrigin,
} from "./electron-browser-session";

/** The quality of a page snapshot that shows under a host overlay. */
const PAGE_SNAPSHOT_JPEG_QUALITY = 80;

export type ElectronBrowserEngineInput = {
  platform: string;
  viewPort: ElectronBrowserViewPort;
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
  /** Prepares the workspace partition before the engine creates a page of the workspace. */
  prepareWorkspace(workspaceId: string): void;
  /** Places the page of a panel tab in its window, or takes it out of the window. */
  setSurface(
    senderId: number,
    tabId: string,
    input: { readonly visible: boolean; readonly bounds?: ElectronViewBox | undefined },
  ): Effect.Effect<void, BrowserEngineError>;
  /** Gives the keyboard focus to a page that the user asked for. */
  focusPage(senderId: number, tabId: string): Effect.Effect<void, BrowserEngineError>;
  /** A JPEG data URL of the page as it shows, for a snapshot under a host overlay. */
  capturePage(tabId: string): Effect.Effect<string, BrowserEngineError>;
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

const pageNotReady = (operation: string, tabId: string) =>
  new BrowserEngineError({
    code: "not_ready",
    operation,
    message: "The page of this tab is not ready yet. Try again in a moment.",
    tabId,
  });

/**
 * The Electron browser engine. Each panel tab is a `WebContentsView` that the engine creates and
 * places. A popup window tab keeps its page in the popup window. The host drives each page over
 * the page `webContents.debugger`.
 *
 * A view that no panel shows stays detached, and costs no frames. While a wake hold is open, the
 * engine keeps it drawing in the invisible keeper window instead. The engine never calls
 * `webContents.focus()` except for `focusPage`. A CDP input command thus reaches the page without
 * a focus change of any window.
 */
export const createElectronBrowserEngine = (
  input: ElectronBrowserEngineInput,
): ElectronBrowserEngine => {
  const tabs = new Map<string, EngineTab>();
  const tabByGuest = new Map<number, string>();
  const preparedWorkspaces = new Set<string>();
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

  const releaseBinding = (tab: EngineTab): void => {
    const binding = tab.binding;
    if (binding === null) {
      return;
    }
    tab.binding = null;
    tabByGuest.delete(binding.guest.id);
    binding.release();
    permissionRequests.end(tab, true);
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
      view: null,
      viewWindowId: null,
      viewBox: DEFAULT_VIEW_BOX,
      focusOnShow: false,
      wakeHolds: 0,
      permissionRequests: new Set(),
      allowUnloadOnce: false,
    };
    tabs.set(tabId, tab);
    return tab;
  };

  /** Shows a view in its window. Otherwise it draws in the keeper while held awake, or detaches. */
  const applyView = (tab: EngineTab): void => {
    const view = tab.view;
    // An agent action keeps its page unthrottled while it runs. A popup window has its page in
    // the binding, not in a view.
    const guest = view?.webContents ?? tab.binding?.guest ?? null;
    if (guest !== null && !guest.isDestroyed()) {
      guest.setBackgroundThrottling(tab.wakeHolds === 0);
    }
    if (view === null) {
      return;
    }
    if (tab.viewWindowId !== null) {
      if (input.viewPort.showInWindow(view, tab.viewWindowId, tab.viewBox)) {
        if (tab.focusOnShow) {
          tab.focusOnShow = false;
          view.webContents.focus();
        }
        return;
      }
      // The window closed while the renderer still listed its tabs.
      tab.viewWindowId = null;
    }
    // A detached view draws no frame, and a CDP screenshot waits for one. While a wake hold is
    // open, the keeper window keeps the page drawing. An idle page stays detached and costs no
    // frames, like a background tab.
    if (tab.wakeHolds > 0) {
      input.viewPort.keepInKeeper(view);
    } else {
      input.viewPort.detach(view);
    }
  };

  // A release ends only the hold that its acquire took, on the same tab. A hold on a tab that
  // does not exist yet, or a release after the tab closed, changes nothing.
  const holdWake = (tabId: string) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const tab = tabs.get(tabId);
        if (tab) {
          tab.wakeHolds += 1;
          applyView(tab);
        }
        return tab;
      }),
      (held) =>
        Effect.sync(() => {
          if (held !== undefined && tabs.get(tabId) === held && held.wakeHolds > 0) {
            held.wakeHolds -= 1;
            applyView(held);
          }
        }),
    );

  /** A screenshot waits for a frame, so the page draws while it runs, also when no panel shows it. */
  const whileAwake = <A, E>(tabId: string, effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.scoped(holdWake(tabId).pipe(Effect.andThen(effect)));

  /** Takes the pages out of a window that lost its renderer, so the window shows none. */
  const detachWindowViews = (webContentsId: number): void => {
    for (const tab of tabs.values()) {
      if (tab.viewWindowId === webContentsId) {
        tab.viewWindowId = null;
        tab.focusOnShow = false;
        applyView(tab);
      }
    }
  };

  /** Takes control of a page and reports the tab as attached. */
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
                if (tab.viewWindowId !== null) {
                  input.notifyRenderer(tab.viewWindowId, { type: "shortcut", shortcut });
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
                // The engine owns the view, so a destroyed page ends its tab.
                removeTab(tab);
                emit({ type: "tab_ended", tabId: tab.tabId });
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
      emit({ type: "tab_attached", tabId: tab.tabId });
      return true;
    });

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
    if (tabs.get(tab.tabId) !== tab) {
      return;
    }
    // A popup window keeps its page. A panel popup gets a view like any other panel tab.
    const page =
      window === null
        ? openPanelPage(tab, "electron.browser.popup_tab")
        : attachGuest(tab, window.webContents).pipe(Effect.asVoid);
    Effect.runFork(
      page.pipe(
        Effect.catch((cause) =>
          Effect.sync(() => {
            input.reportFailure("electron.browser.popup.attach", cause);
            // A popup window cannot attach again, for example after it closed during the attach,
            // so its tab ends here and frees its place in the tab limit.
            if (tabs.get(tab.tabId) === tab) {
              endPage(tab);
              emit({ type: "tab_ended", tabId: tab.tabId });
            } else if (window !== null && !window.isDestroyed()) {
              window.destroy();
            }
          }),
        ),
      ),
    );
  };

  /** Creates, attaches, and loads the view of a panel tab. */
  const openPanelPage = (
    tab: EngineTab,
    operation: string,
  ): Effect.Effect<void, BrowserEngineError> =>
    Effect.gen(function* () {
      prepareWorkspace(tab.workspaceId);
      const view = yield* Effect.try({
        try: () => input.viewPort.create(electronBrowserPartition(tab.workspaceId)),
        catch: (cause) =>
          new BrowserEngineError({
            code: "operation_failed",
            operation,
            message: `OpenDucktor could not create the page: ${errorMessage(cause)}`,
            tabId: tab.tabId,
          }),
      });
      tab.view = view;
      // A surface request can arrive before the view exists, from a popup tab that the renderer
      // learned about first. The request waits in the tab until the view is here.
      applyView(tab);
      // A new `WebContentsView` has no renderer until a navigation starts, and a CDP command that
      // needs the renderer waits for one. Load a blank page first: it starts the renderer and
      // leaves the notification script installed before the page of the tab loads.
      view.webContents.loadURL(BROWSER_BLANK_URL).catch(() => undefined);
      const attached = yield* attachGuest(tab, view.webContents);
      if (!attached) {
        yield* Effect.fail(
          new BrowserEngineError({
            code: "operation_failed",
            operation,
            message: "The page closed before OpenDucktor could open it.",
            tabId: tab.tabId,
          }),
        );
      }
      // Load errors show in the tab: the host reads them from its CDP session.
      view.webContents.loadURL(tab.url).catch(() => undefined);
    });

  /** The guest binding of a tab whose page runs. */
  const pageBinding = (tabId: string, operation: string) =>
    Effect.suspend(() => {
      const tab = tabs.get(tabId);
      if (!tab) return Effect.fail(tabNotFound(operation, tabId));
      const binding = tab.binding;
      if (binding === null || binding.guest.isDestroyed()) {
        return Effect.fail(pageNotReady(operation, tabId));
      }
      return Effect.succeed(binding);
    });

  const removeTab = (tab: EngineTab): ElectronBrowserGuest | null => {
    const guest = tab.binding?.guest ?? null;
    tabs.delete(tab.tabId);
    releaseBinding(tab);
    downloads.forgetTab(tab.tabId);
    if (tab.view !== null) {
      input.viewPort.close(tab.view);
    }
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

  const surfaceOf = (
    senderId: number,
    tabId: string,
    operation: string,
  ): Effect.Effect<EngineTab, BrowserEngineError> =>
    Effect.suspend(() => {
      if (!windows.has(senderId)) {
        return Effect.fail(
          new BrowserEngineError({
            code: "operation_failed",
            operation,
            message: "Only an OpenDucktor window can show browser tabs.",
            tabId,
          }),
        );
      }
      const tab = tabs.get(tabId);
      if (!tab) {
        return Effect.fail(tabNotFound(operation, tabId));
      }
      if (tab.surface !== "panel") {
        return Effect.fail(
          new BrowserEngineError({
            code: "operation_failed",
            operation,
            message: "A popup window tab shows in its own popup window.",
            tabId,
          }),
        );
      }
      return Effect.succeed(tab);
    });

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
        const tab = addTab(spec.tabId, spec.workspaceId, spec.url, null);
        return openPanelPage(tab, "electron.browser.create_tab").pipe(
          Effect.onError(() =>
            Effect.sync(() => {
              if (tabs.get(tab.tabId) === tab) {
                removeTab(tab);
              }
            }),
          ),
        );
      }),
    closeTab: (tabId) =>
      Effect.suspend(() => {
        const tab = tabs.get(tabId);
        if (!tab) return Effect.fail(tabNotFound("electron.browser.close_tab", tabId));
        endPage(tab);
        return Effect.void;
      }),
    setSurface: (senderId, tabId, surface) =>
      Effect.gen(function* () {
        const tab = yield* surfaceOf(senderId, tabId, "electron.browser.set_surface");
        if (!surface.visible) {
          tab.viewWindowId = null;
          tab.focusOnShow = false;
          applyView(tab);
          return;
        }
        const bounds = surface.bounds;
        if (bounds === undefined || bounds.width <= 0 || bounds.height <= 0) {
          return yield* new BrowserEngineError({
            code: "operation_failed",
            operation: "electron.browser.set_surface",
            message: "A shown page needs a box with a width and a height.",
            tabId,
          });
        }
        tab.viewBox = {
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        };
        tab.viewWindowId = senderId;
        applyView(tab);
      }),
    focusPage: (senderId, tabId) =>
      Effect.gen(function* () {
        const tab = yield* surfaceOf(senderId, tabId, "electron.browser.focus_page");
        if (tab.view === null) {
          return yield* new BrowserEngineError({
            code: "not_ready",
            operation: "electron.browser.focus_page",
            message: "This page does not show in the window yet.",
            tabId,
          });
        }
        if (tab.viewWindowId !== senderId) {
          // An overlay can hide the page when a dialog closes and asks for the focus again. Keep
          // the request until the page shows, so the dialog close does not lose the focus.
          tab.focusOnShow = true;
          return;
        }
        tab.view.webContents.focus();
      }),
    capturePage: (tabId) => {
      const operation = "electron.browser.capture_page";
      return pageBinding(tabId, operation).pipe(
        Effect.flatMap(({ connection }) =>
          whileAwake(
            tabId,
            Effect.tryPromise({
              try: () => capturePageImage(connection, PAGE_SNAPSHOT_JPEG_QUALITY),
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
        ),
      );
    },
    openSession: (tabId) =>
      Effect.gen(function* () {
        const operation = "electron.browser.open_session";
        const tab = tabs.get(tabId);
        if (!tab) {
          return yield* tabNotFound(operation, tabId);
        }
        const binding = tab.binding;
        if (binding === null) {
          return yield* pageNotReady(operation, tabId);
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
    holdWake,
    reloadPage: (tabId, ignoreCache) =>
      pageBinding(tabId, "electron.browser.reload_page").pipe(
        Effect.map(({ guest }) => {
          // A page reload of the top frame keeps the host CDP session.
          if (ignoreCache) guest.reloadIgnoringCache();
          else guest.reload();
        }),
      ),
    captureScreenshot: (tabId, params) => {
      const operation = "electron.browser.capture_screenshot";
      return pageBinding(tabId, operation).pipe(
        Effect.flatMap(({ connection }) =>
          whileAwake(
            tabId,
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
        input.viewPort.closeKeeper();
        listeners.clear();
      }),
    addMainWindow: windows.add,
    setMainWindowLoaded: (webContentsId, loaded) => {
      if (!loaded) detachWindowViews(webContentsId);
      windows.setLoaded(webContentsId, loaded);
    },
    removeMainWindow: (webContentsId) => {
      windows.remove(webContentsId);
      if (windows.size() === 0) {
        // The app quits when its last OpenDucktor window closes. A keeper window would keep
        // `window-all-closed` from firing, so the pages end and the keeper closes first. The tabs
        // stay saved, so the next start restores them like a normal service disposal does.
        for (const tab of Array.from(tabs.values())) {
          endPage(tab);
        }
        input.viewPort.closeKeeper();
        return;
      }
      detachWindowViews(webContentsId);
    },
    isMainWindow: windows.has,
    prepareWorkspace,
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
