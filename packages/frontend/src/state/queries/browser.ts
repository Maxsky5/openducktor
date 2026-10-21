import { queryOptions } from "@tanstack/react-query";
import { connectionHost } from "@openducktor/frontend-core/connection/client-connection";

export const browserQueryKeys = {
  devToolsUrl: (browserTabId: string) => ["browser", "devtools-url", browserTabId] as const,
  sitePermissions: (workspaceId: string, origin: string) =>
    ["browser", "site-permissions", workspaceId, origin] as const,
};

/**
 * The DevTools frontend URL of a tab. The URL holds the endpoint secret of this app start, so it
 * stays valid until the app quits.
 */
export const browserDevToolsUrlQueryOptions = (browserTabId: string) =>
  queryOptions({
    queryKey: browserQueryKeys.devToolsUrl(browserTabId),
    queryFn: ({ client }) =>
      connectionHost(client)
        .browserDevToolsOpen({ tabId: browserTabId })
        .then((result) => result.frontendUrl),
    staleTime: Infinity,
    gcTime: Infinity,
  });

/**
 * The saved site choices of an origin. They change when the user answers a permission prompt in
 * any client, so the site menu reads them each time it opens.
 */
export const browserSitePermissionsQueryOptions = (workspaceId: string, origin: string) =>
  queryOptions({
    queryKey: browserQueryKeys.sitePermissions(workspaceId, origin),
    queryFn: ({ client }) =>
      connectionHost(client).browserSitePermissionsRead({ workspaceId, origin }),
    staleTime: 0,
    gcTime: 0,
  });
