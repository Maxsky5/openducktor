import {
  type BrowserForwardedShortcutId,
  matchBrowserForwardedShortcut,
} from "@openducktor/contracts";
import { type CdpEvent, attachCdpTargetSession } from "@openducktor/host";
import { z } from "zod";
import { refusedBrowserPageScheme } from "./electron-browser-policy";
import type { ElectronBrowserPartitionSession } from "./electron-browser-session";
import {
  type ElectronCancelableEvent,
  type ElectronCdpDebugger,
  type ElectronDebuggerCdpConnection,
  createElectronDebuggerCdpConnection,
} from "./electron-debugger-cdp-connection";
import {
  installPageNotifications,
  type PageNotification,
  readPageNotification,
} from "./electron-browser-page-notifications";

/** The internal Electron event that shows JS dialogs of a page. CDP answers dialogs instead. */
const RUN_DIALOG_EVENT = "-run-dialog";
const CDP_PROTOCOL_VERSION = "1.3";

type NavigationDetails = ElectronCancelableEvent & {
  readonly url: string;
  readonly isMainFrame: boolean;
};

type GuestInput = {
  readonly type: string;
  readonly key: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
};

export type GuestWindowOpenDetails = { readonly url: string; readonly disposition: string };
export type GuestWindowOpenResponse =
  | { action: "deny" }
  | { action: "allow"; outlivesOpener: false };

/** An OpenDucktor popup window that Electron created for a `new-window` popup. */
export type ElectronPopupWindow = {
  readonly webContents: ElectronBrowserGuest;
  show(): void;
  focus(): void;
  destroy(): void;
  isDestroyed(): boolean;
};

type Listener<Args extends unknown[]> = (...args: Args) => void;

export type ElectronGuestHost = {
  readonly id: number;
  isDestroyed(): boolean;
  setBackgroundThrottling(allowed: boolean): void;
};

/** The Electron `WebContents` API of a guest page that the browser engine uses. */
export type ElectronBrowserGuest = {
  readonly id: number;
  readonly debugger: ElectronCdpDebugger;
  /** The OpenDucktor window page that holds a `<webview>` guest. */
  readonly hostWebContents: ElectronGuestHost | null;
  readonly session: ElectronBrowserPartitionSession;
  getType(): string;
  getURL(): string;
  isDestroyed(): boolean;
  loadURL(url: string): Promise<void>;
  reload(): void;
  reloadIgnoringCache(): void;
  close(): void;
  setBackgroundThrottling(allowed: boolean): void;
  setWindowOpenHandler(handler: (details: GuestWindowOpenDetails) => GuestWindowOpenResponse): void;
  listenerCount(eventName: typeof RUN_DIALOG_EVENT): number;
  removeAllListeners(eventName: typeof RUN_DIALOG_EVENT): void;
  on(event: "will-frame-navigate", listener: Listener<[NavigationDetails]>): void;
  on(event: "will-redirect", listener: Listener<[NavigationDetails]>): void;
  on(event: "before-input-event", listener: Listener<[ElectronCancelableEvent, GuestInput]>): void;
  on(event: "will-prevent-unload", listener: Listener<[ElectronCancelableEvent]>): void;
  on(event: "will-attach-webview", listener: Listener<[ElectronCancelableEvent]>): void;
  on(event: "did-navigate", listener: Listener<[ElectronCancelableEvent, string]>): void;
  on(
    event: "did-frame-navigate",
    listener: Listener<[ElectronCancelableEvent, string, number, string, boolean, number, number]>,
  ): void;
  on(
    event: "did-navigate-in-page",
    listener: Listener<[ElectronCancelableEvent, string, boolean]>,
  ): void;
  on(
    event: "did-create-window",
    listener: Listener<[ElectronPopupWindow, { readonly url: string }]>,
  ): void;
  once(event: "destroyed", listener: Listener<[]>): void;
};

export type BrowserGuestEvents = {
  /** True for panel guests. Popup windows keep their keys. */
  readonly forwardShortcuts: boolean;
  onSchemeRefused(scheme: string): void;
  onShortcut(shortcut: BrowserForwardedShortcutId): void;
  /** Returns true when the page may unload once, after a Leave answer. */
  consumeUnloadAllowance(): boolean;
  onUnloadHeld(): void;
  onPanelPopup(url: string): void;
  onPopupWindow(window: ElectronPopupWindow, url: string): void;
  onNavigated(url: string): void;
  /** A document of a frame ended: the frame committed a new document, or it went away. */
  onFrameDocumentEnded(isMainFrame: boolean): void;
  onNotification(notification: PageNotification): void;
  onDestroyed(): void;
};

export type BrowserGuestBinding = {
  readonly guest: ElectronBrowserGuest;
  /**
   * The window page that held the guest when it attached. Read it here: a destroyed guest throws
   * on `hostWebContents`, and a window reload destroys every guest in it.
   */
  readonly host: ElectronGuestHost | null;
  readonly connection: ElectronDebuggerCdpConnection;
  readonly targetId: string;
  /** Stops the handlers. The guest page keeps running. */
  release(): void;
};

/**
 * Removes the internal dialog listener, so JS dialogs reach CDP. Electron registers exactly one
 * such listener on each page. Another count means that Electron changed this internal API.
 */
const removeRunDialogListener = (guest: ElectronBrowserGuest): void => {
  const count = guest.listenerCount(RUN_DIALOG_EVENT);
  if (count !== 1) {
    throw new Error(
      `Electron changed its internal "${RUN_DIALOG_EVENT}" dialog listener: the page has ${count} listeners, and OpenDucktor expects exactly 1. Update the Electron browser engine for this Electron version.`,
    );
  }
  guest.removeAllListeners(RUN_DIALOG_EVENT);
};

/** Cmd+R on macOS or Ctrl+R elsewhere. Shift reloads without the cache. */
const isReloadKey = (input: GuestInput, platform: string): boolean => {
  const modifier =
    platform === "darwin" ? input.meta && !input.control : input.control && !input.meta;
  return modifier && !input.alt && input.key.toLowerCase() === "r";
};

const targetInfoSchema = z.object({ targetInfo: z.object({ targetId: z.string().min(1) }) });

/**
 * Takes control of a guest page: JS dialogs go to CDP, the debugger attaches, page notifications
 * go to the engine, and the guest handlers start. The caller loads the page after this.
 */
export const prepareBrowserGuest = async (
  guest: ElectronBrowserGuest,
  events: BrowserGuestEvents,
  platform: string,
): Promise<BrowserGuestBinding> => {
  removeRunDialogListener(guest);
  if (!guest.debugger.isAttached()) {
    guest.debugger.attach(CDP_PROTOCOL_VERSION);
  }
  const connection = createElectronDebuggerCdpConnection(guest.debugger);
  let active = true;
  const release = (): void => {
    active = false;
    connection.close("released");
  };

  try {
    const { targetInfo } = targetInfoSchema.parse(
      await connection.request("Target.getTargetInfo", undefined, ""),
    );
    connection.subscribe((event: CdpEvent) => {
      if (!active) return;
      // A removed frame ends its document without a navigation event.
      if (event.sessionId === "" && event.method === "Page.frameDetached") {
        events.onFrameDocumentEnded(false);
        return;
      }
      const notification = readPageNotification(event);
      if (notification !== null) {
        events.onNotification(notification);
      }
    });
    await installPageNotifications(connection);
    // A `<webview>` page without a background is transparent, so it would show the window behind
    // it and give screenshots without a background. A browser draws such a page on white.
    await connection.request(
      "Emulation.setDefaultBackgroundColorOverride",
      { color: { r: 255, g: 255, b: 255, a: 1 } },
      "",
    );
    if (guest.isDestroyed()) {
      throw new Error("The page closed before OpenDucktor could attach to it.");
    }

    const refuseScheme = (details: NavigationDetails): void => {
      if (!active || !details.isMainFrame) {
        return;
      }
      const scheme = refusedBrowserPageScheme(details.url);
      if (scheme !== null) {
        details.preventDefault();
        events.onSchemeRefused(scheme);
      }
    };
    guest.on("will-frame-navigate", refuseScheme);
    guest.on("will-redirect", refuseScheme);

    if (events.forwardShortcuts) {
      guest.on("before-input-event", (event, input) => {
        if (!active || input.type !== "keyDown") {
          return;
        }
        // The Reload menu items reload the OpenDucktor window, so a page with the keyboard focus
        // takes its reload keys itself, as in a browser.
        if (isReloadKey(input, platform)) {
          event.preventDefault();
          if (input.shift) guest.reloadIgnoringCache();
          else guest.reload();
          return;
        }
        const shortcut = matchBrowserForwardedShortcut(
          {
            key: input.key,
            ctrlKey: input.control,
            metaKey: input.meta,
            shiftKey: input.shift,
            altKey: input.alt,
          },
          platform,
        );
        if (shortcut !== null) {
          event.preventDefault();
          events.onShortcut(shortcut.id);
        }
      });
    }

    // Without `preventDefault()`, Electron keeps the page. The host then asks the user to leave.
    guest.on("will-prevent-unload", (event) => {
      if (!active) {
        return;
      }
      if (events.consumeUnloadAllowance()) {
        event.preventDefault();
        return;
      }
      events.onUnloadHeld();
    });

    guest.on("did-frame-navigate", (_event, _url, _code, _status, isMainFrame) => {
      if (active) events.onFrameDocumentEnded(isMainFrame);
    });
    guest.on("did-navigate", (_event, url) => {
      if (active) events.onNavigated(url);
    });
    guest.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (active && isMainFrame) events.onNavigated(url);
    });

    guest.setWindowOpenHandler((details) => {
      if (!active) {
        return { action: "deny" };
      }
      const scheme = refusedBrowserPageScheme(details.url);
      if (scheme !== null) {
        events.onSchemeRefused(scheme);
        return { action: "deny" };
      }
      // A popup with window features opens in a popup window, which keeps `window.opener`. No
      // window option override: an override of `sandbox` drops `window.opener`.
      if (details.disposition === "new-window") {
        return { action: "allow", outlivesOpener: false };
      }
      // Every other popup becomes a panel tab without an opener link.
      events.onPanelPopup(details.url);
      return { action: "deny" };
    });
    guest.on("did-create-window", (window, details) => {
      // A popup window has no browser layer, so its pages never attach a `<webview>`. The guard
      // changes no window option, because an option override drops `window.opener`.
      window.webContents.on("will-attach-webview", (event) => event.preventDefault());
      if (active) events.onPopupWindow(window, details.url);
    });

    guest.once("destroyed", () => {
      if (!active) {
        return;
      }
      release();
      events.onDestroyed();
    });

    return {
      guest,
      host: guest.hostWebContents,
      connection,
      targetId: targetInfo.targetId,
      release,
    };
  } catch (cause) {
    release();
    throw cause;
  }
};

/** Opens one flat CDP session on the page of a binding. */
export const openGuestCdpSession = (binding: BrowserGuestBinding) =>
  attachCdpTargetSession(binding.connection, { targetId: binding.targetId, parentSessionId: "" });
