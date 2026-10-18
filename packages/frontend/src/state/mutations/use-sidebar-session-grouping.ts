import {
  DEFAULT_APPEARANCE_SETTINGS,
  type SettingsSnapshot,
  type SidebarSessionGrouping,
} from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { SIDEBAR_SESSION_GROUPING_MUTATION_KEY } from "./sidebar-session-grouping";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";

export function useSidebarSessionGrouping() {
  const queryClient = useQueryClient();
  const hostClient = useHostClient();
  const options = settingsSnapshotQueryOptions();
  const settings = useQuery(options);
  const mutation = useMutation<SettingsSnapshot, Error, SidebarSessionGrouping>({
    mutationKey: SIDEBAR_SESSION_GROUPING_MUTATION_KEY,
    scope: { id: SIDEBAR_SESSION_GROUPING_MUTATION_KEY[1] },
    mutationFn: (grouping) => hostClient.workspaceUpdateSidebarSessionGrouping(grouping),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData(options.queryKey, snapshot);
    },
    onError: (error) => {
      toast.error("Failed to save session grouping", { description: errorMessage(error) });
    },
  });
  const { isPending, mutate } = mutation;
  const disabled = !settings.data || isPending;
  const changeGrouping = useCallback(
    (grouping: SidebarSessionGrouping): void => {
      if (!disabled) mutate(grouping);
    },
    [disabled, mutate],
  );
  return {
    grouping:
      (isPending ? mutation.variables : null) ??
      settings.data?.appearance.sidebarSessionGrouping ??
      DEFAULT_APPEARANCE_SETTINGS.sidebarSessionGrouping,
    disabled,
    changeGrouping,
  };
}
