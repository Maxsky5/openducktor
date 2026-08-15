import { knownRuntimeKindValues, type SettingsSnapshot } from "@openducktor/contracts";
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
  const { workspaces, addWorkspace } = useWorkspaceState();
  const [completionRepoPath, setCompletionRepoPath] = useState<string | null>(null);

  const addFirstWorkspace = useCallback(
    async (input: Parameters<typeof addWorkspace>[0]): Promise<void> => {
      if (!settingsSnapshot) {
        throw new Error("Settings must be loaded before opening the first workspace.");
      }
      const defaultRuntimeKind = knownRuntimeKindValues.find(
        (kind) => settingsSnapshot.agentRuntimes[kind].enabled,
      );
      await addWorkspace({
        ...input,
        ...(defaultRuntimeKind ? { defaultRuntimeKind } : {}),
      });
      setCompletionRepoPath(input.repoPath);

      const destinationQueries: Promise<unknown>[] = [
        queryClient.fetchQuery(
          repoTaskDataQueryOptions(input.repoPath, settingsSnapshot.kanban.doneVisibleDays),
        ),
      ];
      if (settingsSnapshot.appearance.horizontalScrollbarVisibility === "system") {
        destinationQueries.push(queryClient.fetchQuery(platformQueryOptions()));
      }

      // Query keeps failed reads as errors for Kanban to report after the workspace already exists.
      await Promise.allSettled(destinationQueries);
      onComplete();
    },
    [addWorkspace, onComplete, queryClient, settingsSnapshot],
  );

  return {
    workspaces,
    addFirstWorkspace,
    isFinalizing: completionRepoPath !== null,
  };
};
