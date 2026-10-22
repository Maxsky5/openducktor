import type { BrowserPermissionKind } from "@openducktor/contracts";
import { type BrowserEngineEvent, createBrowserPermissionRequest } from "@openducktor/host";
import type { EngineTab, PendingPermissionRequest } from "./electron-browser-engine-tab";

/**
 * The permission requests of pages. Electron does not name the frame that asks, so the request of
 * a frame ends when any frame navigates or goes away, and the request of the main frame with a
 * main-frame navigation. An ended request gets a denial.
 */
export const createElectronPermissionRequests = (input: {
  tabs: ReadonlyMap<string, EngineTab>;
  emit(event: BrowserEngineEvent): void;
}) => ({
  ask: (tabId: string, origin: string, permission: BrowserPermissionKind, isMainFrame: boolean) =>
    new Promise<boolean>((resolve) => {
      const tab = input.tabs.get(tabId);
      const lifecycle = createBrowserPermissionRequest({
        onRespond: (granted) => {
          tab?.permissionRequests.delete(request);
          resolve(granted);
        },
        onEnd: () => {
          tab?.permissionRequests.delete(request);
          resolve(false);
        },
      });
      const request: PendingPermissionRequest = { isMainFrame, end: lifecycle.end };
      tab?.permissionRequests.add(request);
      input.emit({
        type: "permission_requested",
        tabId,
        origin,
        permission,
        respond: lifecycle.respond,
        onEnded: lifecycle.onEnded,
      });
    }),
  /** Ends the requests of the frames of a tab, and with `mainFrame` also of its main frame. */
  end(tab: EngineTab, mainFrame: boolean): void {
    for (const request of Array.from(tab.permissionRequests)) {
      if (mainFrame || !request.isMainFrame) request.end();
    }
  },
});
