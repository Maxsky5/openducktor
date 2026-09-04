import type { SettingsSnapshot, SystemSettings } from "@openducktor/contracts";
import {
  type UseMutateAsyncFunction,
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { host } from "@/state/operations/host";
import { settingsSnapshotQueryOptions, workspaceQueryKeys } from "@/state/queries/workspace";
import { runSettingsWrite } from "./settings-write-queue";

const mutationKey = ["preferred-open-in-tool"] as const;

type PreferredOpenInToolState = {
  savePreference: UseMutateAsyncFunction<void, Error, SystemSettings>;
  isSavingPreference: boolean;
};

export function usePreferredOpenInTool(): PreferredOpenInToolState {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey,
    mutationFn: (system: SystemSettings) =>
      runSettingsWrite(queryClient, async () => {
        const snapshot = await host.systemUpdatePreferredOpenInTool(system);
        const key = workspaceQueryKeys.settingsSnapshot();
        const needsRefresh = queryClient.getQueryState(key)?.isInvalidated;
        await queryClient.cancelQueries({ queryKey: key, exact: true });
        const current = queryClient.getQueryData<SettingsSnapshot>(key);
        if (current && !needsRefresh) {
          // Workspace writes can refresh other sections while this response is pending.
          queryClient.setQueryData(key, { ...current, system: snapshot.system });
        } else {
          await queryClient.fetchQuery({ ...settingsSnapshotQueryOptions(), staleTime: 0 });
        }
      }),
  });
  const pendingCount = useIsMutating({ mutationKey });
  return { savePreference: mutation.mutateAsync, isSavingPreference: pendingCount > 0 };
}
