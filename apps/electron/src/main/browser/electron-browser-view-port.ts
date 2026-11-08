import electron from "electron";
import type { ElectronBrowserGuest } from "./electron-browser-guest";
import { HARDENED_GUEST_PREFERENCES } from "./electron-browser-policy";

/** A box in device-independent pixels of a window content view. */
export type ElectronViewBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** A window that holds page views. A `BrowserWindow` and the keeper window are owners. */
export type ElectronViewOwner = {
  readonly contentView: {
    addChildView(view: electron.View): void;
    removeChildView(view: electron.View): void;
  };
  /** The width and the height of the content view. */
  getContentSize(): number[];
  isDestroyed(): boolean;
};

/** One page of a browser tab. The engine reads its `webContents` and the port places it. */
export type ElectronBrowserView = {
  readonly webContents: ElectronBrowserGuest;
};

/**
 * Places the pages of panel tabs. Each page is a `WebContentsView`, not a `<webview>` guest, so a
 * CDP input command never moves the keyboard focus of the window that shows the page.
 *
 * A view draws only while it is attached to a shown window and visible. A detached view produces
 * no compositor frames, so a CDP screenshot waits for a frame that never comes. While an agent or
 * a capture needs a page that no panel shows, the port keeps it visible in the keeper window: one
 * pixel, no opacity, no focus, no pointer. An idle page that no panel shows stays detached, so it
 * costs no frames, like a background tab of a browser.
 *
 * Each page view sits in a container view. A page that a host overlay covers keeps its window and
 * its size, while its container shrinks to the last pixel of the window, which the window corner
 * hides. The page stays visible to Chromium, so it keeps drawing and fires no visibility change,
 * and it shows again at once when the overlay closes.
 */
export type ElectronBrowserViewPort = {
  /** Remembers the window of an OpenDucktor renderer, so the engine can place views in it. */
  registerWindow(windowId: number, window: ElectronViewOwner): void;
  unregisterWindow(windowId: number): void;
  create(partition: string): ElectronBrowserView;
  /**
   * Shows the view in the window at the box, or returns false when the window is gone. A covered
   * view keeps the size of the box but shows no pixel the user can see.
   */
  showInWindow(
    view: ElectronBrowserView,
    windowId: number,
    box: ElectronViewBox,
    covered: boolean,
  ): boolean;
  /** Keeps the view visible in the keeper window, which no user sees or reaches. */
  keepInKeeper(view: ElectronBrowserView): void;
  /** Removes the view from its window, so its page stops drawing until it shows again. */
  detach(view: ElectronBrowserView): void;
  /** Removes the view from its window and ends its page. */
  close(view: ElectronBrowserView): void;
  /**
   * Closes the keeper window. The caller closes every page first, because a window that stays
   * open keeps the app from its `window-all-closed` quit.
   */
  closeKeeper(): void;
};

/** The size of a page that no panel showed yet, so its viewport is usable. */
export const DEFAULT_VIEW_BOX: ElectronViewBox = { x: 0, y: 0, width: 1280, height: 800 };

/** The keeper window is one pixel, so a user never sees it or reaches it with the pointer. */
const KEEPER_SIZE = 1;

/**
 * The options of the keeper window: no frame, no shadow, and never focusable. The keeper holds
 * pages that no panel shows, so it must never become the key window and take the keyboard focus
 * from the composer or the terminal. A non-focusable window still draws.
 */
export const keeperWindowOptions = (
  platform: NodeJS.Platform,
): electron.BaseWindowConstructorOptions => ({
  width: KEEPER_SIZE,
  height: KEEPER_SIZE,
  // Linux ignores window opacity, so keep its keeper outside every screen.
  x: platform === "linux" ? -KEEPER_SIZE : 0,
  y: platform === "linux" ? -KEEPER_SIZE : 0,
  show: false,
  frame: false,
  skipTaskbar: true,
  hasShadow: false,
  focusable: false,
});

type Placement = {
  readonly owner: ElectronViewOwner;
};

/** A page view and the container that clips it. */
type Frame = {
  readonly native: electron.WebContentsView;
  readonly container: electron.View;
};

/** The size of a box, at the origin of its container. */
const pageBounds = (box: ElectronViewBox): ElectronViewBox => ({
  x: 0,
  y: 0,
  width: box.width,
  height: box.height,
});

/** The last pixel of the window, which its rounded corner hides. */
const hiddenPixel = (owner: ElectronViewOwner): ElectronViewBox => {
  const [width = 1, height = 1] = owner.getContentSize();
  return { x: width - 1, y: height - 1, width: 1, height: 1 };
};

/**
 * The Electron view port. The keeper window is invisible, takes no focus, and ignores the
 * pointer. Chromium still counts it as visible, so the pages in it keep drawing at full speed.
 */
export const createElectronBrowserViewPort = (): ElectronBrowserViewPort => {
  const windows = new Map<number, ElectronViewOwner>();
  const placements = new Map<ElectronBrowserView, Placement>();
  let keeper: electron.BaseWindow | null = null;

  const keeperWindow = (): electron.BaseWindow => {
    if (keeper !== null && !keeper.isDestroyed()) {
      return keeper;
    }
    const linux = process.platform === "linux";
    const window = new electron.BaseWindow(keeperWindowOptions(process.platform));
    if (process.platform === "darwin") {
      window.setHiddenInMissionControl(true);
    }
    window.setIgnoreMouseEvents(true);
    window.showInactive();
    if (!linux) {
      window.setOpacity(0);
    }
    window.setAlwaysOnTop(true, "floating");
    keeper = window;
    return window;
  };

  const frames = new Map<ElectronBrowserView, Frame>();

  const frameOf = (view: ElectronBrowserView): Frame => {
    const frame = frames.get(view);
    if (frame === undefined) {
      throw new Error("The view port did not create this page view.");
    }
    return frame;
  };

  const unplace = (view: ElectronBrowserView): void => {
    const current = placements.get(view);
    if (current === undefined) {
      return;
    }
    // A closed window destroys its content view, but the page view outlives it.
    if (!current.owner.isDestroyed()) {
      current.owner.contentView.removeChildView(frameOf(view).container);
    }
    placements.delete(view);
  };

  const place = (view: ElectronBrowserView, owner: ElectronViewOwner): Frame => {
    const frame = frameOf(view);
    if (placements.get(view)?.owner === owner) {
      return frame;
    }
    unplace(view);
    owner.contentView.addChildView(frame.container);
    placements.set(view, { owner });
    return frame;
  };

  return {
    registerWindow(windowId, window) {
      windows.set(windowId, window);
    },
    unregisterWindow(windowId) {
      windows.delete(windowId);
    },
    create(partition) {
      const native = new electron.WebContentsView({
        webPreferences: {
          ...HARDENED_GUEST_PREFERENCES,
          partition,
          // A navigation or a CDP input command must never move the focus of the host window.
          focusOnNavigation: false,
        },
      });
      native.setBackgroundColor("#ffffff");
      native.setBounds(DEFAULT_VIEW_BOX);
      const container = new electron.View();
      container.addChildView(native);
      container.setBounds(DEFAULT_VIEW_BOX);
      frames.set(native, { native, container });
      return native;
    },
    showInWindow(view, windowId, box, covered) {
      const window = windows.get(windowId);
      if (window === undefined || window.isDestroyed()) {
        return false;
      }
      const { native, container } = place(view, window);
      native.setBounds(pageBounds(box));
      container.setBounds(covered ? hiddenPixel(window) : box);
      return true;
    },
    keepInKeeper(view) {
      const { native, container } = place(view, keeperWindow());
      container.setBounds(pageBounds(native.getBounds()));
    },
    detach: unplace,
    close(view) {
      unplace(view);
      frames.delete(view);
      if (!view.webContents.isDestroyed()) {
        view.webContents.close();
      }
    },
    closeKeeper() {
      const current = keeper;
      keeper = null;
      if (current !== null && !current.isDestroyed()) current.close();
    },
  };
};
