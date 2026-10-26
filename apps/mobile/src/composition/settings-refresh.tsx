import { workspaceQueryKeys } from "@openducktor/frontend-core/queries/workspace";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useActiveSession } from "@/host-session/active-session-context";
import { appActivitySource } from "@/host-session/device-sources";

/**
 * The host sends no event when its settings change, so the app marks them stale when it returns
 * from the background. iOS system overlays, such as Control Center, only make the app inactive,
 * so they read nothing. A change made in another client, such as the default models of a repository
 * or the reusable prompts, then applies here. While the connection is live, open views read again
 * at once. Otherwise the reconnect reads the open views again, and other views read when they
 * open, so no read fails against a closed connection.
 */
export function SettingsRefreshOwner(): null {
  const queryClient = useQueryClient();
  const { remote } = useActiveSession().remote;
  useEffect(() => {
    let previous = appActivitySource.current();
    return appActivitySource.subscribe((next) => {
      const resumed = previous === "background" && next === "foreground";
      previous = next;
      if (!resumed) return;
      // The lifecycle controller reacts to the same change first, so the state is current here.
      const refetchType = remote.readState().status === "connected" ? "active" : "none";
      void queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.settingsSnapshot(),
        refetchType,
      });
      void queryClient.invalidateQueries({
        queryKey: [...workspaceQueryKeys.all, "repo-config"],
        refetchType,
      });
    });
  }, [queryClient, remote]);
  return null;
}
