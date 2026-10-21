import { WORKSPACE_ID_PATTERN } from "@openducktor/contracts";

const BROWSER_PARTITION_PREFIX = "persist:openducktor-browser-";

/** The `<webview>` partition of docked DevTools. It holds only DevTools settings. */
export const ELECTRON_DEVTOOLS_PARTITION = "persist:openducktor-devtools";

/** The `<webview>` partition that holds the cookies, storage, and cache of one workspace. */
export const electronBrowserPartition = (workspaceId: string): string =>
  `${BROWSER_PARTITION_PREFIX}${workspaceId}`;

/** The workspace of a browser partition, or `null` when the partition is not a browser partition. */
export const workspaceIdOfBrowserPartition = (partition: string): string | null => {
  if (!partition.startsWith(BROWSER_PARTITION_PREFIX)) {
    return null;
  }
  const workspaceId = partition.slice(BROWSER_PARTITION_PREFIX.length);
  return WORKSPACE_ID_PATTERN.test(workspaceId) ? workspaceId : null;
};
