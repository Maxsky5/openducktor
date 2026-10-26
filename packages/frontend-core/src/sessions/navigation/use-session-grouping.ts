import {
  DEFAULT_APPEARANCE_SETTINGS,
  type SettingsSnapshot,
  type SidebarSessionGrouping,
} from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useClientConnection, useHostClient } from "../../connection/client-connection-react";
import { errorMessage } from "../../lib/errors";
import { settingsSnapshotQueryOptions } from "../../queries/workspace";

export const SESSION_GROUPING_MUTATION_KEY = ["settings", "sidebar-session-grouping"] as const;

export type SessionGrouping = {
  grouping: SidebarSessionGrouping;
  /** True until the host settings load. */
  disabled: boolean;
  changeGrouping: (grouping: SidebarSessionGrouping) => void;
};

/**
 * The session grouping of the session list. It is a host setting, so every client groups the
 * sessions the same way. "task" shows one row for each task; "none" shows every session. While a
 * change saves, the grouping is the new value, and the saved settings stay as the host sent them.
 * Changes save one at a time in their order, so a change during a save waits for it, and the
 * last change stays. The result keeps its identity until a value changes, so a context can pass
 * it on.
 */
export function useSessionGrouping(): SessionGrouping {
  const queryClient = useQueryClient();
  const host = useHostClient();
  const { feedback } = useClientConnection();
  const options = settingsSnapshotQueryOptions();
  const settings = useQuery(options);
  const mutation = useMutation<SettingsSnapshot, Error, SidebarSessionGrouping>({
    mutationKey: SESSION_GROUPING_MUTATION_KEY,
    scope: { id: SESSION_GROUPING_MUTATION_KEY[1] },
    mutationFn: (grouping) => host.workspaceUpdateSidebarSessionGrouping(grouping),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData(options.queryKey, snapshot);
    },
    onError: (cause) => {
      feedback.show("error", "The session grouping was not saved.", {
        description: errorMessage(cause),
      });
    },
  });
  const { isPending, mutate } = mutation;
  const disabled = !settings.data;
  const changeGrouping = useCallback(
    (grouping: SidebarSessionGrouping): void => {
      if (!disabled) mutate(grouping);
    },
    [disabled, mutate],
  );
  const grouping =
    (isPending ? mutation.variables : null) ??
    settings.data?.appearance.sidebarSessionGrouping ??
    DEFAULT_APPEARANCE_SETTINGS.sidebarSessionGrouping;
  return useMemo(
    () => ({ grouping, disabled, changeGrouping }),
    [changeGrouping, disabled, grouping],
  );
}
