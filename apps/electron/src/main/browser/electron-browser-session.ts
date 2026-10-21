import { BROWSER_PERMISSION_KINDS, type BrowserPermissionKind } from "@openducktor/contracts";
import type { ElectronDownloadItem } from "./electron-browser-downloads";
import type { ElectronCancelableEvent } from "./electron-debugger-cdp-connection";

type MediaType = "video" | "audio";

export type ElectronPermissionDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny" }
  | { readonly kind: "ask"; readonly permissions: readonly BrowserPermissionKind[] };

const DENY: ElectronPermissionDecision = { kind: "deny" };
const ALLOW: ElectronPermissionDecision = { kind: "allow" };

const MEDIA_PERMISSIONS = {
  video: "camera",
  audio: "microphone",
} as const satisfies Record<MediaType, BrowserPermissionKind>;

/**
 * Maps an Electron permission to the site permissions that the user answers. Camera, microphone,
 * location, notifications, and clipboard read ask the user. Clipboard write is allowed, as in
 * Chrome, so copy buttons work. Every other permission is denied with no prompt.
 */
const classifyElectronPermission = (
  permission: string,
  mediaTypes: readonly MediaType[],
): ElectronPermissionDecision => {
  switch (permission) {
    case "media":
      return mediaTypes.length === 0
        ? DENY
        : { kind: "ask", permissions: mediaTypes.map((type) => MEDIA_PERMISSIONS[type]) };
    case "geolocation":
      return { kind: "ask", permissions: ["geolocation"] };
    case "notifications":
      return { kind: "ask", permissions: ["notifications"] };
    case "clipboard-read":
      return { kind: "ask", permissions: ["clipboard_read"] };
    case "clipboard-sanitized-write":
      return ALLOW;
    default:
      return DENY;
  }
};

/** The origin of a page URL, or `null` for an opaque origin or a value that is not a URL. */
export const permissionOrigin = (url: string | undefined): string | null => {
  if (url === undefined) {
    return null;
  }
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
};

/**
 * Site permissions that the user or a saved choice granted while this app runs. Electron asks the
 * check handler synchronously, so the engine answers checks from this record.
 */
export const createBrowserPermissionGrants = () => {
  const grantsByWorkspace = new Map<string, Set<string>>();
  const key = (origin: string, permission: BrowserPermissionKind) => `${origin} ${permission}`;
  return {
    record(
      workspaceId: string,
      origin: string,
      permission: BrowserPermissionKind,
      granted: boolean,
    ): void {
      let grants = grantsByWorkspace.get(workspaceId);
      if (!grants) {
        grants = new Set();
        grantsByWorkspace.set(workspaceId, grants);
      }
      if (granted) {
        grants.add(key(origin, permission));
      } else {
        grants.delete(key(origin, permission));
      }
    },
    isGranted: (workspaceId: string, origin: string, permission: BrowserPermissionKind): boolean =>
      grantsByWorkspace.get(workspaceId)?.has(key(origin, permission)) ?? false,
    /** Ends the grants of a site, so its next request asks again. `null` covers every kind. */
    revoke(workspaceId: string, origin: string, permission: BrowserPermissionKind | null): void {
      const grants = grantsByWorkspace.get(workspaceId);
      if (!grants) return;
      for (const kind of permission === null ? BROWSER_PERMISSION_KINDS : [permission]) {
        grants.delete(key(origin, kind));
      }
    },
    clearWorkspace: (workspaceId: string): void => {
      grantsByWorkspace.delete(workspaceId);
    },
  };
};

export type BrowserPermissionGrants = ReturnType<typeof createBrowserPermissionGrants>;

type PermissionWebContents = { readonly id: number };

type PermissionRequestHandler = (
  webContents: PermissionWebContents,
  permission: string,
  callback: (granted: boolean) => void,
  details: {
    readonly requestingUrl: string;
    /** True when the main frame of the page asks, false for another frame. */
    readonly isMainFrame: boolean;
    readonly mediaTypes?: readonly MediaType[];
    /** Set for `openExternal`: the URL of a scheme that the OS would open. */
    readonly externalURL?: string;
  },
) => void;

type PermissionCheckHandler = (
  webContents: PermissionWebContents | null,
  permission: string,
  requestingOrigin: string,
  details: { readonly requestingUrl?: string; readonly mediaType?: MediaType | "unknown" },
) => boolean;

type WillDownloadListener = (
  event: ElectronCancelableEvent,
  item: ElectronDownloadItem,
  webContents: PermissionWebContents,
) => void;

/** The Electron `Session` API of a workspace browser partition that the engine uses. */
export type ElectronBrowserPartitionSession = {
  setPermissionRequestHandler(handler: PermissionRequestHandler): void;
  setPermissionCheckHandler(handler: PermissionCheckHandler): void;
  setDevicePermissionHandler(handler: () => boolean): void;
  on(event: "will-download", listener: WillDownloadListener): void;
  clearData(): Promise<void>;
  clearStorageData(): Promise<void>;
  clearCache(): Promise<void>;
};

export type BrowserPartitionSessionInput = {
  session: ElectronBrowserPartitionSession;
  workspaceId: string;
  grants: BrowserPermissionGrants;
  /** The tab of a guest page, or `null` when the page is not a bound tab. */
  tabOf(webContentsId: number): string | null;
  /**
   * Asks the host. The promise settles when the user or a saved choice answers. `isMainFrame`
   * tells whether the main frame of the page asks, or another frame.
   */
  askPermission(
    tabId: string,
    origin: string,
    permission: BrowserPermissionKind,
    isMainFrame: boolean,
  ): Promise<boolean>;
  startDownload(tabId: string, item: ElectronDownloadItem): void;
  /** A page asked the OS to open a URL of another scheme. The tab refuses it. */
  onSchemeRefused(tabId: string, scheme: string): void;
};

/**
 * Installs the permission and download handlers of one workspace partition. The partition gets no
 * web request rewrite and no custom protocol: those belong only to the OpenDucktor app partition.
 */
export const configureBrowserPartitionSession = (input: BrowserPartitionSessionInput): void => {
  const { session, workspaceId, grants } = input;

  const askEach = async (
    tabId: string,
    origin: string,
    permissions: readonly BrowserPermissionKind[],
    isMainFrame: boolean,
  ): Promise<boolean> => {
    for (const permission of permissions) {
      const granted = await input.askPermission(tabId, origin, permission, isMainFrame);
      grants.record(workspaceId, origin, permission, granted);
      if (!granted) {
        return false;
      }
    }
    return true;
  };

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    // Chromium hands unknown schemes such as `vscode:` to the OS only with this permission.
    if (permission === "openExternal") {
      callback(false);
      const tabId = input.tabOf(webContents.id);
      const scheme = details.externalURL?.split(":", 1)[0];
      if (tabId !== null && scheme) input.onSchemeRefused(tabId, scheme);
      return;
    }
    const decision = classifyElectronPermission(permission, details.mediaTypes ?? []);
    if (decision.kind !== "ask") {
      callback(decision.kind === "allow");
      return;
    }
    const tabId = input.tabOf(webContents.id);
    const origin = permissionOrigin(details.requestingUrl);
    if (tabId === null || origin === null) {
      callback(false);
      return;
    }
    void askEach(tabId, origin, decision.permissions, details.isMainFrame).then(callback);
  });

  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    // The page notification script owns `Notification.permission`. A denied check also keeps
    // service worker notifications out of the OS notification center.
    if (permission === "notifications") {
      return false;
    }
    const mediaTypes =
      details.mediaType === undefined || details.mediaType === "unknown" ? [] : [details.mediaType];
    const decision = classifyElectronPermission(permission, mediaTypes);
    if (decision.kind !== "ask") {
      return decision.kind === "allow";
    }
    const origin = permissionOrigin(requestingOrigin) ?? permissionOrigin(details.requestingUrl);
    return (
      origin !== null &&
      decision.permissions.every((kind) => grants.isGranted(workspaceId, origin, kind))
    );
  });

  // USB, serial, and HID devices are never available to browser tabs.
  session.setDevicePermissionHandler(() => false);

  session.on("will-download", (event, item, webContents) => {
    const tabId = input.tabOf(webContents.id);
    if (tabId === null) {
      event.preventDefault();
      return;
    }
    input.startDownload(tabId, item);
  });
};
