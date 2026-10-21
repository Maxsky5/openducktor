import type { BrowserTabSurface } from "@openducktor/contracts";
import type { BrowserGuestBinding, ElectronPopupWindow } from "./electron-browser-guest";

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
  wakeHolds: number;
  allowUnloadOnce: boolean;
  readonly permissionRequests: Set<PendingPermissionRequest>;
};
