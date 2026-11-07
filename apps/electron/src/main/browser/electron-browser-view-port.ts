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

/** The content view parent of a `WebContentsView`. A `BrowserWindow` and the keeper window have one. */
export type ElectronViewOwner = {
  readonly contentView: {
    addChildView(view: electron.WebContentsView): void;
    removeChildView(view: electron.WebContentsView): void;
  };
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
 * A view draws only while it is in a shown window. The port keeps the views that no panel shows in
 * an invisible keeper window: a hidden or detached view falls to about two frames per second, and
 * an agent action or a screenshot must not wait for that.
 */
export type ElectronBrowserViewPort = {
  /** Remembers the window of an OpenDucktor renderer, so the engine can place views in it. */
  registerWindow(windowId: number, window: ElectronViewOwner): void;
  unregisterWindow(windowId: number): void;
  create(partition: string): ElectronBrowserView;
  /** Shows the view in the window at the box, or returns false when the window is gone. */
  showInWindow(view: ElectronBrowserView, windowId: number, box: ElectronViewBox): boolean;
  /** Keeps the view in the keeper window. A hidden view draws no frame. */
  showInKeeper(view: ElectronBrowserView, visible: boolean): void;
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

type Placement = {
  readonly owner: ElectronViewOwner;
  readonly native: electron.WebContentsView;
};

/**
 * The Electron view port. The keeper window shows no frame, takes no focus, and ignores the
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
    const window = new electron.BaseWindow({
      width: KEEPER_SIZE,
      height: KEEPER_SIZE,
      x: 0,
      y: 0,
      show: false,
      frame: false,
      skipTaskbar: true,
      hasShadow: false,
      // A non-focusable window lost the host focus in a probe. The keeper never calls `focus()`,
      // so a focusable keeper still gives the focus to no one.
      focusable: true,
    });
    window.setHiddenInMissionControl(true);
    window.setIgnoreMouseEvents(true);
    window.showInactive();
    window.setOpacity(0);
    window.setAlwaysOnTop(true, "floating");
    keeper = window;
    return window;
  };

  const place = (view: ElectronBrowserView, owner: ElectronViewOwner): electron.WebContentsView => {
    const current = placements.get(view);
    if (current?.owner === owner) {
      return current.native;
    }
    if (current !== undefined) {
      // A closed window destroys its content view, but the page view outlives it.
      if (!current.owner.isDestroyed()) {
        current.owner.contentView.removeChildView(current.native);
      }
      placements.delete(view);
    }
    // SAFETY: this port creates each `ElectronBrowserView` as a `WebContentsView`.
    const native = view as electron.WebContentsView;
    owner.contentView.addChildView(native);
    placements.set(view, { owner, native });
    return native;
  };

  return {
    registerWindow(windowId, window) {
      windows.set(windowId, window);
    },
    unregisterWindow(windowId) {
      windows.delete(windowId);
    },
    create(partition) {
      const view = new electron.WebContentsView({
        webPreferences: {
          ...HARDENED_GUEST_PREFERENCES,
          partition,
          // A navigation or a CDP input command must never move the focus of the host window.
          focusOnNavigation: false,
        },
      });
      view.setBackgroundColor("#ffffff");
      view.setBounds(DEFAULT_VIEW_BOX);
      view.setVisible(false);
      return view;
    },
    showInWindow(view, windowId, box) {
      const window = windows.get(windowId);
      if (window === undefined || window.isDestroyed()) {
        return false;
      }
      const native = place(view, window);
      native.setBounds(box);
      native.setVisible(true);
      return true;
    },
    showInKeeper(view, visible) {
      const native = place(view, keeperWindow());
      native.setVisible(visible);
    },
    close(view) {
      const current = placements.get(view);
      if (current !== undefined) {
        if (!current.owner.isDestroyed()) {
          current.owner.contentView.removeChildView(current.native);
        }
        placements.delete(view);
      }
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
