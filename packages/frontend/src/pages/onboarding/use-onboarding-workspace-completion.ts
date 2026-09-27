import type { SettingsSnapshot } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useWorkspaceState } from "@/state/app-state-provider";
import { platformQueryOptions } from "@/state/queries/system";
import { repoTaskDataQueryOptions } from "@/state/queries/tasks";

export const useOnboardingWorkspaceCompletion = ({
  settingsSnapshot,
  onComplete,
}: {
  settingsSnapshot: SettingsSnapshot | undefined;
  onComplete: () => void;
}) => {
  const queryClient = useQueryClient();
  const workspaceState = useWorkspaceState();
  const [completionRepoPath, setCompletionRepoPath] = useState<string | null>(null);

  const completeWorkspace = useCallback(
    async (repoPath: string): Promise<void> => {
      if (!settingsSnapshot) {
        throw new Error("Settings must be loaded before opening the first workspace.");
      }
      setCompletionRepoPath(repoPath);

      const destinationQueries: Promise<unknown>[] = [
        queryClient.fetchQuery(repoTaskDataQueryOptions(repoPath)),
      ];
      if (settingsSnapshot.appearance.horizontalScrollbarVisibility === "system") {
        destinationQueries.push(queryClient.fetchQuery(platformQueryOptions()));
      }

      // Query keeps failed reads as errors for Kanban to report after the workspace already exists.
      await Promise.allSettled(destinationQueries);
      onComplete();
    },
    [onComplete, queryClient, settingsSnapshot],
  );

  return {
    workspaceState,
    completeWorkspace,
    isFinalizing: completionRepoPath !== null,
  };
};
