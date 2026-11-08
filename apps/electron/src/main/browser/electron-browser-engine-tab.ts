import type { BrowserTabSurface } from "@openducktor/contracts";
import type { BrowserGuestBinding, ElectronPopupWindow } from "./electron-browser-guest";
import type { ElectronBrowserView, ElectronViewBox } from "./electron-browser-view-port";

/** A permission request that waits for the host. It ends with the document that asked. */
export type PendingPermissionRequest = { readonly isMainFrame: boolean; end(): void };

/** The engine state of one browser tab. */
export type EngineTab = {
  readonly tabId: string;
  readonly workspaceId: string;
  readonly surface: BrowserTabSurface;
  readonly popupWindow: ElectronPopupWindow | null;
  /** The page URL. A renderer reload loads the tab again at this URL. */
  url: string;
  binding: BrowserGuestBinding | null;
  /** The view of a panel tab. A popup window tab has its page in `popupWindow`. */
  view: ElectronBrowserView | null;
  /** The window that shows the view now, or null while no panel shows it. */
  viewWindowId: number | null;
  /** The last box of a shown view, so a view that returns keeps its size. */
  viewBox: ElectronViewBox;
  /** A host overlay covers the shown view, so the user sees its snapshot in its place. */
  viewCovered: boolean;
  /** A user focus request that waits for the page to show again. */
  focusOnShow: boolean;
  wakeHolds: number;
  allowUnloadOnce: boolean;
  readonly permissionRequests: Set<PendingPermissionRequest>;
};
