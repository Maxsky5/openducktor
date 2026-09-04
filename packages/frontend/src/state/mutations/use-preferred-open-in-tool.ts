import type { SystemSettings } from "@openducktor/contracts";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { host } from "@/state/operations/host";
import { workspaceQueryKeys } from "@/state/queries/workspace";
import { runSettingsWrite } from "./settings-write-queue";

const mutationKey = ["preferred-open-in-tool"] as const;

export function usePreferredOpenInTool() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey,
    mutationFn: (system: SystemSettings) =>
      runSettingsWrite(queryClient, async () => {
        const snapshot = await host.systemUpdatePreferredOpenInTool(system);
        await queryClient.cancelQueries({
          queryKey: workspaceQueryKeys.settingsSnapshot(),
          exact: true,
        });
        queryClient.setQueryData(workspaceQueryKeys.settingsSnapshot(), snapshot);
      }),
  });
  const pendingCount = useIsMutating({ mutationKey });
  return { savePreference: mutation.mutateAsync, isSavingPreference: pendingCount > 0 };
}
