import type { BrowserPermissionKind } from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { browserQueryKeys, browserSitePermissionsQueryOptions } from "@/state/queries/browser";
import { BrowserSiteMenu } from "./components/browser-site-menu";

/** The site menu of a browser tab. The toolbar mounts it only while the menu is open. */
export function BrowserSiteMenuContainer({
  workspaceId,
  url,
}: {
  workspaceId: string;
  url: string;
}): ReactElement {
  const origin = browserPageOrigin(url);
  if (origin === null) {
    return (
      <BrowserSiteMenu
        origin={null}
        permissions={null}
        loading={false}
        error={null}
        onReset={() => {}}
      />
    );
  }
  return <SitePermissionsMenu workspaceId={workspaceId} origin={origin} />;
}

function SitePermissionsMenu({
  workspaceId,
  origin,
}: {
  workspaceId: string;
  origin: string;
}): ReactElement {
  const queryClient = useQueryClient();
  const hostClient = useHostClient();
  const query = useQuery(browserSitePermissionsQueryOptions(workspaceId, origin));
  const reset = useMutation({
    mutationFn: (permission: BrowserPermissionKind | null) =>
      hostClient.browserSitePermissionsReset({ workspaceId, origin, permission }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: browserQueryKeys.sitePermissions(workspaceId, origin),
      }),
    onError: (cause) => {
      toast.error("Could not reset the site choice", { description: errorMessage(cause) });
    },
  });
  return (
    <BrowserSiteMenu
      origin={origin}
      permissions={query.data?.permissions ?? null}
      loading={query.isPending}
      error={query.error ? errorMessage(query.error) : null}
      onReset={(permission) => reset.mutate(permission)}
    />
  );
}

/** The origin of an http or https page, or null for a blank page. */
const browserPageOrigin = (url: string): string | null => {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  return new URL(url).origin;
};
