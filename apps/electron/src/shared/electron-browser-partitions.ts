const BROWSER_PARTITION_PREFIX = "persist:openducktor-browser-";

/** The `<webview>` partition of docked DevTools. It holds only DevTools settings. */
export const ELECTRON_DEVTOOLS_PARTITION = "persist:openducktor-devtools";

/** The session partition that holds the cookies, storage, and cache of one workspace. */
export const electronBrowserPartition = (workspaceId: string): string =>
  `${BROWSER_PARTITION_PREFIX}${workspaceId}`;
